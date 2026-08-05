import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import FilamentCatalogueDialog from '@/components/FilamentCatalogueDialog.vue'
import { i18n } from '@/i18n'
import { useSpoolStore } from '@/stores/spool'

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods, so the shared shell's
  // open/close watcher has nothing to call — copied from SettingsView.spec.ts.
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

function mountDialog() {
  return mount(FilamentCatalogueDialog, {
    props: { open: true },
    global: { plugins: [i18n] },
  })
}

async function typeQuery(wrapper: ReturnType<typeof mountDialog>, value: string): Promise<void> {
  await wrapper.get('input[type="search"]').setValue(value)
}

describe('FilamentCatalogueDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  it('shows a prompt to search rather than calling out on an empty field', async () => {
    const wrapper = mountDialog()
    expect(wrapper.text()).toContain('Start typing a manufacturer, name, or material.')
  })

  it('debounces the search, calling the store once 300ms after typing settles', async () => {
    const spool = useSpoolStore()
    const search = vi.spyOn(spool, 'searchExternalFilaments').mockResolvedValue({
      filaments: [],
      failed: false,
    })
    const wrapper = mountDialog()

    await typeQuery(wrapper, 'prusament')
    await vi.advanceTimersByTimeAsync(200)
    expect(search).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(150)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('prusament')
  })

  it('resets the debounce on every keystroke, so mid-typing never fires a search', async () => {
    const spool = useSpoolStore()
    const search = vi.spyOn(spool, 'searchExternalFilaments').mockResolvedValue({
      filaments: [],
      failed: false,
    })
    const wrapper = mountDialog()

    await typeQuery(wrapper, 'p')
    await vi.advanceTimersByTimeAsync(200)
    await typeQuery(wrapper, 'pr')
    await vi.advanceTimersByTimeAsync(200)
    await typeQuery(wrapper, 'pru')
    await vi.advanceTimersByTimeAsync(300)

    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('pru')
  })

  it('drops a stale response in favor of a newer query’s answer', async () => {
    const spool = useSpoolStore()
    let resolveFirst: ((value: { filaments: never[]; failed: boolean }) => void) | undefined
    vi.spyOn(spool, 'searchExternalFilaments').mockImplementation((query) => {
      if (query === 'slow') {
        return new Promise((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve({
        filaments: [{ id: 'fast-1', manufacturer: 'Fast', name: 'Match', material: 'PLA' }],
        failed: false,
      })
    })
    const wrapper = mountDialog()

    await typeQuery(wrapper, 'slow')
    await vi.advanceTimersByTimeAsync(300)
    await typeQuery(wrapper, 'fast')
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.text()).toContain('Fast Match')

    // The slow request finally resolves after the newer one already rendered —
    // it must not overwrite what the user is now looking at.
    resolveFirst?.({ filaments: [], failed: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.text()).toContain('Fast Match')
  })

  it('shows a distinct message for zero matches versus a failed lookup', async () => {
    const spool = useSpoolStore()
    const search = vi.spyOn(spool, 'searchExternalFilaments')
    const wrapper = mountDialog()

    search.mockResolvedValueOnce({ filaments: [], failed: false })
    await typeQuery(wrapper, 'nonsense')
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.text()).toContain('No filaments matched that search.')

    search.mockResolvedValueOnce({ filaments: [], failed: true })
    await typeQuery(wrapper, 'again')
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.text()).toContain('The catalogue could not be reached.')
  })

  it('emits the picked filament and closes on row click', async () => {
    const spool = useSpoolStore()
    vi.spyOn(spool, 'searchExternalFilaments').mockResolvedValue({
      filaments: [
        {
          id: 'prusament_pla_galaxy_black_1000_175',
          manufacturer: 'Prusament',
          name: 'PLA Galaxy Black',
          material: 'PLA',
          extruder_temp: 215,
          bed_temp: 60,
        },
      ],
      failed: false,
    })
    const wrapper = mountDialog()

    await typeQuery(wrapper, 'prusament')
    await vi.advanceTimersByTimeAsync(300)

    await wrapper.get('.filament-catalogue-dialog__list button').trigger('click')

    expect(wrapper.emitted('select')).toEqual([
      [{ name: 'Prusament PLA Galaxy Black', extruder: 215, bed: 60 }],
    ])
  })

  it('emits cancel from the close button and from Escape', async () => {
    const wrapper = mountDialog()

    await wrapper.get('button[aria-label="Close"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)

    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('cancel')).toHaveLength(2)
  })

  it('resets the search when reopened, so a previous session’s results are never shown stale', async () => {
    const spool = useSpoolStore()
    vi.spyOn(spool, 'searchExternalFilaments').mockResolvedValue({
      filaments: [{ id: 'a', manufacturer: 'Foo', name: 'Bar', material: 'PLA' }],
      failed: false,
    })
    const wrapper = mount(FilamentCatalogueDialog, {
      props: { open: false },
      global: { plugins: [i18n] },
    })

    await wrapper.setProps({ open: true })
    await typeQuery(wrapper, 'foo')
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.text()).toContain('Foo Bar')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect((wrapper.get('input[type="search"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).toContain('Start typing a manufacturer, name, or material.')
  })
})
