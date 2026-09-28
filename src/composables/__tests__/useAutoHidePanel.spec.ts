import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'

import {
  AUTO_HIDE_CLOSE_DELAY_MS,
  AUTO_HIDE_OPEN_DELAY_MS,
  useAutoHidePanel,
} from '@/composables/useAutoHidePanel'

enableAutoUnmount(afterEach)

let strip: HTMLElement
let panel: HTMLElement
let pin: HTMLButtonElement
let outside: HTMLElement

function pointer(type: string, pointerType = 'mouse', relatedTarget: EventTarget | null = null) {
  const event = new Event(type, { bubbles: true }) as PointerEvent
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    relatedTarget: { value: relatedTarget },
  })
  return event
}

function setup({ busy = (): boolean => false }: { busy?: () => boolean } = {}) {
  const enabled = ref(true)
  let api!: ReturnType<typeof useAutoHidePanel>
  mount(
    defineComponent({
      setup() {
        api = useAutoHidePanel({
          enabled,
          regions: () => [panel, strip],
          busy,
          returnFocus: () => pin,
        })
        return () => null
      },
    }),
  )
  return { enabled, api }
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
  strip = document.createElement('div')
  panel = document.createElement('div')
  pin = document.createElement('button')
  outside = document.createElement('div')
  strip.append(pin)
  document.body.append(panel, strip, outside)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAutoHidePanel', () => {
  it('opens after a moment of hover on the strip, not at once', () => {
    const { api } = setup()

    api.onStripPointerEnter(pointer('pointerenter'))
    vi.advanceTimersByTime(AUTO_HIDE_OPEN_DELAY_MS - 1)
    expect(api.open.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(api.open.value).toBe(true)
  })

  // A pointer that only crosses the strip on its way somewhere should not throw the panel open.
  it('does not open for a pointer that leaves before the intent delay', () => {
    const { api } = setup()

    api.onStripPointerEnter(pointer('pointerenter'))
    api.onPointerLeave(pointer('pointerleave', 'mouse', outside))
    vi.advanceTimersByTime(AUTO_HIDE_OPEN_DELAY_MS * 2)
    expect(api.open.value).toBe(false)
  })

  it('leaves a touch to the tap it is part of', () => {
    const { api } = setup()

    api.onStripPointerEnter(pointer('pointerenter', 'touch'))
    vi.advanceTimersByTime(AUTO_HIDE_OPEN_DELAY_MS * 2)
    expect(api.open.value).toBe(false)
  })

  it('slides away once the pointer has left both the strip and the panel', () => {
    const { api } = setup()
    api.show()

    api.onPointerLeave(pointer('pointerleave', 'mouse', panel))
    vi.advanceTimersByTime(AUTO_HIDE_CLOSE_DELAY_MS * 2)
    expect(api.open.value).toBe(true)

    api.onPointerLeave(pointer('pointerleave', 'mouse', outside))
    vi.advanceTimersByTime(AUTO_HIDE_CLOSE_DELAY_MS - 1)
    expect(api.open.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(api.open.value).toBe(false)
  })

  it('stays out while the work it started is still open, then goes', () => {
    let busy = true
    const { api } = setup({ busy: () => busy })
    api.show()

    api.onPointerLeave(pointer('pointerleave', 'mouse', outside))
    vi.advanceTimersByTime(AUTO_HIDE_CLOSE_DELAY_MS * 3)
    expect(api.open.value).toBe(true)

    busy = false
    vi.advanceTimersByTime(AUTO_HIDE_CLOSE_DELAY_MS)
    expect(api.open.value).toBe(false)
  })

  it('goes at once on a press anywhere else, but not on one inside', async () => {
    const { api } = setup()
    api.show()
    await nextTick()

    panel.dispatchEvent(pointer('pointerdown'))
    expect(api.open.value).toBe(true)
    outside.dispatchEvent(pointer('pointerdown'))
    expect(api.open.value).toBe(false)
  })

  it('goes on Escape and hands focus back to the pin', async () => {
    const { api } = setup()
    const field = document.createElement('input')
    panel.append(field)
    api.show()
    await nextTick()
    field.focus()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(api.open.value).toBe(false)
    expect(document.activeElement).toBe(pin)
  })

  it('closes and stops listening when it is pinned', async () => {
    const { enabled, api } = setup()
    api.show()

    enabled.value = false
    await nextTick()
    expect(api.open.value).toBe(false)

    api.onStripPointerEnter(pointer('pointerenter'))
    vi.advanceTimersByTime(AUTO_HIDE_OPEN_DELAY_MS * 2)
    api.show()
    expect(api.open.value).toBe(false)
  })
})
