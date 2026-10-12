import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import MachineUpdateConsoleHost from '@/components/MachineUpdateConsoleHost.vue'
import { i18n } from '@/i18n'
import MachineView from '@/views/MachineView.vue'
import { useAvailabilityStore } from '@/stores/availability'
import { useMachineSystemStore } from '@/stores/machineSystem'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useToastsStore } from '@/stores/toasts'
import { copyToClipboard } from '@/utils/clipboard'

vi.mock('@/utils/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }))

// A view left mounted keeps reacting to the next test's stores.
enableAutoUnmount(afterEach)

beforeAll(() => {
  // jsdom 30 ships <dialog> without its modal methods, so the shared dialog's
  // open/close watcher has nothing to call.
  const dialogPrototype = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>
  if (typeof dialogPrototype.showModal !== 'function') {
    dialogPrototype.showModal = function showModal(this: HTMLDialogElement): void {
      this.open = true
    }
    dialogPrototype.close = function close(this: HTMLDialogElement): void {
      this.open = false
    }
  }
})

function mountMachineView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const moonraker = useMoonrakerStore(pinia)
  const machine = useMachineSystemStore(pinia)

  // The panels live inside an availability region, so Moonraker has to be
  // reachable before anything below the heading renders.
  moonraker.connectionPhase = 'connected'
  useAvailabilityStore(pinia).moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })

  vi.spyOn(machine, 'start').mockImplementation(() => undefined)
  vi.spyOn(machine, 'stop').mockImplementation(() => undefined)
  vi.spyOn(machine, 'load').mockResolvedValue()
  vi.spyOn(machine, 'refreshProcStats').mockResolvedValue()

  // The update console is rendered app-wide, so the page is mounted beside it
  // the way `App.vue` mounts both.
  const WithConsole = defineComponent({
    render: () => [h(MachineView), h(MachineUpdateConsoleHost)],
  })
  const wrapper = mount(WithConsole, { global: { plugins: [pinia, i18n] } })
  return { machine, wrapper }
}

/** Matched on the name alone, since rows sort by state and "Klipper" is a prefix of "KlipperScreen". */
function rowFor(wrapper: VueWrapper, name: string) {
  const row = wrapper
    .findAll('.machine-row')
    .find((candidate) => candidate.get('.machine-row__name').text() === name)
  if (!row) throw new Error(`No update row for ${name}`)
  return row
}

function actionButtonFor(wrapper: VueWrapper, name: string) {
  return rowFor(wrapper, name).get('.machine-row__action')
}

/** Check and rollback live in the row's menu, so it is opened first. */
async function menuItemFor(wrapper: VueWrapper, name: string, itemClass: string) {
  const row = rowFor(wrapper, name)
  await row.get('.machine-row__menu > .button').trigger('click')
  return row.find(`.${itemClass}`)
}

async function rollbackButtonFor(wrapper: VueWrapper, name: string) {
  const item = await menuItemFor(wrapper, name, 'machine-row__rollback')
  return item.exists() ? item : undefined
}

async function checkButtonFor(wrapper: VueWrapper, name: string) {
  const item = await menuItemFor(wrapper, name, 'machine-row__check')
  if (!item.exists()) throw new Error(`No check item for ${name}`)
  return item
}

function serviceRowFor(wrapper: VueWrapper, name: string) {
  const row = wrapper
    .findAll('.machine-service-row')
    .find((candidate) => candidate.get('.machine-row__name').text() === name)
  if (!row) throw new Error(`No service row for ${name}`)
  return row
}

/** A running service's Restart and Stop live in its row's menu, so it is opened first. */
async function serviceMenuItem(wrapper: VueWrapper, name: string, item: 'restart' | 'stop') {
  const row = serviceRowFor(wrapper, name)
  await row.get('.machine-row__menu > .button').trigger('click')
  return row.find(`.machine-service-row__${item}`)
}

/** The dialog stays in the DOM while closed, so its copy is not page text. */
function headingActionText(wrapper: VueWrapper): string {
  return wrapper
    .findAll('.machine-panel-heading__actions')
    .map((actions) => actions.text())
    .join(' ')
}

function actionByLabel(wrapper: VueWrapper, label: string) {
  const button = wrapper
    .findAll('.machine-panel-heading__actions .button')
    .find((candidate) => candidate.text().includes(label))
  if (!button) throw new Error(`No panel action labeled ${label}`)
  return button
}

describe('MachineView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('offers Update all only while a source is behind, and confirms before installing', async () => {
    const { machine, wrapper } = mountMachineView()
    const startUpdate = vi.spyOn(machine, 'startUpdate').mockResolvedValue(true)
    const startAllUpdates = vi.spyOn(machine, 'startAllUpdates').mockResolvedValue(true)
    machine.updates = [
      { id: 'klipper', displayName: 'Klipper', remote_version: 'v1', version: 'v1' },
    ]
    await flushPromises()

    expect(headingActionText(wrapper)).not.toContain('Update ')

    machine.updates = [
      ...machine.updates,
      { id: 'moonraker', displayName: 'moonraker', commits_behind_count: 3 },
    ]
    await flushPromises()

    const updateAll = wrapper.get('.machine-panel-heading__actions .button--primary')
    expect(updateAll.text()).toContain('Update 1')
    await updateAll.trigger('click')

    // An upgrade restarts services, so nothing is sent until the dialog is answered.
    expect(startUpdate).not.toHaveBeenCalled()
    expect(wrapper.get('.confirm-dialog').text()).toContain('Update all software?')

    // A confirmation covering a set names its members instead of implying a count,
    // and an up-to-date source is not among the things being authorized.
    const dialogText = wrapper.get('.confirm-dialog').text()
    expect(dialogText).toContain('These sources will be updated: moonraker.')
    expect(dialogText).not.toContain('Klipper,')

    await wrapper.get('.confirm-dialog .button--primary').trigger('click')
    expect(startAllUpdates).toHaveBeenCalledOnce()
    expect(startUpdate).not.toHaveBeenCalled()
  })

  it('keeps a source needing attention out of Update all and offers Investigate instead', async () => {
    const { machine, wrapper } = mountMachineView()
    const startUpdate = vi.spyOn(machine, 'startUpdate').mockResolvedValue(true)
    machine.updates = [{ id: 'KlipperScreen', displayName: 'KlipperScreen', is_dirty: true }]
    await flushPromises()

    // Nothing here is installable, so the panel must not offer to install anything.
    expect(headingActionText(wrapper)).not.toContain('Update ')

    const row = rowFor(wrapper, 'KlipperScreen')
    expect(row.text()).toContain('Needs attention')
    expect(row.get('.machine-row__meta').text()).toBe('— · local changes')
    // Investigate is the row's one visible action, labeled like an install is.
    const action = actionButtonFor(wrapper, 'KlipperScreen')
    expect(action.text()).toBe('Investigate')
    expect(action.attributes('aria-label')).toBe('Investigate KlipperScreen')

    await action.trigger('click')
    expect(startUpdate).not.toHaveBeenCalled()
    expect(wrapper.get('.update-recovery-dialog').text()).toContain('Investigate KlipperScreen')
  })

  it('names only the installable sources when Update all covers a mixed panel', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.updates = [
      { id: 'KlipperScreen', displayName: 'KlipperScreen', is_dirty: true },
      { id: 'moonraker', displayName: 'moonraker', commits_behind_count: 3 },
    ]
    await flushPromises()

    await actionByLabel(wrapper, 'Update 1').trigger('click')

    const dialogText = wrapper.get('.confirm-dialog').text()
    expect(dialogText).toContain('These sources will be updated: moonraker.')
    expect(dialogText).not.toContain('KlipperScreen')
  })

  it('marks the updates panel busy while the host is working, and opens the console as a run starts', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.updates = [{ id: 'moonraker', displayName: 'moonraker', commits_behind_count: 3 }]
    await flushPromises()

    const updatesPanel = wrapper.get('[aria-labelledby="machine-updates-title"]')
    expect(updatesPanel.attributes('aria-busy')).toBeUndefined()

    machine.checkingUpdateId = ''
    await flushPromises()
    expect(updatesPanel.attributes('aria-busy')).toBe('true')
    // A check is not a run, so it does not open the console popout on its own.
    expect(wrapper.find('.update-console-dialog[open]').exists()).toBe(false)

    machine.checkingUpdateId = null
    machine.runningUpdateId = 'moonraker'
    machine.outputLines = [{ id: 1, application: 'moonraker', message: 'Updating...' }]
    await flushPromises()

    expect(updatesPanel.attributes('aria-busy')).toBe('true')
    // A run starting opens the console the way `TheUpdateDialog` does in the
    // reference interface, since the user just confirmed the action it reports on.
    const dialog = wrapper.get('.update-console-dialog')
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.text()).toContain('Updating...')
  })

  it('reports a lost socket separately from a refused start', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.updates = [{ id: 'moonraker', displayName: 'moonraker', commits_behind_count: 3 }]
    machine.updateInterrupted = true
    await flushPromises()

    const notice = wrapper.get('.machine-panel-notice')
    expect(notice.text()).toContain('Moonraker disconnected while updating')
    expect(notice.text()).not.toContain('could not be started')
  })

  it('shows what Moonraker reported and offers a reset matched to the repository state', async () => {
    const { machine, wrapper } = mountMachineView()
    const recoverUpdate = vi.spyOn(machine, 'recoverUpdate').mockResolvedValue(true)
    machine.updates = [
      {
        id: 'KlipperScreen',
        displayName: 'KlipperScreen',
        is_dirty: true,
        detached: true,
        branch: 'master',
        remote_alias: 'origin',
        commits_behind_count: 1,
        commits_behind: [
          {
            sha: 'e3cbe7ea3663a8cd10207a9aecc4e5458aeb1f1f',
            author: "Kevin O'Connor",
            date: '1644534721',
            subject: 'stm32: Clear SPE flag on a change to SPI CR1 register',
            message: 'body',
            tag: null,
          },
        ],
        git_messages: ['error: Your local changes would be overwritten'],
      },
    ]
    await flushPromises()
    await actionButtonFor(wrapper, 'KlipperScreen').trigger('click')

    const dialog = wrapper.get('.update-recovery-dialog')
    // Every reported reason is listed, not just the first one.
    const reasons = dialog.findAll('.update-recovery-reasons li').map((item) => item.text())
    expect(reasons).toEqual([
      'The repository has local changes.',
      'The repository is on a detached HEAD rather than a branch.',
    ])
    expect(dialog.find('.update-recovery-commits').exists()).toBe(false)

    await dialog
      .findAll('.button')
      .find((b) => b.text().includes('View differences'))!
      .trigger('click')

    expect(dialog.text()).toContain('Local master is 1 commits behind origin/master')
    // Moonraker exposes no file-level diff, so the dialog says what it does show.
    expect(dialog.text()).toContain('it does not expose a file-level diff')
    expect(dialog.get('.update-recovery-commit__sha').text()).toBe('e3cbe7ea')
    expect(dialog.get('.update-recovery-commit__subject').text()).toContain('stm32: Clear SPE flag')
    expect(dialog.get('.update-recovery-messages').text()).toContain('would be overwritten')

    // Dirty, not corrupt, so `git reset` is the right operation and the label says so.
    const reset = dialog.get('.button--danger')
    expect(reset.text()).toContain('Force reset the branch')
    await reset.trigger('click')

    expect(recoverUpdate).toHaveBeenCalledWith('KlipperScreen')
    // The dialog steps aside so the console popout reporting the recovery can take over.
    expect(wrapper.get('.update-recovery-dialog').attributes('open')).toBeUndefined()
  })

  it('offers a re-clone instead of a reset when the repository is corrupt', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.updates = [{ id: 'webclient', displayName: 'webclient', corrupt: true }]
    await flushPromises()
    await actionButtonFor(wrapper, 'webclient').trigger('click')

    const dialog = wrapper.get('.update-recovery-dialog')
    // `git reset` cannot repair a corrupt repository, so the mode follows the state.
    expect(dialog.get('.button--danger').text()).toContain('Re-clone the repository')
    expect(dialog.findAll('.update-recovery-reasons li')[0]?.text()).toBe(
      'The repository is corrupt.',
    )
  })

  it('installs from a row that is behind and re-checks from a row that is up to date', async () => {
    const { machine, wrapper } = mountMachineView()
    const startUpdate = vi.spyOn(machine, 'startUpdate').mockResolvedValue(true)
    const checkForUpdates = vi.spyOn(machine, 'checkForUpdates').mockResolvedValue(true)
    machine.updates = [
      { id: 'klipper', displayName: 'Klipper', remote_version: 'v1', version: 'v1' },
      { id: 'moonraker', displayName: 'moonraker', commits_behind_count: 3 },
    ]
    await flushPromises()

    // An up-to-date source has nothing to install, so its check lives in the
    // row's menu — and a check reads the repository, so it is not confirmed.
    expect(rowFor(wrapper, 'Klipper').find('.machine-row__action').exists()).toBe(false)
    await (await checkButtonFor(wrapper, 'Klipper')).trigger('click')
    expect(checkForUpdates).toHaveBeenCalledWith('klipper')
    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(false)

    // An install answers to the same guard as Update all, so its action button
    // carries the same confirming-control marker.
    const installAction = actionButtonFor(wrapper, 'moonraker')
    expect(installAction.attributes('data-guard')).toBe('confirm')
    expect(installAction.attributes('aria-haspopup')).toBe('dialog')

    await installAction.trigger('click')
    expect(startUpdate).not.toHaveBeenCalled()
    expect(wrapper.get('.confirm-dialog').text()).toContain('Update moonraker?')

    await wrapper.get('.confirm-dialog .button--primary').trigger('click')
    expect(startUpdate).toHaveBeenCalledWith('moonraker')
  })

  it('shows the changelog for the source being updated', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.updates = [
      {
        id: 'klipper',
        displayName: 'Klipper',
        configured_type: 'git_repo',
        commits_behind_count: 1,
        commits_behind: [
          {
            sha: 'e3cbe7ea3663a8cd10207a9aecc4e5458aeb1f1f',
            author: "Kevin O'Connor",
            date: '1644534721',
            subject: 'stm32: Clear SPE flag on a change to SPI CR1 register',
            message: 'body',
            tag: null,
          },
        ],
      },
      {
        id: 'system',
        displayName: 'System',
        configured_type: 'system',
        package_count: 2,
        package_list: ['raspberrypi-kernel', 'libc6'],
      },
    ]
    await flushPromises()

    await actionButtonFor(wrapper, 'Klipper').trigger('click')
    const commitDialog = wrapper.get('.confirm-dialog')
    // Body content widens the dialog, the same measure `UpdateRecoveryDialog` uses.
    expect(commitDialog.classes()).toContain('confirm-dialog--wide')
    expect(commitDialog.text()).toContain('1 commits will be applied')
    expect(commitDialog.get('.update-recovery-commit__sha').text()).toBe('e3cbe7ea')
    expect(commitDialog.get('.update-recovery-commit__subject').text()).toContain(
      'stm32: Clear SPE flag',
    )
    await commitDialog
      .findAll('.button')
      .find((button) => !button.classes().includes('button--primary'))!
      .trigger('click')

    await actionButtonFor(wrapper, 'System').trigger('click')
    const packageDialog = wrapper.get('.confirm-dialog')
    expect(packageDialog.text()).toContain('These packages will be upgraded')
    expect(packageDialog.text()).toContain('raspberrypi-kernel')
    expect(packageDialog.text()).toContain('libc6')
    // A system source has no commits, so nothing tries to render one.
    expect(packageDialog.find('.update-recovery-commits').exists()).toBe(false)
  })

  it("shows a release source's notes from GitHub beside the link to its release page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            tag_name: 'v0.9.2',
            name: 'v0.9.2',
            html_url: 'https://github.com/Hannott/Alabaster/releases/tag/v0.9.2',
            published_at: '2026-10-12T00:00:00Z',
            body: '## Bugfixes\n\n- Fixed the **home** buttons.',
          },
          { tag_name: 'v0.9.1', name: 'v0.9.1', body: '## Features\n\n- Something new.' },
          { tag_name: 'v0.9.0', name: 'v0.9.0', body: 'Already installed.' },
        ]),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const { machine, wrapper } = mountMachineView()
      machine.updates = [
        {
          id: 'alabaster',
          displayName: 'Alabaster',
          configured_type: 'web',
          owner: 'Hannott',
          repo_name: 'Alabaster',
          version: 'v0.9.0',
          remote_version: 'v0.9.2',
        },
      ]
      await flushPromises()

      await actionButtonFor(wrapper, 'Alabaster').trigger('click')
      const dialog = wrapper.get('.confirm-dialog')
      // Wide from the start, so the notes arriving do not resize it.
      expect(dialog.classes()).toContain('confirm-dialog--wide')
      await flushPromises()

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://api.github.com/repos/Hannott/Alabaster/releases?per_page=30',
      )
      expect(dialog.text()).toContain('2 releases will be installed')
      const releases = dialog.findAll('.release-notes > li')
      expect(
        releases.map((release) => release.get('.update-recovery-commit__subject').text()),
      ).toEqual(['v0.9.2', 'v0.9.1'])
      expect(releases[0]?.get('strong').text()).toBe('home')
      expect(dialog.text()).not.toContain('Already installed.')
      expect(dialog.get('.update-release-notes').attributes('href')).toBe(
        'https://github.com/Hannott/Alabaster/releases/tag/v0.9.2',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shows a quiet up-to-date row and names the target of an available one', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.updates = [
      { id: 'klipper', displayName: 'Klipper', remote_version: 'v1', version: 'v1' },
      {
        id: 'moonraker',
        displayName: 'moonraker',
        configured_type: 'git_repo',
        version: 'v0.11.0-3',
        remote_version: 'v0.11.0-6',
        commits_behind_count: 3,
      },
    ]
    await flushPromises()

    // An up-to-date row asks for nothing, so its status is plain text rather
    // than a control or a coloured pill, and the row carries no accessible
    // name of its own.
    const current = rowFor(wrapper, 'Klipper')
    expect(current.get('.machine-row__status').text()).toBe('Up to date')
    expect(current.find('.machine-row__action').exists()).toBe(false)
    expect(current.attributes('aria-label')).toBeUndefined()

    // An available row says what it moves to, so an update can be judged
    // before its confirmation opens.
    const behind = rowFor(wrapper, 'moonraker')
    expect(behind.text()).toContain('Update available')
    expect(behind.get('.machine-row__meta').text()).toBe('v0.11.0-3 → -6 · 3 commits')
    const behindAction = actionButtonFor(wrapper, 'moonraker')
    expect(behindAction.text()).toContain('Update')
    expect(behindAction.attributes('aria-label')).toBe('Update moonraker')
    expect(behindAction.classes()).toContain('button--sm')
  })

  it('lists sources needing a decision first and summarizes the panel in one line', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.updates = [
      { id: 'klipper', displayName: 'Klipper', version: 'v1' },
      { id: 'moonraker', displayName: 'Moonraker', commits_behind_count: 2 },
      { id: 'crowsnest', displayName: 'Crowsnest', version: 'v4' },
      { id: 'KlipperScreen', displayName: 'KlipperScreen', is_dirty: true },
    ]
    await flushPromises()

    const names = wrapper.findAll('.machine-row__name').map((name) => name.text())
    expect(names).toEqual(['KlipperScreen', 'Moonraker', 'Klipper', 'Crowsnest'])
    expect(wrapper.get('.machine-panel-summary').text()).toBe(
      '1 update available · 1 needs attention · 2 up to date',
    )
    expect(actionByLabel(wrapper, 'Update 1').text()).toContain('Update 1')

    machine.updates = [{ id: 'klipper', displayName: 'Klipper', version: 'v1' }]
    await flushPromises()
    expect(wrapper.get('.machine-panel-summary').text()).toBe('All 1 sources up to date')
  })

  it('offers the console popout only once there is a transcript, and reports a failed start in the panel', async () => {
    const { machine, wrapper } = mountMachineView()
    expect(headingActionText(wrapper)).not.toContain('View console')

    machine.runningUpdateId = ''
    machine.outputLines = [
      { id: 1, application: 'moonraker', message: 'Updating moonraker...' },
      { id: 2, application: 'moonraker', message: 'Done' },
    ]
    await flushPromises()

    // The transcript itself — role, focusability, scroll behavior, the
    // running/finished state chip — is `MachineUpdateConsoleDialog`'s own
    // contract, covered by that component's spec; this only checks the two
    // surfaces stay wired together.
    await actionByLabel(wrapper, 'View console').trigger('click')
    const dialog = wrapper.get('.update-console-dialog')
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.text()).toContain('Updating moonraker...')

    machine.runningUpdateId = null
    machine.updateFailed = true
    await flushPromises()

    // The page-level banner stays reserved for a failed host read.
    expect(wrapper.find('.machine-system-error').exists()).toBe(false)
    expect(wrapper.get('.machine-panel-notice').text()).toContain(
      'The update could not be started.',
    )
  })

  it('offers a rollback for a git/web source but not a system source or one needing attention', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.updates = [
      { id: 'klipper', displayName: 'Klipper', configured_type: 'git_repo', version: 'v2' },
      { id: 'system', displayName: 'system', configured_type: 'system', package_count: 4 },
      { id: 'webclient', displayName: 'webclient', configured_type: 'web', is_dirty: true },
    ]
    await flushPromises()

    expect(await rollbackButtonFor(wrapper, 'Klipper')).toBeTruthy()
    expect(await rollbackButtonFor(wrapper, 'system')).toBeUndefined()
    expect(await rollbackButtonFor(wrapper, 'webclient')).toBeUndefined()
  })

  it('offers an anomalies toggle only when Moonraker reported one and the source is not needing attention', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.updates = [
      {
        id: 'klipper',
        displayName: 'Klipper',
        configured_type: 'git_repo',
        anomalies: ['Repo not on official remote/branch, expected: origin/master'],
      },
      { id: 'moonraker', displayName: 'moonraker', configured_type: 'git_repo' },
      {
        id: 'webclient',
        displayName: 'webclient',
        configured_type: 'web',
        is_dirty: true,
        anomalies: ['Detached from its branch'],
      },
    ]
    await flushPromises()

    expect(wrapper.find('.machine-row__aside').exists()).toBe(true)
    const toggles = wrapper.findAll('.machine-row__aside')
    expect(toggles).toHaveLength(1)
    expect(toggles[0]?.attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.machine-list__notes').exists()).toBe(false)

    await toggles[0]?.trigger('click')
    expect(toggles[0]?.attributes('aria-pressed')).toBe('true')
    const list = wrapper.get('.machine-list__notes')
    expect(list.text()).toContain('Repo not on official remote/branch, expected: origin/master')

    await toggles[0]?.trigger('click')
    expect(wrapper.find('.machine-list__notes').exists()).toBe(false)
  })

  it('confirms a rollback and opens the update console once it starts', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.updates = [
      { id: 'klipper', displayName: 'Klipper', configured_type: 'git_repo', version: 'v2' },
    ]
    const rollbackUpdate = vi.spyOn(machine, 'rollbackUpdate').mockImplementation(async () => {
      machine.runningUpdateId = 'klipper'
      return true
    })
    await flushPromises()

    await (await rollbackButtonFor(wrapper, 'Klipper'))?.trigger('click')
    expect(wrapper.text()).toContain('Roll back Klipper?')
    expect(rollbackUpdate).not.toHaveBeenCalled()

    await wrapper.get('.confirm-dialog[open] .button--danger').trigger('click')
    expect(rollbackUpdate).toHaveBeenCalledWith('klipper')

    const dialog = wrapper.get('.update-console-dialog')
    expect(dialog.attributes('open')).toBeDefined()
  })

  it('reloads once the console closes after Alabaster updates, without prompting about Klipper even when it updated too', async () => {
    const { machine, wrapper } = mountMachineView()
    // jsdom's `location.reload` is non-configurable, so `vi.spyOn` cannot wrap it
    // directly — the whole `window.location` is replaced instead.
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    })

    machine.updates = [
      { id: 'klipper', displayName: 'Klipper', configured_type: 'git_repo', version: 'v2' },
      { id: 'alabaster', displayName: 'Alabaster', configured_type: 'web', version: 'v2' },
    ]
    machine.runningUpdateId = 'klipper'
    await flushPromises()

    // Both sources reached `finishUpdateRun` in the same run.
    machine.runningUpdateId = null
    machine.completedUpdateIds = new Set(['klipper', 'alabaster'])
    await flushPromises()

    // The reload does not fire while the reader is still watching the transcript.
    expect(reload).not.toHaveBeenCalled()

    await wrapper.get('.update-console-dialog').get('.button--icon').trigger('click')

    // Moonraker already restarted Klipper as part of finishing its own update,
    // so nothing here should ask the reader to restart it a second time.
    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads without prompting when only Alabaster updated', async () => {
    const { machine, wrapper } = mountMachineView()
    // jsdom's `location.reload` is non-configurable, so `vi.spyOn` cannot wrap it
    // directly — the whole `window.location` is replaced instead.
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    })

    machine.updates = [{ id: 'alabaster', displayName: 'Alabaster', configured_type: 'web' }]
    machine.runningUpdateId = 'alabaster'
    await flushPromises()

    machine.runningUpdateId = null
    machine.completedUpdateIds = new Set(['alabaster'])
    await flushPromises()

    await wrapper.get('.update-console-dialog').get('.button--icon').trigger('click')

    expect(wrapper.find('.confirm-dialog[open]').exists()).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })

  it("keeps a running service's Restart and Stop in its menu, and shows Start on a stopped one", async () => {
    const { machine, wrapper } = mountMachineView()
    machine.systemInfo = {
      provider: 'systemd_cli',
      distribution: { name: 'Debian', version: '13', codename: 'trixie' },
      available_services: ['klipper', 'crowsnest'],
      service_state: { crowsnest: { active_state: 'inactive' } },
    }
    await flushPromises()

    // A running unit asks for nothing, so its row says so in words and keeps
    // its actions one menu away.
    const klipper = serviceRowFor(wrapper, 'klipper')
    expect(klipper.get('.machine-row__status').text()).toBe('Running')
    expect(klipper.find('.machine-row__action').exists()).toBe(false)
    expect((await serviceMenuItem(wrapper, 'klipper', 'restart')).exists()).toBe(true)
    expect(klipper.find('.machine-service-row__stop').exists()).toBe(true)

    // A stopped one shows the action its state asks for, and has no menu,
    // since Restart would do nothing Start does not already cover.
    const crowsnest = serviceRowFor(wrapper, 'crowsnest')
    const start = crowsnest.get('.machine-row__action')
    expect(start.text()).toBe('Start')
    expect(start.attributes('title')).toBe('Start crowsnest')
    expect(crowsnest.find('.machine-row__menu').exists()).toBe(false)
  })

  it('offers no Stop for a running Moonraker, since nothing could start it again', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.systemInfo = {
      provider: 'systemd_cli',
      distribution: { name: 'Debian', version: '13', codename: 'trixie' },
      available_services: ['moonraker'],
      service_state: { moonraker: { active_state: 'active' } },
    }
    await flushPromises()

    // Restart still reaches it -- systemd relaunches it as one operation --
    // but Stop, which nothing could undo, is withheld from the menu.
    expect((await serviceMenuItem(wrapper, 'moonraker', 'restart')).exists()).toBe(true)
    expect(serviceRowFor(wrapper, 'moonraker').find('.machine-service-row__stop').exists()).toBe(
      false,
    )
  })

  it('confirms a restart, milder than a stop but still guarded', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.systemInfo = {
      provider: 'systemd_cli',
      distribution: { name: 'Debian', version: '13', codename: 'trixie' },
      available_services: ['crowsnest'],
      service_state: { crowsnest: { active_state: 'active' } },
    }
    const restartService = vi.spyOn(machine, 'restartService').mockResolvedValue(true)
    await flushPromises()

    await (await serviceMenuItem(wrapper, 'crowsnest', 'restart')).trigger('click')
    expect(wrapper.text()).toContain('Restart crowsnest?')
    expect(restartService).not.toHaveBeenCalled()

    // Its own dialog carries no `tone="danger"`, unlike Stop's -- a restart
    // recovers rather than destroys.
    const dialog = wrapper.get('.confirm-dialog[open]')
    expect(dialog.find('.button--danger').exists()).toBe(false)
    await dialog.get('.button--primary').trigger('click')

    expect(restartService).toHaveBeenCalledWith('crowsnest')
  })

  it('confirms before stopping any service, but starts one back up with no confirmation', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.systemInfo = {
      provider: 'systemd_cli',
      distribution: { name: 'Debian', version: '13', codename: 'trixie' },
      available_services: ['klipper', 'crowsnest'],
      service_state: { crowsnest: { active_state: 'inactive' } },
    }
    const startService = vi.spyOn(machine, 'startService').mockResolvedValue(true)
    const stopService = vi.spyOn(machine, 'stopService').mockResolvedValue(true)
    await flushPromises()

    // Starting a stopped unit is corrective, not consequential, so it runs
    // straight away with no dialog.
    await serviceRowFor(wrapper, 'crowsnest').get('.machine-row__action').trigger('click')
    expect(startService).toHaveBeenCalledWith('crowsnest')

    // Stopping klipper is confirmed the same way any other service's Stop is —
    // this is not the print-derived `restartKlipper`/`firmwareRestart` guard.
    await (await serviceMenuItem(wrapper, 'klipper', 'stop')).trigger('click')
    expect(wrapper.text()).toContain('Stop klipper?')
    expect(stopService).not.toHaveBeenCalled()

    await wrapper.get('.confirm-dialog[open] .button--danger').trigger('click')
    expect(stopService).toHaveBeenCalledWith('klipper')
  })

  it('names a failed service first in its summary and offers Restart on its row', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.systemInfo = {
      provider: 'systemd_cli',
      distribution: { name: 'Debian', version: '13', codename: 'trixie' },
      available_services: ['klipper', 'crowsnest'],
      service_state: { crowsnest: { active_state: 'failed' } },
    }
    await flushPromises()

    const panel = wrapper.get('[aria-labelledby="machine-services-title"]')
    expect(panel.get('.machine-panel-summary').text()).toBe('1 failed · 1 running')
    const crowsnest = serviceRowFor(wrapper, 'crowsnest')
    expect(crowsnest.attributes('data-state')).toBe('attention')
    expect(crowsnest.get('.machine-row__action').text()).toContain('Restart')
  })

  it('reports a refused service action as a toast rather than inline', async () => {
    const { machine, wrapper } = mountMachineView()
    machine.systemInfo = {
      provider: 'systemd_cli',
      distribution: { name: 'Debian', version: '13', codename: 'trixie' },
      available_services: ['crowsnest'],
      service_state: { crowsnest: { active_state: 'active' } },
    }
    const toasts = useToastsStore()
    vi.spyOn(machine, 'stopService').mockImplementation(async () => {
      toasts.pushError(new Error('refused'))
      return false
    })
    await flushPromises()

    await (await serviceMenuItem(wrapper, 'crowsnest', 'stop')).trigger('click')
    await wrapper.get('.confirm-dialog[open] .button--danger').trigger('click')
    await flushPromises()

    expect(wrapper.find('.machine-panel-notice').exists()).toBe(false)
    expect(toasts.entries.some((entry) => entry.message.includes('refused'))).toBe(true)
  })

  describe('host strip', () => {
    it('names an under-voltage the host is suffering now, in words as well as colour', async () => {
      const { machine, wrapper } = mountMachineView()
      machine.procStats = {
        cpu_temp: 48,
        network: {},
        system_cpu_usage: { cpu: 12 },
        system_uptime: 90_000,
        system_memory: { total: 4_000_000, available: 3_000_000, used: 1_000_000 },
        throttled_state: { bits: 0x50005, flags: [] },
        websocket_connections: 3,
      }
      await flushPromises()

      const power = wrapper.findAll('.machine-stat').find((stat) => stat.text().includes('Power'))
      expect(power?.attributes('data-tone')).toBe('caution')
      expect(power?.text()).toContain('Low')
      expect(power?.text()).toContain('Under-voltage now')
    })

    it('leaves the power cell out on a host that reports no throttle state', async () => {
      const { machine, wrapper } = mountMachineView()
      machine.procStats = {
        cpu_temp: null,
        network: {},
        system_cpu_usage: { cpu: 12 },
        system_uptime: 90_000,
        system_memory: { total: 4_000_000, available: 3_000_000, used: 1_000_000 },
        throttled_state: null,
      }
      await flushPromises()

      const labels = wrapper.findAll('.machine-stat dt').map((label) => label.text())
      expect(labels).not.toContain('Power')
      expect(labels).not.toContain('Temperature')
    })
  })

  describe('hardware', () => {
    it('stays hidden when nothing has been detected', async () => {
      const { wrapper } = mountMachineView()
      await flushPromises()

      expect(wrapper.find('[aria-labelledby="machine-hardware-title"]').exists()).toBe(false)
    })

    it('names a serial device by its board, says which mcu uses it, and copies its full path', async () => {
      const { machine, wrapper } = mountMachineView()
      usePrinterConfigStore().settings = {
        mcu: { serial: '/dev/serial/by-id/usb-Klipper_stm32f446xx_180042000651343437343531-if00' },
      }
      machine.serialDevices = [
        {
          device_type: 'usb',
          device_path: '/dev/ttyACM0',
          device_name: 'ttyACM0',
          driver_name: 'cdc_acm',
          path_by_hardware: null,
          path_by_id: '/dev/serial/by-id/usb-Klipper_stm32f446xx_180042000651343437343531-if00',
          usb_location: '1:5',
        },
      ]
      await flushPromises()

      const row = wrapper.get('.machine-serial-row')
      expect(row.get('.machine-row__name').text()).toBe('Klipper stm32f446xx')
      expect(row.get('.machine-row__meta').text()).toBe('/dev/ttyACM0 · used by mcu')

      await row.get('.machine-row__action').trigger('click')
      await flushPromises()
      expect(copyToClipboard).toHaveBeenCalledWith(
        '/dev/serial/by-id/usb-Klipper_stm32f446xx_180042000651343437343531-if00',
      )
      expect(row.get('.machine-row__action').text()).toBe('Copied')
    })

    it('folds USB hubs away behind a count, since the board a reader wants is never one', async () => {
      const { machine, wrapper } = mountMachineView()
      const usb = (device_num: number, description: string, deviceClass: string) => ({
        device_num,
        bus_num: 1,
        vendor_id: '1d6b',
        product_id: '0002',
        usb_location: `1:${device_num}`,
        manufacturer: null,
        product: null,
        serial: null,
        description,
        class: deviceClass,
      })
      machine.usbDevices = [
        usb(1, 'Linux Foundation 2.0 root hub', 'Hub'),
        usb(18, 'OpenMoko, Inc. Klipper 3d-Printer Firmware', 'Communications'),
      ]
      await flushPromises()

      const names = () =>
        wrapper.findAll('.machine-usb-row .machine-row__name').map((n) => n.text())
      expect(names()).toEqual(['OpenMoko, Inc. Klipper 3d-Printer Firmware'])
      expect(wrapper.get('.machine-usb-row .machine-row__meta').text()).toBe('bus 1 · device 18')

      const fold = wrapper.get('.machine-list__fold .button')
      expect(fold.text()).toBe('+ 1 hub')
      await fold.trigger('click')
      expect(names()).toContain('Linux Foundation 2.0 root hub')
    })

    it('lists an unassigned CAN UUID, and shows an interface with nothing pending as its own row', async () => {
      const { machine, wrapper } = mountMachineView()
      machine.canbusInterfaces = [
        {
          interface: 'can0',
          bitrate: 500000,
          driver: 'mcp251x',
          uuids: [{ uuid: '11AABBCCDD', application: 'Klipper' }],
        },
        { interface: 'can1', bitrate: 1000000, driver: 'mcp251x', uuids: [] },
      ]
      await flushPromises()

      expect(wrapper.text()).toContain('Hardware')
      expect(wrapper.text()).toContain('11AABBCCDD')
      expect(wrapper.text()).toContain('can1')
      expect(wrapper.text()).toContain('No unassigned nodes')
    })

    it('asks the store to refresh peripherals from its own action', async () => {
      const { machine, wrapper } = mountMachineView()
      machine.serialDevices = [
        {
          device_type: 'hardware_uart',
          device_path: '/dev/ttyAMA0',
          device_name: 'ttyAMA0',
          driver_name: 'uart-pl011',
          path_by_hardware: null,
          path_by_id: null,
          usb_location: null,
        },
      ]
      const refreshPeripherals = vi.spyOn(machine, 'refreshPeripherals').mockResolvedValue()
      await flushPromises()

      // Icon-only, the same refresh/spinner shape as the Software updates
      // panel's own Check for updates control, so it is found by aria-label
      // rather than visible text.
      await wrapper.get('[aria-label="Refresh"]').trigger('click')

      expect(refreshPeripherals).toHaveBeenCalled()
    })
  })
})
