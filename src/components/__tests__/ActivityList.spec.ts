import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ActivityList from '@/components/ActivityList.vue'
import { i18n } from '@/i18n'
import { usePrinterStore, type PrinterActivity } from '@/stores/printer'

function makeActivity(id: number, overrides: Partial<PrinterActivity> = {}): PrinterActivity {
  return {
    id,
    kind: 'command',
    titleKey: 'dashboard.activity.commandSent',
    createdAt: 1_700_000_000_000 + id,
    ...overrides,
  }
}

function mountList(variant: 'card' | 'menu', activities: PrinterActivity[]) {
  const pinia = createPinia()
  const wrapper = mount(ActivityList, {
    props: { variant },
    global: { plugins: [pinia, i18n] },
  })
  const printer = usePrinterStore(pinia)
  printer.activities = activities
  return wrapper
}

describe('ActivityList', () => {
  it('renders each surface’s own empty state for the shared empty message', async () => {
    const card = mountList('card', [])
    const menu = mountList('menu', [])
    await Promise.resolve()

    expect(card.find('ol').exists()).toBe(false)
    expect(card.get('p').classes()).toContain('text-muted')
    expect(menu.get('p').classes()).toContain('header-menu__empty')
    expect(card.get('p').text()).toBe(menu.get('p').text())
  })

  it('windows the feed to six rows and renders identical row content on both surfaces', async () => {
    const activities = Array.from({ length: 8 }, (_, index) =>
      makeActivity(index + 1, index === 0 ? { detail: 'M112' } : {}),
    )
    const card = mountList('card', activities)
    const menu = mountList('menu', activities)
    await card.vm.$nextTick()
    await menu.vm.$nextTick()

    expect(card.get('ol').classes()).toContain('gap-1')
    expect(menu.get('ul').classes()).toContain('gap-0.5')
    expect(card.findAll('li')).toHaveLength(6)
    expect(menu.findAll('li')).toHaveLength(6)
    expect(card.findAll('li').map((row) => row.text())).toEqual(
      menu.findAll('li').map((row) => row.text()),
    )
    expect(card.get('li').text()).toContain('M112')
    expect(card.get('time').attributes('datetime')).toBe(
      new Date(activities[0]!.createdAt).toISOString(),
    )
  })
})
