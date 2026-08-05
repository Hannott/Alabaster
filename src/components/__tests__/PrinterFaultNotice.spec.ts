import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PrinterFaultNotice from '@/components/PrinterFaultNotice.vue'
import { i18n } from '@/i18n'
import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { usePrinterStore } from '@/stores/printer'

let pinia: Pinia
let router: Router

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'overview', component: { template: '<div />' } },
      { path: '/configuration', name: 'configuration', component: { template: '<div />' } },
    ],
  })
})

async function mountNotice() {
  const notice = mount(PrinterFaultNotice, { global: { plugins: [pinia, i18n, router] } })
  await router.isReady()
  await flushPromises()
  return notice
}

/** Klipper connected and reporting a terminal state, which is what a failed boot looks like. */
function faultState(message: string): void {
  const availability = useAvailabilityStore(pinia)
  availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'error' })
  availability.reportKlipperMessage(message)
}

describe('PrinterFaultNotice', () => {
  it('stays out of the way until Klipper reports a terminal state', async () => {
    const notice = await mountNotice()
    const availability = useAvailabilityStore(pinia)

    availability.moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
    availability.printerSnapshotSynchronized()
    await nextTick()
    expect(notice.find('.printer-fault').exists()).toBe(false)

    // An ordinary restart is a transition the header reports; this is not it.
    availability.handleKlipperNotification('notify_klippy_disconnected')
    await nextTick()
    expect(notice.find('.printer-fault').exists()).toBe(false)

    availability.handleKlipperNotification('notify_klippy_shutdown')
    await nextTick()
    expect(notice.find('.printer-fault').exists()).toBe(true)
  })

  it('quotes Klipper verbatim, line breaks and all', async () => {
    const notice = await mountNotice()
    faultState("MCU 'mcu' shutdown: ADC out of range\nheater: extruder, last_temp: 2088599.27")
    await nextTick()

    const message = notice.get('.printer-fault__message')
    expect(message.text()).toContain("MCU 'mcu' shutdown: ADC out of range")
    expect(message.text()).toContain('last_temp: 2088599.27')
    // The reader has to be able to copy this into a search or a forum post.
    expect(message.classes()).toContain('selectable')
    expect(notice.get('.printer-fault__title').text()).toBe('Klipper could not start')
  })

  it('offers both restarts and reaches the logs where they already live', async () => {
    const notice = await mountNotice()
    const printer = usePrinterStore(pinia)
    const machineFiles = useMachineFilesStore(pinia)
    const firmwareRestart = vi.spyOn(printer, 'firmwareRestart').mockResolvedValue(true)
    const restartKlipper = vi.spyOn(printer, 'restartKlipper').mockResolvedValue(true)
    const setRoot = vi.spyOn(machineFiles, 'setRoot').mockResolvedValue(true)
    faultState('Option not valid in section')
    await nextTick()

    const actions = notice.findAll('.printer-fault__actions button')
    expect(actions).toHaveLength(3)
    // The one Klipper's own shutdown text tells the reader to use leads.
    expect(actions[0]!.classes()).toContain('button--primary')

    await actions[0]!.trigger('click')
    await actions[1]!.trigger('click')
    await actions[2]!.trigger('click')
    await flushPromises()

    expect(firmwareRestart).toHaveBeenCalledOnce()
    expect(restartKlipper).toHaveBeenCalledOnce()
    expect(setRoot).toHaveBeenCalledWith('logs')
    expect(router.currentRoute.value.name).toBe('configuration')
  })

  it('collapses to its heading so a config can be repaired underneath it', async () => {
    const notice = await mountNotice()
    faultState('Option not valid in section')
    await nextTick()

    const toggle = notice.get('.printer-fault__heading button')
    expect(toggle.attributes('aria-expanded')).toBe('true')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(notice.find('.printer-fault__message').exists()).toBe(false)
    // The state itself never hides: that is what the notice is for.
    expect(notice.get('.printer-fault__title').text()).toBe('Klipper could not start')

    // A different fault is a different thing to read.
    useAvailabilityStore(pinia).reportKlipperMessage('Lost communication with MCU')
    await nextTick()
    expect(toggle.attributes('aria-expanded')).toBe('true')
  })
})
