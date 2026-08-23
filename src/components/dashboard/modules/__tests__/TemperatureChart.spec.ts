import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'

import TemperatureChart, {
  type TemperatureChartSeries,
} from '@/components/dashboard/modules/TemperatureChart.vue'
import { i18n } from '@/i18n'

const chartWidth = 400

beforeAll(() => {
  // jsdom lays nothing out, so the chart would measure zero and draw nothing.
  // The component reads `clientWidth` once before reaching for a
  // ResizeObserver, which is exactly the seam a fixed width can be given at.
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => chartWidth,
  })
})

function series(overrides: Partial<TemperatureChartSeries> = {}): TemperatureChartSeries {
  return {
    objectName: 'extruder',
    label: 'Hotend',
    color: 'var(--color-data-orange)',
    points: Array.from({ length: 60 }, (_, index) => ({
      eventtime: index,
      value: 25 + index * 3,
    })),
    targetPoints: Array.from({ length: 60 }, (_, index) => ({
      eventtime: index,
      value: index < 10 ? 0 : 215,
    })),
    powerPoints: Array.from({ length: 60 }, (_, index) => ({
      eventtime: index,
      value: index < 40 ? 1 : 0.3,
    })),
    activeTarget: 215,
    ...overrides,
  }
}

async function mountChart(props: Partial<InstanceType<typeof TemperatureChart>['$props']> = {}) {
  const wrapper = mount(TemperatureChart, {
    global: { plugins: [i18n] },
    props: {
      series: [series()],
      windowSeconds: 300,
      heightRem: 9,
      showTargets: true,
      showPower: false,
      lockToZero: false,
      fixedMaximum: null,
      wallClockOffsetSeconds: 23 * 3600 + 7 * 60,
      latestEventtime: 59,
      cursorEventtime: null,
      ...props,
    },
  })
  // The width is measured in `onMounted`, so the first draw lands a tick later.
  await flushPromises()
  return wrapper
}

describe('TemperatureChart', () => {
  /*
   * The old chart drew into a fixed 400x90 box with `preserveAspectRatio="none"`,
   * which scales the coordinate space unevenly. That was survivable for a bare
   * line and is not for an axis, which is mostly glyphs.
   */
  it('draws in real pixels rather than a stretched coordinate space', async () => {
    const wrapper = await mountChart()
    const svg = wrapper.get('svg')

    expect(svg.attributes('viewBox')).toBe(`0 0 ${chartWidth} 144`)
    expect(svg.attributes('preserveAspectRatio')).toBeUndefined()
  })

  it('labels both axes', async () => {
    const wrapper = await mountChart()
    const labels = wrapper.findAll('.temperature-chart__label').map((label) => label.text())

    // Temperatures on the left, clock times underneath.
    expect(labels.some((label) => /^\d+$/.test(label))).toBe(true)
    expect(labels.some((label) => /^\d{2}:\d{2}$/.test(label))).toBe(true)
  })

  /*
   * Colour names the sensor and the dash pattern names the quantity, so a
   * reading and the setpoint it is climbing toward read as one heater. The old
   * chart dashed every odd-indexed series, which encoded its own array order.
   */
  it('separates what was read from what was asked for', async () => {
    const wrapper = await mountChart()
    const values = wrapper.findAll('.temperature-chart__series--value')
    const targets = wrapper.findAll('.temperature-chart__series--target')

    expect(values).toHaveLength(1)
    expect(targets).toHaveLength(1)
    expect(values[0]?.attributes('style')).toContain('var(--color-data-orange)')
    expect(targets[0]?.attributes('style')).toContain('var(--color-data-orange)')
  })

  it('draws no target line when the card asks for none', async () => {
    const wrapper = await mountChart({ showTargets: false })
    expect(wrapper.findAll('.temperature-chart__series--target')).toHaveLength(0)
    expect(wrapper.findAll('.temperature-chart__series--value')).toHaveLength(1)
  })

  /*
   * The window is anchored to the newest sample. Forty seconds of session draws
   * forty seconds of trace against the right edge — not a full-width line
   * claiming to be five minutes that were never recorded.
   */
  it('ends the trace at the right edge and starts it where the data does', async () => {
    const wrapper = await mountChart()
    const path = wrapper.get('.temperature-chart__series--value').attributes('d') ?? ''
    const xs = [...path.matchAll(/[ML]([\d.]+) /g)].map((match) => Number(match[1]))

    // 60 seconds of a 300-second window: the trace occupies the last fifth.
    expect(Math.max(...xs)).toBeGreaterThan(chartWidth - 12)
    expect(Math.min(...xs)).toBeGreaterThan(chartWidth * 0.7)
  })

  /*
   * Found by watching an idle printer draw a 0–40° axis around a 27° reading.
   * A heater that is off records a target of zero on every sample, and those
   * zeros dragged the floor of the plot down — the same failure `valueScale`
   * already refused for the live target, arriving through the recorded history
   * instead. Both doors are now shut.
   */
  it('does not let an idle heater’s zero target drag the axis to zero', async () => {
    const idle = series({
      points: Array.from({ length: 30 }, (_, index) => ({
        eventtime: index,
        value: 27 + (index % 3) * 0.1,
      })),
      targetPoints: Array.from({ length: 30 }, (_, index) => ({ eventtime: index, value: 0 })),
      activeTarget: 0,
    })
    const wrapper = await mountChart({ series: [idle], latestEventtime: 29 })

    const values = wrapper
      .findAll('.temperature-chart__label')
      .map((label) => label.text())
      .filter((label) => /^\d+$/.test(label))
      .map(Number)

    // A 27° reading is framed by its own value with headroom above it — 0–40 —
    // rather than being squashed against the top of a range stretched down to
    // meet a target of zero. The floor lands on the same 20° grid as the top.
    expect(values.length).toBeGreaterThan(0)
    expect(Math.max(...values)).toBeLessThanOrEqual(40)
    // And an off heater has no setpoint worth drawing.
    expect(wrapper.findAll('.temperature-chart__series--target')).toHaveLength(0)
  })

  /*
   * The axis holds still through a wobble in the data, and must not hold still
   * through an instruction. Turning the zero floor off asked for a floor under
   * the coldest reading while the remembered floor was 0, and the release
   * margin — a full step of slack before a bound retreats — is never met by a
   * single step, so the plot kept its zero until the page was reloaded. The
   * memory is therefore kept beside the framing rule that produced it and
   * dropped the moment that rule changes.
   */
  it('reframes at once when the framing rule changes, not only when the data does', async () => {
    const warm = series({
      points: Array.from({ length: 31 }, (_, index) => ({ eventtime: index, value: 15 + index })),
      targetPoints: Array.from({ length: 31 }, (_, index) => ({ eventtime: index, value: 0 })),
      activeTarget: 0,
    })
    /** How much of the plot's height the trace covers — the point of unlocking. */
    const traceHeight = (wrapper: Awaited<ReturnType<typeof mountChart>>) => {
      const d = wrapper.get('.temperature-chart__series--value').attributes('d') ?? ''
      const ys = [...d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((match) => Number(match[1]))
      return Math.max(...ys) - Math.min(...ys)
    }

    const wrapper = await mountChart({ series: [warm], latestEventtime: 30, lockToZero: true })
    const locked = traceHeight(wrapper)

    await wrapper.setProps({ lockToZero: false })
    await flushPromises()

    // A 15–45 trace framed from zero uses three fifths of the plot and framed
    // from under itself uses three quarters, on the same draw — not a reload.
    expect(traceHeight(wrapper)).toBeGreaterThan(locked)
  })

  /*
   * A heater switched off mid-window has no setpoint during that stretch.
   * Bridging the gap would claim it held the old one the whole time.
   */
  it('breaks the target line where the heater was off rather than bridging it', async () => {
    const cycled = series({
      targetPoints: [
        { eventtime: 0, value: 215 },
        { eventtime: 10, value: 215 },
        { eventtime: 20, value: 0 },
        { eventtime: 30, value: 0 },
        { eventtime: 40, value: 215 },
        { eventtime: 50, value: 215 },
      ],
    })
    const wrapper = await mountChart({ series: [cycled], latestEventtime: 59 })

    const path = wrapper.get('.temperature-chart__series--target').attributes('d') ?? ''
    // Two subpaths: one before the heater went off, one after it came back.
    expect(path.match(/M/g)).toHaveLength(2)
  })

  /*
   * A disconnected thermocouple reads as exactly 0°, and a shorted one reads
   * in the thousands — Klipper's own fault values, not real temperatures.
   * Neither belongs on the axis, which would otherwise stretch to fit a fault
   * and squash every real reading into a sliver of the plot, and neither
   * should be bridged over as if the sensor actually passed through it.
   */
  it('breaks the value line at a sensor fault and keeps it off the axis', async () => {
    const faulty = series({
      points: [
        { eventtime: 0, value: 25 },
        { eventtime: 10, value: 26 },
        { eventtime: 20, value: 0 },
        { eventtime: 30, value: 26 },
        { eventtime: 40, value: 1500 },
        { eventtime: 50, value: 27 },
        { eventtime: 60, value: 28 },
      ],
      targetPoints: [],
      activeTarget: null,
    })
    const wrapper = await mountChart({ series: [faulty], latestEventtime: 69 })

    const path = wrapper.get('.temperature-chart__series--value').attributes('d') ?? ''
    // Three subpaths: the two faults each split the trace.
    expect(path.match(/M/g)).toHaveLength(3)

    const values = wrapper
      .findAll('.temperature-chart__label')
      .map((label) => label.text())
      .filter((label) => /^\d+$/.test(label))
      .map(Number)
    // Framed around the real 25–28° readings, not stretched down to 0 or up
    // to 1500 to make room for the faults.
    expect(Math.max(...values)).toBeLessThan(100)
  })

  /*
   * The card is resized by things the chart cannot watch for — a column-width
   * preset, the settings surface docking it, the window. Only a ResizeObserver
   * catches those, and its delivery is tied to the frame lifecycle, so it
   * cannot be exercised in a pane that is not compositing. This drives the
   * callback directly, which is the part this component actually owns.
   */
  it('redraws at the width a resize reports', async () => {
    const callbacks: ResizeObserverCallback[] = []
    class StubObserver {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback)
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    const original = globalThis.ResizeObserver
    globalThis.ResizeObserver = StubObserver as unknown as typeof ResizeObserver

    try {
      const wrapper = await mountChart()
      expect(wrapper.get('svg').attributes('viewBox')).toBe(`0 0 ${chartWidth} 144`)
      expect(callbacks).toHaveLength(1)

      callbacks[0]?.(
        [{ contentRect: { width: 260 } } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      )
      await flushPromises()

      expect(wrapper.get('svg').attributes('viewBox')).toBe('0 0 260 144')
      // And the drawing follows the new box rather than overflowing it.
      const path = wrapper.get('.temperature-chart__series--value').attributes('d') ?? ''
      const xs = [...path.matchAll(/[ML]([\d.]+) /g)].map((match) => Number(match[1]))
      expect(Math.max(...xs)).toBeLessThanOrEqual(260)
    } finally {
      globalThis.ResizeObserver = original
    }
  })

  /*
   * A floating tooltip is the usual answer and the wrong one on a 271px card:
   * the box that would carry three sensors covers the plot it describes. The
   * chart reports the moment instead, and the table above it shows the values.
   */
  it('reports the moment under the pointer, snapped to a sample it drew', async () => {
    const wrapper = await mountChart()
    const svg = wrapper.get('svg')
    const element = svg.element as SVGElement
    element.getBoundingClientRect = () =>
      ({ left: 0, width: chartWidth, top: 0, height: 144 }) as DOMRect

    // `clientX` is read-only on jsdom's MouseEvent, so the event is built
    // rather than described to `trigger`.
    element.dispatchEvent(
      new MouseEvent('pointermove', { clientX: chartWidth - 20, bubbles: true }),
    )
    await flushPromises()

    const emitted = wrapper.emitted('update:cursorEventtime')
    expect(emitted).toBeTruthy()
    const reported = emitted![0]![0] as number
    // Near the right edge is near the newest sample, not off the end of it.
    expect(reported).toBeGreaterThan(40)
    expect(reported).toBeLessThanOrEqual(59)

    await svg.trigger('pointerleave')
    expect(wrapper.emitted('update:cursorEventtime')!.at(-1)).toEqual([null])
  })

  it('draws a rule and a dot per series at the moment being read', async () => {
    const wrapper = await mountChart({ cursorEventtime: 30 })
    expect(wrapper.findAll('.temperature-chart__cursor')).toHaveLength(1)
    expect(wrapper.findAll('.temperature-chart__cursor-dot')).toHaveLength(1)

    const idle = await mountChart()
    expect(idle.findAll('.temperature-chart__cursor')).toHaveLength(0)
  })

  /*
   * Two series do not line up by position. `pointsWithin` omits a history entry
   * where its sensor reported nothing, so a sensor discovered mid-session is
   * short by however many samples it missed — and reading `points[index]` off
   * every series therefore put a dot on a temperature from a different moment
   * than the line it sat on. Here the second series starts 40 samples late, so
   * index 30 in the first is index -10 in the second: matching by index drops
   * the dot or lands it at the wrong height, and matching by time puts it on
   * that series' own reading for the moment being read.
   */
  it('matches every series to the moment being read, not to a shared index', async () => {
    const late: TemperatureChartSeries = {
      objectName: 'heater_bed',
      label: 'Bed',
      color: 'var(--color-data-sky)',
      points: Array.from({ length: 20 }, (_, index) => ({
        eventtime: 40 + index,
        value: 60,
      })),
      targetPoints: [],
      powerPoints: [],
      activeTarget: 60,
    }
    const wrapper = await mountChart({ series: [series(), late], cursorEventtime: 45 })

    const dots = wrapper.findAll('.temperature-chart__cursor-dot')
    expect(dots).toHaveLength(2)
    // The bed held 60° throughout, so its dot has to sit at the height 60°
    // projects to — which it cannot if it was read off a neighbour's sample.
    const heights = dots.map((dot) => Number(dot.attributes('cy')))
    expect(heights[1]).toBeGreaterThan(heights[0]!)
  })

  /*
   * A charted sensor with no samples yet used to take the whole cursor down
   * with it, because the anchor was `series[0]` rather than the first series
   * that drew anything. The chart went blank while the table above it went on
   * reading out the past — the card claiming a moment with nothing on the plot
   * to say where it was.
   */
  it('still reads out the past when the first charted sensor has drawn nothing', async () => {
    const empty: TemperatureChartSeries = {
      objectName: 'temperature_sensor new',
      label: 'New sensor',
      color: 'var(--color-data-green)',
      points: [],
      targetPoints: [],
      powerPoints: [],
      activeTarget: null,
    }
    const wrapper = await mountChart({ series: [empty, series()], cursorEventtime: 30 })

    expect(wrapper.findAll('.temperature-chart__cursor')).toHaveLength(1)
    expect(wrapper.findAll('.temperature-chart__cursor-dot')).toHaveLength(1)
  })

  /* Arrow keys walk the samples, so this is not a pointer-only affordance. */
  it('lets the keyboard walk the samples and leave them again', async () => {
    const wrapper = await mountChart({ cursorEventtime: 30 })
    const svg = wrapper.get('svg')
    expect(svg.attributes('tabindex')).toBe('0')

    await svg.trigger('keydown', { key: 'ArrowLeft' })
    const back = wrapper.emitted('update:cursorEventtime')!.at(-1)![0] as number
    expect(back).toBeLessThan(30)

    await svg.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('update:cursorEventtime')!.at(-1)).toEqual([null])
  })

  /*
   * A plain `tabindex` element does not get the pass a real button gets from
   * Chromium's click-focus ring, so a click that focused the chart the way
   * Tab does would draw the same ring a keyboard user gets. Blocking the
   * pointer event's default is what keeps a click from focusing it at all —
   * `dispatchEvent`'s return value is `false` exactly when a cancelable event
   * had its default prevented, which is the one direct way to see that the
   * `.prevent` modifier in the template is actually wired to this element.
   */
  it('blocks a pointer press from focusing the chart', async () => {
    const wrapper = await mountChart()
    const element = wrapper.get('svg').element
    const notPrevented = element.dispatchEvent(
      new PointerEvent('pointerdown', { cancelable: true, bubbles: true }),
    )
    expect(notPrevented).toBe(false)
  })

  /*
   * Duty gets its own axis because it shares nothing with a temperature but
   * the time underneath it: plotted against degrees, every heater's power
   * would lie flat along the bottom of the plot.
   */
  it('draws heater duty against a second axis only when asked', async () => {
    const off = await mountChart()
    expect(off.findAll('.temperature-chart__series--power')).toHaveLength(0)
    expect(
      off.findAll('.temperature-chart__label').filter((l) => l.text().endsWith('%')),
    ).toHaveLength(0)

    const on = await mountChart({ showPower: true })
    expect(on.findAll('.temperature-chart__series--power')).toHaveLength(1)
    const percentages = on
      .findAll('.temperature-chart__label')
      .map((label) => label.text())
      .filter((text) => text.endsWith('%'))
    expect(percentages).toEqual(['0%', '50%', '100%'])
  })

  /*
   * The duty labels are anchored at `start`, so whatever room the right gutter
   * does not reserve is taken out of the label rather than the plot. It shipped
   * leaving 0.6px between the `%` and the edge of the SVG, which reads as a
   * clipped glyph — `100%` measures 20.4px at the label's 8.5px mono, and a
   * wider mono face needs more than that again. jsdom lays nothing out, so this
   * pins the reserved room rather than the rendered width: the two only stay in
   * step if a change to the gutter or the gap is made knowing about the other.
   */
  it('reserves room to the right of the duty labels for the widest of them', async () => {
    const wrapper = await mountChart({ showPower: true })
    const label = wrapper
      .findAll('text.temperature-chart__label')
      .find((candidate) => candidate.text().endsWith('%'))
    const labelX = Number(label?.attributes('x'))

    expect(Number.isFinite(labelX)).toBe(true)
    expect(chartWidth - labelX).toBeGreaterThanOrEqual(27)
  })

  /*
   * ADR 0004's scrolling time-axis exception. A sample landing must not move
   * the axis: the layout jumps forward by the interval and the shift grows by
   * exactly the same amount in the same tick, so the two cancel and the trace
   * carries on from where it was. Getting this wrong is what makes the chart
   * lurch once a second — the failure the exception exists to prevent.
   */
  it('cancels a landing sample against the shift, so the axis never jumps', async () => {
    const wrapper = await mountChart({ windowSeconds: 60, latestEventtime: 59 })
    const shift = () => {
      const transform = wrapper.get('svg g[transform]').attributes('transform') ?? ''
      return Number(/translate\(([-\d.]+)/.exec(transform)?.[1] ?? Number.NaN)
    }
    // Nothing has landed yet, so the edge sits on the newest sample.
    expect(shift()).toBeCloseTo(0, 3)

    await wrapper.setProps({ latestEventtime: 60 })
    await flushPromises()

    // One second of window against 60 seconds of it, over the plot's width.
    const plotWidth = chartWidth - 30 - 4
    expect(shift()).toBeCloseTo(plotWidth / 60, 1)
  })

  /*
   * The label used to re-anchor to `start`/`end` within 14px of either edge,
   * which fires mid-slide on a scrolling axis and jumps the label half its own
   * width away from the gridline it names. The fade band replaced it.
   */
  it('centres every time label on its own gridline, at both edges too', async () => {
    const wrapper = await mountChart()
    const anchors = wrapper
      .findAll('text.temperature-chart__label')
      .map((label) => label.attributes('text-anchor'))

    // The value axis keeps its `end` anchor; no time label carries `start`.
    expect(anchors).not.toContain('start')
    expect(anchors.filter((anchor) => anchor === 'middle').length).toBeGreaterThan(0)
  })

  it('survives having nothing to draw yet', async () => {
    const wrapper = await mountChart({
      series: [series({ points: [], targetPoints: [], powerPoints: [], activeTarget: null })],
      latestEventtime: null,
    })
    expect(wrapper.findAll('.temperature-chart__series')).toHaveLength(0)
    // The axis is still drawn, so the card does not change height on first data.
    expect(wrapper.findAll('.temperature-chart__label').length).toBeGreaterThan(0)
  })
})
