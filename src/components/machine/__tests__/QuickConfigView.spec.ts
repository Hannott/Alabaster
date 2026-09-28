import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import QuickConfigView from '@/components/machine/QuickConfigView.vue'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useQuickConfigStore } from '@/stores/quickConfig'

const disk: Record<string, string> = {
  'printer.cfg': '[printer]\nmax_accel: 5000\n\n[input_shaper]\nshaper_freq_x: 53.8\n',
}

function stubFiles(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const url = String(input)
      if (init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({})))
      const path = decodeURIComponent(new URL(url).pathname.split('/server/files/config/')[1] ?? '')
      const text = disk[path]
      return Promise.resolve(
        text === undefined ? new Response('', { status: 404 }) : new Response(text),
      )
    }),
  )
}

function mountView() {
  return mount(QuickConfigView, { global: { plugins: [i18n] } })
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  setActivePinia(createPinia())
  useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  const moonraker = useMoonrakerStore()
  moonraker.connectionPhase = 'connected'
  vi.spyOn(moonraker, 'rpcCall').mockImplementation((method: string) => {
    if (method === 'server.files.list') {
      return Promise.resolve(
        Object.keys(disk).map((path) => ({ path, modified: 1, size: 1, permissions: 'rw' })),
      ) as never
    }
    return Promise.resolve({}) as never
  })
  usePrinterConfigStore().settings = {
    printer: { max_accel: 5000 },
    input_shaper: { shaper_freq_x: 53.8 },
  }
  stubFiles()
})

describe('QuickConfigView card order', () => {
  it('moves a card earlier or later with the header buttons', async () => {
    const wrapper = mountView()
    await flushPromises()

    const titleOf = () => wrapper.findAll('.quick-config-card__title').map((title) => title.text())
    expect(titleOf()).toEqual(['[printer]', '[input_shaper]'])

    await wrapper.get('[aria-label="Move [printer] later"]').trigger('click')

    expect(titleOf()).toEqual(['[input_shaper]', '[printer]'])

    await wrapper.get('[aria-label="Move [input_shaper] later"]').trigger('click')

    expect(titleOf()).toEqual(['[printer]', '[input_shaper]'])
  })

  it('stores the arrangement the buttons made, and offers no column that is not there', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[aria-label="Move [printer] later"]').trigger('click')

    // jsdom lays nothing out, so the view measures room for one column.
    expect(useQuickConfigStore().storedColumns).toEqual([['input_shaper', 'printer']])
    expect(wrapper.find('[aria-label="Move [printer] to the next column"]').exists()).toBe(false)
  })
})
