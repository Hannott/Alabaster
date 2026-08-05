import { createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SpoolModule from '@/components/dashboard/modules/SpoolModule.vue'
import { i18n } from '@/i18n'
import { useJobQueueStore } from '@/stores/jobQueue'
import { usePrinterStore } from '@/stores/printer'
import { useSpoolStore } from '@/stores/spool'

function mountModule(pinia: ReturnType<typeof createPinia>) {
  return mount(SpoolModule, { global: { plugins: [pinia, i18n] } })
}

describe('SpoolModule', () => {
  it('says so when there is no active spool', async () => {
    const pinia = createPinia()
    const spool = useSpoolStore(pinia)
    vi.spyOn(spool, 'loadAvailableSpools').mockResolvedValue()
    const wrapper = mountModule(pinia)
    await flushPromises()

    expect(wrapper.text()).toContain('No active spool')
  })

  it('says so when Spoolman itself is not connected', async () => {
    const pinia = createPinia()
    const spool = useSpoolStore(pinia)
    vi.spyOn(spool, 'loadAvailableSpools').mockResolvedValue()
    spool.spoolmanConnected = false
    const wrapper = mountModule(pinia)
    await flushPromises()

    expect(wrapper.text()).toContain('Spoolman is not connected')
  })

  it('shows the loaded filament and how much of it is left', async () => {
    const pinia = createPinia()
    const spool = useSpoolStore(pinia)
    vi.spyOn(spool, 'loadAvailableSpools').mockResolvedValue()
    spool.activeSpoolId = 7
    spool.activeSpool = {
      id: 7,
      registered: '2026-01-01T00:00:00Z',
      used_weight: 258,
      used_length: 86000,
      remaining_weight: 742,
      remaining_length: 250000,
      archived: false,
      filament: {
        id: 1,
        name: 'PolyTerra PLA',
        material: 'PLA',
        color_hex: '2A9D8F',
        vendor: { id: 1, name: 'Polymaker' },
      },
    }
    const wrapper = mountModule(pinia)
    await flushPromises()

    expect(wrapper.text()).toContain('Polymaker')
    expect(wrapper.text()).toContain('PolyTerra PLA')
    expect(wrapper.text()).toContain('742g')
    expect(wrapper.text()).toContain('250.0m')
    const swatch = wrapper.find('.spool-swatch')
    expect(swatch.attributes('style')).toContain('rgb(42, 157, 143)')
  })

  it('warns when the spool cannot finish the print that is running', async () => {
    const pinia = createPinia()
    const spool = useSpoolStore(pinia)
    const printer = usePrinterStore(pinia)
    vi.spyOn(spool, 'loadAvailableSpools').mockResolvedValue()
    spool.activeSpoolId = 7
    spool.activeSpool = {
      id: 7,
      registered: '2026-01-01T00:00:00Z',
      used_weight: 900,
      used_length: 300000,
      remaining_weight: 100,
      remaining_length: 33000,
      archived: false,
      filament: { id: 1, material: 'PLA' },
    }
    printer.printStats.state = 'printing'
    printer.currentMetadata = { filename: 'vase.gcode', filament_weight_total: 220 }

    const wrapper = mountModule(pinia)
    await flushPromises()

    expect(wrapper.text()).toContain('Not enough filament left')
  })

  it('does not warn once the print already extruded enough of its own total to fit what remains', async () => {
    // A print that had plenty of filament when it started still draws that
    // same spool's `remaining_weight` down as it goes. Comparing the job's
    // whole-job total against the now-reduced remaining weight would call a
    // print that is exactly on track "short" — the real question is what
    // finishing it still takes, not what it needed at the first layer.
    const pinia = createPinia()
    const spool = useSpoolStore(pinia)
    const printer = usePrinterStore(pinia)
    vi.spyOn(spool, 'loadAvailableSpools').mockResolvedValue()
    spool.activeSpoolId = 7
    spool.activeSpool = {
      id: 7,
      registered: '2026-01-01T00:00:00Z',
      used_weight: 0,
      used_length: 0,
      remaining_weight: 137,
      archived: false,
      filament: { id: 1, material: 'PLA' },
    }
    printer.printStats.state = 'printing'
    printer.printStats.filamentUsed = 800
    printer.currentMetadata = {
      filename: 'vase.gcode',
      filament_weight_total: 148,
      filament_total: 2000,
    }

    const wrapper = mountModule(pinia)
    await flushPromises()

    expect(wrapper.text()).not.toContain('Not enough filament left')
  })

  it('stays quiet about a print already underway, even with plenty left to finish it', async () => {
    const pinia = createPinia()
    const spool = useSpoolStore(pinia)
    const printer = usePrinterStore(pinia)
    vi.spyOn(spool, 'loadAvailableSpools').mockResolvedValue()
    spool.activeSpoolId = 7
    spool.activeSpool = {
      id: 7,
      registered: '2026-01-01T00:00:00Z',
      used_weight: 0,
      used_length: 0,
      remaining_weight: 500,
      archived: false,
      filament: { id: 1, material: 'PLA' },
    }
    printer.printStats.state = 'printing'
    printer.currentMetadata = { filename: 'vase.gcode', filament_weight_total: 100 }

    const wrapper = mountModule(pinia)
    await flushPromises()

    // Plenty left for what remains of the active print, but the reassurance
    // is about the next print, not this one, so it stays quiet mid-job.
    expect(wrapper.text()).not.toContain('Enough filament for the next print')
  })

  it('reassures about a queued job the spool can finish', async () => {
    const pinia = createPinia()
    const spool = useSpoolStore(pinia)
    const printer = usePrinterStore(pinia)
    vi.spyOn(spool, 'loadAvailableSpools').mockResolvedValue()
    vi.spyOn(printer, 'loadMetadata').mockResolvedValue({
      filename: 'vase.gcode',
      filament_weight_total: 100,
    })
    spool.activeSpoolId = 7
    spool.activeSpool = {
      id: 7,
      registered: '2026-01-01T00:00:00Z',
      used_weight: 0,
      used_length: 0,
      remaining_weight: 500,
      archived: false,
      filament: { id: 1, material: 'PLA' },
    }
    useJobQueueStore(pinia).jobs = [
      { filename: 'vase.gcode', job_id: '1', time_added: 0, time_in_queue: 0 },
    ]

    const wrapper = mountModule(pinia)
    await flushPromises()

    expect(wrapper.text()).toContain('Enough filament for the next print')
  })

  it('switches the active spool through the switcher', async () => {
    const pinia = createPinia()
    const spool = useSpoolStore(pinia)
    vi.spyOn(spool, 'loadAvailableSpools').mockResolvedValue()
    spool.availableSpools = [
      {
        id: 3,
        registered: '2026-01-01T00:00:00Z',
        used_weight: 0,
        used_length: 0,
        archived: false,
        filament: { id: 2, name: 'PETG', vendor: { id: 2, name: 'Prusament' } },
      },
    ]
    const setActiveSpool = vi.spyOn(spool, 'setActiveSpool').mockResolvedValue(true)
    const wrapper = mountModule(pinia)
    await flushPromises()

    await wrapper.get('.app-select__trigger').trigger('click')
    // Teleported to `document.body` so a dashboard card's `overflow: hidden`
    // cannot clip it, so it is queried there rather than within `wrapper`.
    const options = [...document.body.querySelectorAll('.app-select__option')]
    const target = options.find((option) => option.textContent?.includes('PETG'))
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(setActiveSpool).toHaveBeenCalledWith(3)
  })
})
