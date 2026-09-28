import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ConfigurationTabWell from '@/components/machine/ConfigurationTabWell.vue'
import { i18n } from '@/i18n'
import type { MachineFileTab, OpenMachineFile } from '@/stores/machineFiles'

enableAutoUnmount(afterEach)

function file(name: string): OpenMachineFile {
  return { kind: 'file', name, path: name, modified: 1, size: 1, permissions: 'rw' }
}

function tabs(...names: string[]): MachineFileTab[] {
  return names.map((name) => ({ file: file(name), preview: false }))
}

/*
 * jsdom lays nothing out, so every tab measures 100px and the well 250px: two
 * tabs to a row, which is enough to give the well rows to fold.
 */
function layOut(tabWidth = 100, wellWidth = 250): void {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(tabWidth)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(wellWidth)
}

async function mountWell(
  props: Partial<InstanceType<typeof ConfigurationTabWell>['$props']> = {},
  { attach = false } = {},
) {
  const view = mount(ConfigurationTabWell, {
    attachTo: attach ? document.body : undefined,
    props: {
      pinned: [],
      tabs: tabs('a.cfg', 'b.cfg', 'c.cfg', 'd.cfg', 'e.cfg'),
      activePath: 'a.cfg',
      dirtyPaths: [],
      root: 'config',
      ...props,
    },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return view
}

/** Tab paths on screen, excluding the hidden measuring strip. */
function shownTabs(view: Awaited<ReturnType<typeof mountWell>>): string[] {
  return view
    .find('.document-tabs__rows')
    .findAll('[role="tab"]')
    .map((tab) => tab.attributes('data-tab-path')!)
}

function wheel(deltaY: number): WheelEvent {
  return new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
}

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('ConfigurationTabWell', () => {
  it('shows pinned files on a row of their own, ahead of the rest', async () => {
    const view = await mountWell({ pinned: [file('printer.cfg')] })

    const pinnedRow = view.find('.document-tabs__row--pinned')
    expect(pinnedRow.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(['printer.cfg'])
    expect(shownTabs(view)[0]).toBe('printer.cfg')
  })

  it('marks the file on screen as the selected tab and the one Tab stop', async () => {
    const view = await mountWell({ activePath: 'c.cfg' })

    const selected = view.find('.document-tabs__rows [aria-selected="true"]')
    expect(selected.attributes('data-tab-path')).toBe('c.cfg')
    expect(selected.attributes('aria-current')).toBe('true')
    expect(view.findAll('.document-tabs__rows [role="tab"][tabindex="0"]')).toHaveLength(1)
  })

  it('states an unsaved tab in words as well as colour', async () => {
    const view = await mountWell({ dirtyPaths: ['b.cfg'] })

    const tab = view.find('.document-tabs__rows [data-tab-path="b.cfg"]')
    expect(tab.text()).toContain('Unsaved')
    expect(tab.find('.document-tab__dirty-dot').exists()).toBe(true)
  })

  it('folds its rows on a wheel up and brings them back on a wheel down', async () => {
    layOut()
    const view = await mountWell()
    expect(shownTabs(view)).toEqual(['a.cfg', 'b.cfg', 'c.cfg', 'd.cfg', 'e.cfg'])

    const up = wheel(-120)
    view.find('.document-tabs').element.dispatchEvent(up)
    await flushPromises()
    expect(up.defaultPrevented).toBe(true)
    expect(shownTabs(view)).toEqual(['a.cfg', 'b.cfg'])
    expect(view.find('.document-tabs__folded').text()).toBe('+3')

    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1000)
    const down = wheel(120)
    view.find('.document-tabs').element.dispatchEvent(down)
    await flushPromises()
    expect(down.defaultPrevented).toBe(true)
    expect(shownTabs(view)).toHaveLength(5)
  })

  it('leaves the wheel to the page when there is nothing to fold', async () => {
    layOut(100, 1000)
    const view = await mountWell()

    const up = wheel(-120)
    view.find('.document-tabs').element.dispatchEvent(up)
    expect(up.defaultPrevented).toBe(false)
  })

  it('leaves the wheel to the page when the well is already the way it asks', async () => {
    layOut()
    const view = await mountWell()

    const down = wheel(120)
    view.find('.document-tabs').element.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
  })

  it('toggles once per gesture, however many events the gesture sends', async () => {
    layOut()
    const view = await mountWell()
    const well = view.find('.document-tabs').element

    for (let index = 0; index < 10; index += 1) well.dispatchEvent(wheel(-30))
    for (let index = 0; index < 10; index += 1) well.dispatchEvent(wheel(30))
    await flushPromises()

    expect(shownTabs(view)).toEqual(['a.cfg', 'b.cfg'])
  })

  it('never folds away the tab on screen', async () => {
    layOut()
    localStorage.setItem('alabaster.machine.tabRowsCollapsed', 'true')
    const view = await mountWell({ activePath: 'e.cfg' })

    expect(shownTabs(view)).toContain('e.cfg')
    expect(shownTabs(view)).toHaveLength(2)
  })

  it('folds and unfolds from the chevron too', async () => {
    layOut()
    const view = await mountWell()
    const toggle = view.find('.document-tabs__tools button[aria-expanded]')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(shownTabs(view)).toHaveLength(2)
    expect(
      view.find('.document-tabs__tools button[aria-expanded]').attributes('aria-expanded'),
    ).toBe('false')
  })

  it('moves focus with the arrow keys and closes with Delete', async () => {
    const view = await mountWell({ pinned: [file('printer.cfg')] }, { attach: true })
    const rows = view.find('.document-tabs__rows')
    const first = rows.find('[data-tab-path="a.cfg"]')

    await first.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement?.getAttribute('data-tab-path')).toBe('b.cfg')
    await first.trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement?.getAttribute('data-tab-path')).toBe('printer.cfg')
    await first.trigger('keydown', { key: 'End' })
    expect(document.activeElement?.getAttribute('data-tab-path')).toBe('e.cfg')
    expect(view.emitted('activate')).toBeUndefined()

    await first.trigger('keydown', { key: 'Delete' })
    expect(view.emitted('close')).toEqual([['a.cfg']])

    await rows.find('[data-tab-path="printer.cfg"]').trigger('keydown', { key: 'Delete' })
    expect(view.emitted('close')).toEqual([['a.cfg'], ['printer.cfg']])
  })

  it('closes an unpinned tab on a middle click, and keeps a preview on a double click', async () => {
    const view = await mountWell({ tabs: [{ file: file('a.cfg'), preview: true }] })
    const tab = view.find('.document-tabs__rows [data-tab-path="a.cfg"]')

    await tab.trigger('dblclick')
    expect(view.emitted('keep')).toEqual([['a.cfg']])

    await tab.trigger('auxclick', { button: 1 })
    expect(view.emitted('close')).toEqual([['a.cfg']])
  })

  it('offers both pin and close on every tab', async () => {
    const view = await mountWell({ pinned: [file('printer.cfg')] })
    const pinned = view.find('.document-tabs__row--pinned')
    const open = view.find('.document-tabs__rows [data-tab-path="a.cfg"]').element.parentElement!

    await pinned.find('.document-tab__control--pin').trigger('click')
    await pinned.find('.document-tab__control--close').trigger('click')
    open.querySelector<HTMLElement>('.document-tab__control--pin')!.click()

    expect(view.emitted('unpin')).toEqual([['printer.cfg']])
    expect(view.emitted('close')).toEqual([['printer.cfg']])
    expect(view.emitted('pin')).toEqual([['a.cfg']])
  })

  it('names a pinned tab’s pin as its action rather than pressing it', async () => {
    const view = await mountWell({ pinned: [file('printer.cfg')] })
    const pinnedPin = view.find('.document-tabs__row--pinned .document-tab__control--pin')
    const openPin = view
      .find('.document-tabs__rows [data-tab-path="a.cfg"]')
      .element.parentElement!.querySelector('.document-tab__control--pin')!

    expect(pinnedPin.attributes('aria-pressed')).toBeUndefined()
    expect(pinnedPin.attributes('aria-label')).toBe('Unpin printer.cfg')
    expect(openPin.getAttribute('aria-pressed')).toBeNull()
    expect(openPin.getAttribute('aria-label')).toBe('Pin a.cfg')
  })

  it('divides pinned tabs from the rest only when both are there', async () => {
    const both = await mountWell({ pinned: [file('printer.cfg')] })
    expect(both.find('.document-tabs__row--divided').exists()).toBe(true)

    const pinnedOnly = await mountWell({ pinned: [file('printer.cfg')], tabs: [] })
    expect(pinnedOnly.find('.document-tabs__row--divided').exists()).toBe(false)
  })
})
