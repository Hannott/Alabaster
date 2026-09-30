import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { normalizeBeltGuideValues, useBeltGuideStore } from '@/stores/beltGuide'
import { usePrintersStore } from '@/stores/printers'

beforeEach(() => {
  window.localStorage.clear()
  setActivePinia(createPinia())
})

describe('beltGuide store', () => {
  it('stores nothing until something is typed', () => {
    const beltGuide = useBeltGuideStore()
    expect(beltGuide.stored).toBeNull()
    expect(beltGuide.values.unpaired).toBe(0)

    beltGuide.update({ toolheadGrams: 800 })
    expect(beltGuide.stored).toMatchObject({ toolheadGrams: 800, firstPeaks: '' })

    beltGuide.update({ toolheadGrams: null })
    expect(beltGuide.stored).toBeNull()
  })

  it('keeps one set of values per printer', async () => {
    const printers = usePrintersStore()
    const first = printers.addPrinter('ws://first.local:7125/websocket')
    const second = printers.addPrinter('ws://second.local:7125/websocket')
    const beltGuide = useBeltGuideStore()

    printers.selectPrinter(first!.id)
    await nextTick()
    beltGuide.update({ toolheadGrams: 800, firstPeaks: '78, 126' })
    printers.selectPrinter(second!.id)
    await nextTick()
    expect(beltGuide.values.toolheadGrams).toBeNull()
    beltGuide.update({ toolheadGrams: 1200 })
    printers.selectPrinter(first!.id)
    await nextTick()
    expect(beltGuide.values).toMatchObject({ toolheadGrams: 800, firstPeaks: '78, 126' })
  })

  it('survives a reload', () => {
    useBeltGuideStore().update({ gantryGrams: 600, atTarget: 1 })
    setActivePinia(createPinia())
    expect(useBeltGuideStore().values).toMatchObject({ gantryGrams: 600, atTarget: 1 })
  })

  it('repairs field by field rather than discarding the whole value', () => {
    expect(
      normalizeBeltGuideValues({
        firstPeaks: 78,
        secondPeaks: '84',
        unpaired: -2,
        atTarget: 2,
        toolheadGrams: 800,
        gantryGrams: -1,
        xPeak: 'fast',
        yPeak: 52,
      }),
    ).toEqual({
      firstPeaks: '',
      secondPeaks: '84',
      unpaired: 0,
      atTarget: null,
      toolheadGrams: 800,
      gantryGrams: null,
      xPeak: null,
      yPeak: 52,
    })
    expect(normalizeBeltGuideValues('nope')).toBeNull()
  })
})
