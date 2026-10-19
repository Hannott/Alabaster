import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import AppTooltipHost from '@/components/AppTooltipHost.vue'
import { useTooltipPreferences } from '@/composables/useTooltipPreferences'

function pointerOver(target: Element, x = 100, y = 200): void {
  const event = new MouseEvent('pointerover', { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  target.dispatchEvent(event)
}

describe('AppTooltipHost', () => {
  let wrapper: VueWrapper
  let button: HTMLButtonElement

  beforeEach(() => {
    vi.useFakeTimers()
    useTooltipPreferences().reset()
    document.body.innerHTML = '<button id="b" title="Home all axes">Home</button>'
    button = document.getElementById('b') as HTMLButtonElement
    wrapper = mount(defineComponent({ render: () => h(AppTooltipHost) }), {
      attachTo: document.body,
    })
  })

  afterEach(() => {
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('shows after the hover delay and not before', async () => {
    pointerOver(button)
    await vi.advanceTimersByTimeAsync(299)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Home all axes')
  })

  it('takes the title off while hovered so the browser shows nothing of its own', async () => {
    pointerOver(button)
    expect(button.hasAttribute('title')).toBe(false)
    expect(button.getAttribute('aria-describedby')).toBe('app-tooltip')

    pointerOver(document.body)
    expect(button.getAttribute('title')).toBe('Home all axes')
    expect(button.hasAttribute('aria-describedby')).toBe(false)
  })

  it('uses the reader’s delay and animation length', async () => {
    const tooltips = useTooltipPreferences()
    tooltips.setDelayMs(0)
    tooltips.setDurationMs(900)
    tooltips.setAnimate(false)

    pointerOver(button)
    await vi.advanceTimersByTimeAsync(0)
    const tip = document.querySelector<HTMLElement>('[role="tooltip"]')
    expect(tip?.dataset.mode).toBe('fade')
    expect(tip?.style.getPropertyValue('--tip-t')).toBe('900ms')
  })

  it('does not show for a press, and fades out when the pointer leaves', async () => {
    pointerOver(button)
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(500)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    pointerOver(button)
    pointerOver(document.body)
    pointerOver(button)
    await vi.advanceTimersByTimeAsync(300)
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()

    pointerOver(document.body)
    await nextTick()
    expect(document.querySelector<HTMLElement>('[role="tooltip"]')?.dataset.leaving).toBe('true')
    await vi.advanceTimersByTimeAsync(80)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('ignores touch', async () => {
    const event = new MouseEvent('pointerover', { bubbles: true })
    Object.defineProperty(event, 'pointerType', { value: 'touch' })
    button.dispatchEvent(event)
    await vi.advanceTimersByTimeAsync(500)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(button.getAttribute('title')).toBe('Home all axes')
  })
})
