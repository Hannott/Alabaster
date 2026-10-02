import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import ExcludeObjectDialog from '@/components/ExcludeObjectDialog.vue'
import { i18n } from '@/i18n'
import { useExcludeObjectStore } from '@/stores/excludeObject'
import { usePrinterStore } from '@/stores/printer'

enableAutoUnmount(afterEach)

let pinia: Pinia

beforeAll(() => {
  // jsdom ships <dialog> without its modal methods.
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

beforeEach(() => {
  window.localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

function square(x: number, y: number, size: number): [number, number][] {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ]
}

async function mountDialog() {
  const printer = usePrinterStore()
  printer.buildVolume.minimum = [0, 0, 0]
  printer.buildVolume.maximum = [200, 100, 200]
  const excludeObject = useExcludeObjectStore()
  excludeObject.objects = [
    { name: 'small', center: [15, 15], polygon: square(10, 10, 10), area: 100 },
    { name: 'large', center: [50, 50], polygon: square(0, 0, 100), area: 10000 },
    { name: 'dot', center: [150, 50], polygon: null, area: 0 },
  ]
  excludeObject.currentObjectName = 'large'
  const exclude = vi.spyOn(printer, 'excludeObject').mockResolvedValue(true)

  const wrapper = mount(ExcludeObjectDialog, {
    props: { open: true },
    global: { plugins: [pinia, i18n] },
  })
  await flushPromises()
  return { wrapper, printer, exclude }
}

describe('ExcludeObjectDialog map', () => {
  it('draws the largest outline first so a small part on top of it stays reachable', async () => {
    const { wrapper } = await mountDialog()

    const drawn = wrapper.findAll('.exclude-map__object')
    expect(drawn).toHaveLength(3)
    expect(drawn[0]?.classes()).toContain('exclude-map__object--current')
    expect(drawn[0]?.find('polygon').exists()).toBe(true)
    // A centre-only object is still placed, as a mark rather than an outline.
    expect(drawn.some((object) => object.find('circle').exists())).toBe(true)
  })

  it('only picks an object out when pressed on the map, and never excludes it', async () => {
    const { wrapper, exclude } = await mountDialog()

    const small = wrapper
      .findAll('.exclude-map__object')
      .find(
        (object) =>
          !object.classes().includes('exclude-map__object--current') &&
          object.find('polygon').exists(),
      )!
    await small.trigger('click')

    expect(exclude).not.toHaveBeenCalled()
    expect(wrapper.find('.exclude-object-caption').text()).toBe('small')
    const row = wrapper
      .findAll('.exclude-object-row')
      .find((candidate) => candidate.text().includes('small'))!
    expect(row.classes()).toContain('selection-row--selected')
  })

  it('names the printing object under the map until something else is picked out', async () => {
    const { wrapper } = await mountDialog()

    expect(wrapper.find('.exclude-object-caption').text()).toContain('large')
    expect(wrapper.find('.exclude-object-caption').text()).toContain('Printing now')
  })

  it('highlights an object on the map while its row is hovered', async () => {
    const { wrapper } = await mountDialog()

    const row = wrapper
      .findAll('.exclude-object-row')
      .find((candidate) => candidate.text().includes('dot'))!
    await row.trigger('pointerenter')

    const highlighted = wrapper.findAll('.exclude-map__object--highlighted')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0]?.find('circle').exists()).toBe(true)
  })

  it('draws the nozzle only once X and Y are homed', async () => {
    const { wrapper, printer } = await mountDialog()
    printer.motion.position = [40, 40, 5]
    await flushPromises()
    expect(wrapper.find('.exclude-map .bed-plan__nozzle').exists()).toBe(false)

    printer.motion.homedAxes = 'xyz'
    await flushPromises()
    expect(wrapper.find('.exclude-map .bed-plan__nozzle').exists()).toBe(true)
  })
})
