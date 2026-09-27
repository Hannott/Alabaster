import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrintersStore } from '@/stores/printers'
import { normalizeZMotion, useZMotionStore } from '@/stores/zMotion'

beforeEach(() => {
  window.localStorage.clear()
  setActivePinia(createPinia())
})

describe('zMotion store', () => {
  it('defaults to a nozzle that Z+ moves up', () => {
    const zMotion = useZMotionStore()
    expect(zMotion.motion).toEqual({ movingPart: 'nozzle', zPlus: 'up' })
    expect(zMotion.zPlusIsUp).toBe(true)
    expect(zMotion.stored).toBeNull()
  })

  it("resets Z+ to the chosen part's usual direction rather than carrying the other part's", () => {
    const zMotion = useZMotionStore()
    zMotion.setZPlus('down')
    expect(zMotion.motion).toEqual({ movingPart: 'nozzle', zPlus: 'down' })

    zMotion.setMovingPart('bed')
    expect(zMotion.motion).toEqual({ movingPart: 'bed', zPlus: 'down' })
    expect(zMotion.zPlusIsUp).toBe(false)

    zMotion.setZPlus('up')
    zMotion.setMovingPart('nozzle')
    expect(zMotion.motion).toEqual({ movingPart: 'nozzle', zPlus: 'up' })
  })

  it('keeps one answer per printer', async () => {
    const printers = usePrintersStore()
    const first = printers.addPrinter('ws://first.local:7125/websocket')
    const second = printers.addPrinter('ws://second.local:7125/websocket')
    const zMotion = useZMotionStore()

    printers.selectPrinter(first!.id)
    await nextTick()
    zMotion.setMovingPart('bed')
    printers.selectPrinter(second!.id)
    await nextTick()
    expect(zMotion.motion.movingPart).toBe('nozzle')
    printers.selectPrinter(first!.id)
    await nextTick()
    expect(zMotion.motion.movingPart).toBe('bed')
  })

  /**
   * The per-card checkbox this replaced flipped only the Z slider, which is
   * what a bed that Z+ moves down draws — so a layout that had it on keeps
   * that picture until the printer is given an answer of its own.
   */
  it("reads the old per-card swapZDirection as a bed Z+ moves down, until the printer's own answer exists", () => {
    const layout = useDashboardLayoutStore()
    const movement = layout.profile.instances.find((instance) => instance.moduleId === 'movement')
    layout.updateConfig(movement!.instanceId, { swapZDirection: true })
    const zMotion = useZMotionStore()

    expect(zMotion.motion).toEqual({ movingPart: 'bed', zPlus: 'down' })

    zMotion.setMovingPart('nozzle')
    expect(zMotion.motion).toEqual({ movingPart: 'nozzle', zPlus: 'up' })
  })

  it('has no choice to offer on a delta, where only the effector moves', () => {
    const zMotion = useZMotionStore()
    zMotion.setMovingPart('bed')
    usePrinterConfigStore().settings = { printer: { kinematics: 'delta' } }
    expect(zMotion.motion).toEqual({ movingPart: 'nozzle', zPlus: 'up' })
  })

  it('accepts only a known part and direction', () => {
    expect(normalizeZMotion({ movingPart: 'bed', zPlus: 'down' })).toEqual({
      movingPart: 'bed',
      zPlus: 'down',
    })
    expect(normalizeZMotion({ movingPart: 'gantry', zPlus: 'up' })).toBeNull()
    expect(normalizeZMotion({ movingPart: 'bed' })).toBeNull()
  })
})
