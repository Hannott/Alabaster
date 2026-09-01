import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ConsoleTranscript from '@/components/console/ConsoleTranscript.vue'
import { i18n } from '@/i18n'
import type { ConsoleEntry } from '@/services/console/transcript'

const entries: ConsoleEntry[] = [
  { id: 1, kind: 'command', raw: 'G28', message: 'G28', at: 1_700_000_000_000 },
  {
    id: 2,
    kind: 'response',
    raw: '// Klipper state: Ready',
    message: 'Klipper state: Ready',
    at: 1_700_000_001_000,
  },
  {
    id: 3,
    kind: 'error',
    raw: '!! Move out of range',
    message: 'Move out of range',
    at: 1_700_000_002_000,
  },
  { id: 4, kind: 'debug', raw: '// debug:probe', message: 'probe', at: 1_700_000_003_000 },
]

function mountTranscript(props: Record<string, unknown> = {}) {
  return mount(ConsoleTranscript, {
    props: { entries, ...props },
    global: { plugins: [i18n] },
  })
}

describe('ConsoleTranscript', () => {
  it('is a log rather than a console, and scrollable from the keyboard', () => {
    const wrapper = mountTranscript()
    const log = wrapper.get('ol')
    expect(log.attributes('role')).toBe('log')
    expect(log.attributes('tabindex')).toBe('0')
    expect(log.find('input, textarea').exists()).toBe(false)
  })

  it('tags every line with its kind so styling never carries the meaning alone', () => {
    const wrapper = mountTranscript()
    expect(wrapper.findAll('.gcode-console__line').map((l) => l.attributes('data-kind'))).toEqual([
      'command',
      'response',
      'error',
      'debug',
    ])
  })

  it('names the kinds that change a line’s meaning for a screen reader', () => {
    // The gutter marker is decorative, so color and glyph both fail assistive
    // technology; the two kinds that matter say so in text.
    const wrapper = mountTranscript()
    const lines = wrapper.findAll('.gcode-console__line')
    expect(lines[0]?.get('.sr-only').text()).toBe('Sent')
    expect(lines[2]?.get('.sr-only').text()).toBe('Error')
    // A plain response is the default and would only make a long transcript
    // exhausting to listen to.
    expect(lines[1]?.find('.sr-only').exists()).toBe(false)
  })

  it('makes only a sent command clickable, and reports the raw text', () => {
    const wrapper = mountTranscript()
    const clickable = wrapper.findAll('.gcode-console__command')
    expect(clickable).toHaveLength(1)
    void clickable[0]?.trigger('click')
    expect(wrapper.emitted('command')).toEqual([['G28']])
  })

  it('carries the shared text-action class rather than restating its treatment', () => {
    // Registered as an instance of that pattern in button-system.md.
    expect(mountTranscript().get('.gcode-console__command').classes()).toContain('text-action')
  })

  it('shows Klipper’s own prefixes only when asked', () => {
    expect(mountTranscript().text()).not.toContain('!!')
    expect(mountTranscript({ rawOutput: true }).text()).toContain('!! Move out of range')
  })

  it('adds timestamps only when asked', () => {
    expect(mountTranscript().find('.gcode-console__time').exists()).toBe(false)
    expect(mountTranscript({ showTimestamps: true }).findAll('.gcode-console__time')).toHaveLength(
      4,
    )
  })

  it('sizes itself from a line count, or fills its parent', () => {
    // A stated count keeps the card's height derived from its own line height
    // rather than from a magic pixel value.
    expect(mountTranscript({ lines: 8 }).get('ol').attributes('style')).toContain(
      '--console-lines: 8',
    )
    const filling = mountTranscript({ lines: null }).get('ol')
    expect(filling.classes()).toContain('gcode-console--fill')
    expect(filling.attributes('style')).toBeUndefined()
  })

  it('anchors to its floor only when the newest line is at the bottom', () => {
    // With the prompt above the transcript the newest line is at the top, and an
    // auto margin there would push it away from the prompt beside it.
    expect(mountTranscript().get('ol').classes()).toContain('gcode-console--anchored')
    expect(mountTranscript({ newestFirst: true }).get('ol').classes()).not.toContain(
      'gcode-console--anchored',
    )
  })

  it('reverses the rendered order for a prompt on top, without reordering the data', () => {
    const wrapper = mountTranscript({ newestFirst: true })
    expect(wrapper.findAll('.gcode-console__line').map((l) => l.attributes('data-kind'))).toEqual([
      'debug',
      'error',
      'response',
      'command',
    ])
  })

  it('starts at the newest line on mount, not at the oldest', async () => {
    // Arriving on the page or expanding the card fires no length change, so
    // without an explicit catch-up the reader lands on boot-time output.
    const wrapper = mountTranscript()
    const element = wrapper.get('ol').element
    Object.defineProperty(element, 'scrollHeight', { value: 900, configurable: true })
    Object.defineProperty(element, 'clientHeight', { value: 200, configurable: true })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(element.scrollTop).toBe(900)
  })

  it('follows the top edge instead when the newest line is there', async () => {
    const wrapper = mountTranscript({ newestFirst: true })
    const element = wrapper.get('ol').element
    element.scrollTop = 400
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(element.scrollTop).toBe(0)
  })

  it('pins the bottom edge even when sub-pixel rounding leaves it a hair short of zero', async () => {
    // The same rounding noise that keeps `trackScroll` from reporting an exact
    // zero distance at the follow edge applies here: an exact `<= 0` comparison
    // would flicker the pin on and off across that noise instead of holding it.
    const wrapper = mountTranscript()
    const element = wrapper.get('ol').element
    Object.defineProperty(element, 'scrollHeight', { value: 900, configurable: true })
    Object.defineProperty(element, 'clientHeight', { value: 200, configurable: true })
    Object.defineProperty(element, 'scrollTop', { value: 699, configurable: true, writable: true })

    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, clientX: 100, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('ol').classes()).not.toContain('gcode-console--edge-released')

    element.dispatchEvent(new PointerEvent('pointermove', { clientX: 108, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('ol').classes()).toContain('gcode-console--edge-released')
  })

  it('contains a wheel gesture pinned at the bottom until the pointer moves away from where it arrived', async () => {
    const wrapper = mountTranscript()
    const element = wrapper.get('ol').element
    Object.defineProperty(element, 'scrollHeight', { value: 900, configurable: true })
    Object.defineProperty(element, 'clientHeight', { value: 200, configurable: true })
    Object.defineProperty(element, 'scrollTop', { value: 700, configurable: true, writable: true })

    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, clientX: 100, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('ol').classes()).not.toContain('gcode-console--edge-released')

    // A hand tremor on the wheel must not read as the escape gesture.
    element.dispatchEvent(new PointerEvent('pointermove', { clientX: 104, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('ol').classes()).not.toContain('gcode-console--edge-released')

    element.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('ol').classes()).toContain('gcode-console--edge-released')
  })

  it('re-arms the block once a wheel tick no longer overscrolls the same edge', async () => {
    const wrapper = mountTranscript()
    const element = wrapper.get('ol').element
    Object.defineProperty(element, 'scrollHeight', { value: 900, configurable: true })
    Object.defineProperty(element, 'clientHeight', { value: 200, configurable: true })
    Object.defineProperty(element, 'scrollTop', { value: 700, configurable: true, writable: true })

    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, clientX: 100, clientY: 100 }))
    element.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('ol').classes()).toContain('gcode-console--edge-released')

    // Scrolling back up off the bottom is not still overscrolling that edge.
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, clientX: 100, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('ol').classes()).not.toContain('gcode-console--edge-released')

    // Arriving at the bottom again needs a fresh escape movement.
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, clientX: 100, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('ol').classes()).not.toContain('gcode-console--edge-released')
  })

  it('reaches the bottom edge as exactly as the top one when the box height is fractional', async () => {
    // `scrollHeight`/`clientHeight` are integers the browser rounds from a
    // fractional layout while `scrollTop` stays fractional, so a box parked hard
    // against its floor reports a leftover fraction. Mixing those two domains is
    // what left the downward direction — and only the downward direction — never
    // registering as being at its edge: the pin never armed, so containment was
    // re-armed on every tick and the page could not be scrolled past the card.
    const wrapper = mountTranscript()
    const element = wrapper.get('ol').element
    // A box whose height is not ours to round — the console page takes its own
    // from the viewport. `scrollTop` here is the browser's true floor, scrolled
    // as far as this box goes, yet the integer arithmetic puts it 2.5px short.
    Object.defineProperty(element, 'scrollHeight', { value: 2142, configurable: true })
    Object.defineProperty(element, 'clientHeight', { value: 246, configurable: true })
    Object.defineProperty(element, 'scrollTop', {
      value: 1893.5,
      configurable: true,
      writable: true,
    })

    // Wheeling further down while parked on the floor must pin the bottom edge…
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, clientX: 100, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('ol').classes()).not.toContain('gcode-console--edge-released')

    // …and a deliberate pointer move must still be able to release it, which is
    // the only escape the reader has from a card that contains its own scrolling.
    element.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('ol').classes()).toContain('gcode-console--edge-released')
  })

  it('says the transcript is empty rather than rendering a bare box', () => {
    const wrapper = mount(ConsoleTranscript, {
      props: { entries: [] },
      global: { plugins: [i18n] },
    })
    expect(wrapper.get('.gcode-console__empty').text()).toBe('Nothing from the printer yet.')
  })
})
