import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import BeltGuideCard from '@/components/calibration/BeltGuideCard.vue'
import { i18n } from '@/i18n'
import { usePrinterConfigStore } from '@/stores/printerConfig'

enableAutoUnmount(afterEach)

let pinia: Pinia

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

async function mountCard(kinematics: string): Promise<VueWrapper> {
  usePrinterConfigStore(pinia).settings = { printer: { kinematics } }
  const card = mount(BeltGuideCard, { global: { plugins: [i18n, pinia] } })
  await flushPromises()
  return card
}

async function openGuide(card: VueWrapper): Promise<void> {
  await card.find('[aria-controls="belt-guide-body"]').trigger('click')
  await flushPromises()
}

async function setField(card: VueWrapper, label: string, value: string): Promise<void> {
  const field = card.findAll('.app-field').find((candidate) => candidate.text().includes(label))
  if (!field) throw new Error(`no "${label}" field`)
  await field.find('input').setValue(value)
  await flushPromises()
}

describe('BeltGuideCard', () => {
  it('stays shut until asked for, and names the stepper behind each belt', async () => {
    const card = await mountCard('corexy')
    expect(card.find('#belt-guide-body').exists()).toBe(false)

    await openGuide(card)
    expect(card.text()).toContain('Belt A · stepper_y')
    expect(card.text()).toContain('Belt B · stepper_x')
  })

  it('names the looser belt from the typed peaks', async () => {
    const card = await mountCard('corexy')
    await openGuide(card)
    await setField(card, 'Belt A peaks', '78, 126')
    await setField(card, 'Belt B peaks', '84, 131')

    expect(card.text()).toContain('Belt A is looser')
    expect(card.text()).toContain('Tighten belt A in small steps')
  })

  it('finds the values typed on this printer again after a remount', async () => {
    const first = await mountCard('corexy')
    await openGuide(first)
    await setField(first, 'Belt A peaks', '78, 126')
    await setField(first, 'Toolhead mass', '800')
    first.unmount()

    const second = await mountCard('corexy')
    await openGuide(second)
    expect(second.findAll('input').map((input) => input.element.value)).toContain('78, 126')
    expect(second.findAll('input').map((input) => input.element.value)).toContain('800')
  })

  it('reports a peak entry it cannot read', async () => {
    const card = await mountCard('corexy')
    await openGuide(card)
    await setField(card, 'Belt A peaks', '78, abc')

    expect(card.find('[role="alert"]').text()).toBe('Frequencies in Hz, separated by commas.')
  })

  it('flags an axis something softer than the belts sets', async () => {
    const card = await mountCard('corexy')
    await openGuide(card)
    await setField(card, 'Belt A peaks', '80')
    await setField(card, 'Belt B peaks', '80')
    await setField(card, 'Toolhead mass', '800')
    await setField(card, 'Gantry mass', '600')
    await setField(card, 'X main peak', '91')
    await setField(card, 'Y main peak', '52')

    expect(card.text()).toContain('X: the belts set this axis.')
    expect(card.text()).toContain('Y: something softer than the belts sets this axis')
  })

  it('offers the cross-check on CoreXY only, and names CoreXZ belts as Shake&Tune does', async () => {
    const card = await mountCard('corexz')
    await openGuide(card)

    expect(card.text()).toContain('Belt X · stepper_x')
    expect(card.text()).toContain('Belt Z · stepper_z')
    expect(card.text()).not.toContain('Axis cross-check')
  })

  it('renders nothing on kinematics the belt test does not run on', async () => {
    const card = await mountCard('cartesian')
    expect(card.html()).toBe('<!--v-if-->')
  })
})
