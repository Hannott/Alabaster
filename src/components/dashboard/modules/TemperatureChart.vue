<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  downsample,
  linePath,
  stepPath,
  timeScale,
  valueScale,
  type TimedValue,
} from '@/dashboard/chartGeometry'

export interface TemperatureChartSeries {
  objectName: string
  label: string
  color: string
  /** Solid: what the sensor read. */
  points: TimedValue[]
  /** Dashed: what it was asked for. Empty when the heater was never on. */
  targetPoints: TimedValue[]
  /** Dotted, against the right-hand axis. Empty for a sensor with no heater. */
  powerPoints: TimedValue[]
  /** The live target, so an active setpoint is inside the axis before the trace reaches it. */
  activeTarget: number | null
}

const props = defineProps<{
  series: TemperatureChartSeries[]
  windowSeconds: number
  heightRem: number
  showTargets: boolean
  /** Draw heater duty against a second axis. */
  showPower: boolean
  /** Anchor the floor at zero rather than under the coldest reading. */
  lockToZero: boolean
  /** A ceiling from the machine's configuration, used instead of fitting to the data. */
  fixedMaximum: number | null
  /** `eventtime + this = seconds past midnight`. Klipper's clock is monotonic. */
  wallClockOffsetSeconds: number
  latestEventtime: number | null
}>()

/**
 * The moment being read, or null while the chart is showing the present. A
 * named model, not a hand-rolled prop/emit pair — `AppSelect.vue` is the
 * canonical example and says why. The value itself is owned by the module
 * above, because the table is what displays it.
 */
const cursorEventtime = defineModel<number | null>('cursorEventtime', { required: true })

const { t } = useI18n({ useScope: 'global' })
/**
 * Scopes the clip path's id to this instance: a dashboard can hold more than
 * one Temperatures card (ADR 0006), and an `id` shared between two `<svg>`s
 * would let the second one's `<clipPath>` silently win, clipping the first
 * chart's line to whatever the second chart's plot rectangle happens to be.
 */
const clipId = useId()
/** Same instance-scoping reason, for the time labels' fade band. */
const labelMaskId = useId()
const labelFadeId = useId()

/*
 * Drawn in real pixels rather than a fixed `viewBox` stretched to fit. The old
 * chart used `preserveAspectRatio="none"`, which scales the coordinate space
 * unevenly — survivable for a bare line, but it deforms every glyph, and an
 * axis is mostly glyphs.
 */
const root = useTemplateRef<HTMLElement>('root')
const width = ref(0)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!root.value) return
  // Measured once regardless, so a runtime without ResizeObserver still draws
  // the chart at the width it was mounted at rather than nothing at all. The
  // same guard the console transcript and the docked card use.
  width.value = root.value.clientWidth
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (entry) width.value = entry.contentRect.width
  })
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

const height = computed(() => props.heightRem * 16)
/** Room for the value labels, which are the widest thing outside the plot. */
const gutterStart = 30
/**
 * The gap between the plot and the duty labels beside it, matching the one the
 * value labels keep on the other side so both axes hug the plot equally.
 */
const powerLabelGap = 5
/**
 * Room reserved for the widest duty label, which is always `100%`.
 *
 * Measured, not chosen to look right. At the label's 8.5px mono `100%` renders
 * 20.4px wide in JetBrains Mono, and the gutter this replaces left 0.6px
 * between the `%` and the edge of the SVG — no margin at all, so the glyph
 * read as clipped. A mono face is not one width, which the jog matrix already
 * learned the same way (the same string measures 26.4px in Consolas and 28.8px
 * in Liberation Mono), so this carries enough headroom for a wider face rather
 * than fitting the one the developer happens to have installed.
 */
const powerLabelReserve = 35
/** The right-hand duty axis needs its own labels; without it the plot runs on. */
const gutterEnd = computed(() => (props.showPower ? powerLabelGap + powerLabelReserve : 4))
const gutterTop = 7
/** One line of time labels. */
const gutterBottom = 15

const plotWidth = computed(() => Math.max(0, width.value - gutterStart - gutterEnd.value))
const plotHeight = computed(() => Math.max(0, height.value - gutterTop - gutterBottom))

const time = computed(() =>
  timeScale({
    latestEventtime: props.latestEventtime ?? 0,
    windowSeconds: props.windowSeconds,
    wallClockOffsetSeconds: props.wallClockOffsetSeconds,
    maximumTicks: plotWidth.value > 360 ? 5 : 4,
    // One step spare at each end, so the tick about to enter the plot already
    // exists to be scrolled in rather than appearing against the edge.
    overscanSteps: 1,
  }),
)

/**
 * The scrolling axis — see ADR 0004's scrolling time-axis exception.
 *
 * Everything above lays the plot out against `latestEventtime`, the newest
 * sample the store holds, which changes once a second. Left there, the whole
 * axis — trace, gridlines and time labels together — jumps a twentieth of a
 * one-minute window once a second instead of sliding. What actually advances
 * between two samples is *time*, continuously, so this tracks where the
 * window's right edge has really reached and the template shifts the drawn
 * axis by the difference.
 *
 * `scrollLagSeconds` is how far that true edge sits behind `latestEventtime`.
 * It is never negative: the edge is clamped to the newest sample's own
 * eventtime, so the axis only ever interpolates between two moments that were
 * really measured and never runs ahead into one that was not. That clamp is
 * also what makes a stalled feed degrade quietly — the edge catches up to the
 * last sample, the lag reaches zero, and the axis holds still rather than
 * scrolling a dead trace off to the left.
 *
 * Deliberately not reactive, and applied to the two scrolled `<g>` elements
 * imperatively in `applyScroll` rather than through a template binding. The
 * lag changes on every animation frame while the feed is live, and a binding
 * read by the template made each of those frames re-render the entire
 * component — every gridline, tick label and path rebuilt as VNodes sixty
 * times a second to move one `transform` attribute on two groups. Writing the
 * attribute directly costs the frame exactly that attribute. Vue leaves the
 * attribute alone on re-renders because nothing binds it; the groups
 * themselves persist across patches.
 */
let scrollLagSeconds = 0
/** Where the edge had reached when the newest sample landed, and when that was. */
let anchorEnd: number | null = null
let anchorAt = 0
let frame: number | null = null

const pixelsPerSecond = computed(() =>
  props.windowSeconds > 0 ? plotWidth.value / props.windowSeconds : 0,
)

const traceGroup = useTemplateRef<SVGGElement>('traceGroup')
const labelGroup = useTemplateRef<SVGGElement>('labelGroup')
/** The applied shift in pixels, kept for the pointer math in `eventtimeAt`. */
let scrollOffsetPx = 0

/**
 * Rightward, and never more than one sample interval. Shifting the drawn axis
 * right is what puts the newest point just past the clip edge, so the trace
 * always reaches the right-hand side instead of its tip retreating from the
 * edge and snapping back each time a sample lands. Written straight to the
 * two groups — see the note on `scrollLagSeconds` for why this is not a
 * template binding.
 */
function applyScroll(): void {
  scrollOffsetPx = scrollLagSeconds * pixelsPerSecond.value
  const transform = `translate(${scrollOffsetPx.toFixed(2)} 0)`
  traceGroup.value?.setAttribute('transform', transform)
  labelGroup.value?.setAttribute('transform', transform)
}

// The frame loop only runs while there is lag to work off, so a resize, a
// window change, or the svg (re)mounting has to reapply the shift itself —
// after render, when the groups exist at their new geometry.
watch([pixelsPerSecond, traceGroup, labelGroup], () => applyScroll(), { flush: 'post' })

function prefersReducedMotion(): boolean {
  // Optional-called, so an environment without matchMedia still animates
  // rather than silently losing the motion — as `cardMove` already does.
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function edgeNow(latest: number): number {
  if (anchorEnd === null) return latest
  return Math.min(latest, anchorEnd + (performance.now() - anchorAt) / 1000)
}

function step(): void {
  const latest = props.latestEventtime
  if (latest === null) {
    scrollLagSeconds = 0
    applyScroll()
    frame = null
    return
  }
  const lag = Math.max(0, latest - edgeNow(latest))
  scrollLagSeconds = lag
  applyScroll()
  // Nothing left to work off — the edge has caught up with the newest sample,
  // so there is no motion to drive until another one arrives. Idling here is
  // what keeps a still chart from holding a 60fps loop open on a Raspberry Pi.
  frame = lag > 0 ? requestAnimationFrame(step) : null
}

watch(
  () => props.latestEventtime,
  (latest, previous) => {
    if (latest === null) {
      anchorEnd = null
      scrollLagSeconds = 0
      applyScroll()
      return
    }
    // Carry the edge on from exactly where it had reached, so the sample
    // arriving does not move it: the layout jumps forward by the interval and
    // the shift grows by the same amount in the same tick, which cancels.
    const carried =
      anchorEnd === null || previous === null || previous === undefined
        ? latest
        : Math.min(previous, anchorEnd + (performance.now() - anchorAt) / 1000)
    // A printer switch empties the history, so the axis restarts at the new
    // machine's clock rather than scrolling across the gap between two.
    anchorEnd = latest < carried ? latest : carried
    anchorAt = performance.now()

    // Reduced motion keeps the axis on the discrete step it always had, rather
    // than freezing it at whatever fraction the shift had reached.
    if (prefersReducedMotion()) {
      scrollLagSeconds = 0
      applyScroll()
      return
    }
    // Applied in this tick, not on the next frame. The layout moves forward the
    // instant the sample lands, so a shift that waited for the next frame would
    // leave exactly the one-frame jump this whole mechanism exists to remove.
    scrollLagSeconds = Math.max(0, latest - anchorEnd)
    applyScroll()
    if (frame === null) frame = requestAnimationFrame(step)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
})

/**
 * Two samples per pixel is past what the display can resolve, and everything
 * beyond it is path data the browser re-parses on every push for no visible
 * gain. A twenty-minute window is 1200 points a series before this.
 */
const drawnSeries = computed(() =>
  props.series.map((series) => ({
    ...series,
    points: downsample(series.points, Math.max(4, Math.round(plotWidth.value * 2))),
    targetPoints: props.showTargets
      ? downsample(series.targetPoints, Math.max(4, Math.round(plotWidth.value * 2)))
      : [],
    powerPoints: props.showPower
      ? downsample(series.powerPoints, Math.max(4, Math.round(plotWidth.value * 2)))
      : [],
  })),
)

/**
 * Duty gets its own axis because it shares nothing with a temperature but the
 * time underneath it — plotted against a scale in degrees, every heater's power
 * would lie flat along the bottom of the plot.
 */
function projectPower(fraction: number): number {
  return gutterTop + plotHeight.value - Math.min(1, Math.max(0, fraction)) * plotHeight.value
}

const powerTicks = computed(() =>
  props.showPower ? [0, 0.5, 1].map((fraction) => ({ fraction, y: projectPower(fraction) })) : [],
)

/** Zero is "off", not a setpoint — see `isSetpoint` and `valueScale`. */
function isSetpoint(value: number): boolean {
  return value > 0
}

/**
 * The axis the last frame settled on, so it can hold where it is rather than
 * being refitted from scratch on every push. Deliberately not reactive: it is
 * an output of the computation below, and making it an input as well would
 * retrigger the computed that writes it.
 *
 * Feeding a result back in yields the same result — the bound holds — so
 * re-evaluating the computed cannot walk the axis anywhere.
 *
 * Kept beside the framing rule that produced it, and discarded the moment that
 * rule changes. The hysteresis exists to ignore a wobble in the *data*, and it
 * cannot be allowed to ignore the user: turning "Start the scale at zero" off
 * asked for a floor of 25 while the remembered floor was 0, and the release
 * margin — a full step of slack before a bound retreats — is not met by a
 * single step, so the axis held zero until the page was reloaded. Changing the
 * window, the ceiling, or which sensors are drawn is the same kind of
 * instruction and gets the same treatment.
 */
let settled: { key: string; bounds: { minimum: number; maximum: number } } | null = null

const framingKey = computed(() =>
  [
    props.lockToZero,
    props.fixedMaximum,
    props.windowSeconds,
    props.series.map((series) => series.objectName).join(','),
  ].join('|'),
)

const values = computed(() => {
  const key = framingKey.value
  const previous = settled?.key === key ? settled.bounds : null
  const scale = valueScale(
    drawnSeries.value.flatMap((series) => [
      series.points,
      // An idle heater records a target of zero on every sample, and letting
      // those into the range drags the floor of the plot to 0 — the same
      // failure `valueScale` refuses for the live target, arriving by a
      // different door. Found by watching an idle printer draw a 0–40 axis
      // around a 27° reading.
      series.targetPoints.filter((point) => isSetpoint(point.value)),
    ]),
    {
      // A live setpoint belongs in the range even before the trace climbs to
      // it, so the gap the user is watching close is actually on screen. Zero
      // is not a setpoint — see `valueScale`.
      activeTargets: props.series.flatMap((series) =>
        series.activeTarget !== null && series.activeTarget > 0 ? [series.activeTarget] : [],
      ),
      previous,
      lockToZero: props.lockToZero,
      fixedMaximum: props.fixedMaximum,
    },
  )
  settled = { key, bounds: { minimum: scale.minimum, maximum: scale.maximum } }
  return scale
})

function projectX(eventtime: number): number {
  const span = time.value.end - time.value.start
  if (span <= 0) return gutterStart + plotWidth.value
  return gutterStart + ((eventtime - time.value.start) / span) * plotWidth.value
}

function projectY(value: number): number {
  const span = values.value.maximum - values.value.minimum
  if (span <= 0) return gutterTop + plotHeight.value
  return gutterTop + plotHeight.value - ((value - values.value.minimum) / span) * plotHeight.value
}

const gridLines = computed(() =>
  values.value.ticks.map((tick) => ({ tick, y: projectY(tick), label: Math.round(tick) })),
)

/**
 * Every label is centred on its own gridline, with no special case at either
 * end. The edges used to re-anchor a label to `start` or `end` within 14px of
 * them, to keep it from hanging off the card — which is right for a static
 * axis and wrong for one that scrolls, because the flip fires mid-slide and
 * the label jumps half its own width sideways while its gridline carries on.
 * The fade band in the template is what keeps a label off the card edge now,
 * and it does it without ever moving the label relative to the line it names.
 */
const timeLines = computed(() =>
  time.value.ticks.map((tick) => ({
    key: tick.wallSeconds,
    x: projectX(tick.eventtime),
    label: clockLabel(tick.wallSeconds),
  })),
)

/**
 * How much of the plot's width each end of the label band fades over, as a
 * gradient offset. Roughly half a label, so one leaving is gone before it
 * reaches the value axis and one arriving is legible by the time it clears
 * the edge — and capped, so a very narrow card fades rather than blanking.
 */
const labelFade = computed(() => (plotWidth.value > 0 ? Math.min(0.35, 16 / plotWidth.value) : 0))

const paths = computed(() =>
  drawnSeries.value.flatMap((series) => {
    const entries: Array<{
      key: string
      d: string
      color: string
      kind: 'value' | 'target' | 'power'
    }> = []
    const target = props.showTargets
      ? stepPath(series.targetPoints, projectX, projectY, isSetpoint)
      : ''
    if (target)
      entries.push({
        key: `${series.objectName}-target`,
        d: target,
        color: series.color,
        kind: 'target',
      })
    const power = props.showPower ? linePath(series.powerPoints, projectX, projectPower) : ''
    if (power)
      entries.push({
        key: `${series.objectName}-power`,
        d: power,
        color: series.color,
        kind: 'power',
      })
    const value = linePath(series.points, projectX, projectY)
    if (value)
      entries.push({ key: series.objectName, d: value, color: series.color, kind: 'value' })
    return entries
  }),
)

/**
 * The drawn sample nearest a moment, or null for a series that drew nothing.
 *
 * Matching on time rather than on a shared index, which is what this replaced.
 * Two series do not line up by position: `pointsWithin` omits a history entry
 * where its sensor reported nothing, so a sensor discovered mid-session is
 * short by however many samples it missed — and `downsample` emits each
 * bucket's lowest and highest sample in measured order, so even two
 * equal-length series disagree at the same index whenever one fell while the
 * other rose. Reading `points[index]` off every series therefore put a dot on
 * a temperature from a different moment than the line it sat on, badly so for
 * the sparse sensor. Time is the one axis every series genuinely shares.
 */
function nearestTo(points: readonly TimedValue[], eventtime: number): TimedValue | null {
  let nearest: TimedValue | null = null
  let distance = Number.POSITIVE_INFINITY
  for (const point of points) {
    const gap = Math.abs(point.eventtime - eventtime)
    if (gap < distance) {
      distance = gap
      nearest = point
    }
  }
  return nearest
}

/**
 * The series the cursor snaps its own position to: the first one that actually
 * drew something, not `series[0]`.
 *
 * A charted sensor with no samples yet — one just added, or one whose readings
 * have not arrived — used to take the whole cursor down with it: the chart drew
 * no line and no dots while the table above it went on reading out the past, so
 * the card said it was showing 14:32 with nothing on the plot to say where.
 */
const cursorAnchorPoints = computed(
  () => drawnSeries.value.find((series) => series.points.length > 0)?.points ?? [],
)

/**
 * Reading the past out of the chart, into the table above it.
 *
 * A floating tooltip is the usual answer and it is the wrong one here: on a
 * 271px card the box that would carry three sensors covers the plot it is
 * describing. The card already has a column of names with a column of values
 * beside them, so the values become the ones at the moment under the pointer
 * and the heading says which moment that is. It costs no space at all, and the
 * numbers stay in the column the eye already knows.
 */
const cursor = computed(() => {
  if (cursorEventtime.value === null) return null
  const anchor = nearestTo(cursorAnchorPoints.value, cursorEventtime.value)
  if (!anchor) return null
  return {
    x: projectX(anchor.eventtime),
    eventtime: anchor.eventtime,
    dots: drawnSeries.value.flatMap((series) => {
      const point = nearestTo(series.points, anchor.eventtime)
      return point
        ? [{ key: series.objectName, color: series.color, y: projectY(point.value) }]
        : []
    }),
  }
})

/** Snapped to a sample the chart actually drew, never to wherever the pointer is. */
function eventtimeAt(clientX: number): number | null {
  const element = root.value?.querySelector('svg')
  if (!element) return null
  const box = element.getBoundingClientRect()
  if (box.width === 0) return null
  const local = ((clientX - box.left) / box.width) * width.value
  const span = time.value.end - time.value.start
  if (span <= 0 || plotWidth.value <= 0) return null
  // Backing out the scroll shift, since the pointer lands on where the axis is
  // drawn rather than on where it was laid out.
  const fraction = (local - scrollOffsetPx - gutterStart) / plotWidth.value
  return time.value.start + Math.min(1, Math.max(0, fraction)) * span
}

function moveCursor(clientX: number): void {
  cursorEventtime.value = eventtimeAt(clientX)
}

function clearCursor(): void {
  cursorEventtime.value = null
}

/** Arrow keys walk the samples, so this is not a pointer-only affordance. */
function stepCursor(direction: -1 | 1): void {
  const points = cursorAnchorPoints.value
  if (points.length === 0) return
  // The cursor is always snapped to one of these samples, so this finds it
  // whenever there is one; with none, a step starts from the newest.
  const current = points.findIndex((point) => point.eventtime === cursor.value?.eventtime)
  const from = current < 0 ? points.length - 1 : current
  const next = Math.min(points.length - 1, Math.max(0, from + direction))
  cursorEventtime.value = points[next]?.eventtime ?? null
}

function clockLabel(wallSeconds: number): string {
  const seconds = ((wallSeconds % 86400) + 86400) % 86400
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * The chart is one image to assistive technology, and the readings it draws are
 * already in the table above it as live text — so this names what is plotted
 * rather than trying to narrate a shape.
 */
const description = computed(() => t('dashboard.temperature.chartLabel'))
</script>

<template>
  <div ref="root" class="temperature-chart">
    <!--
      `tabindex` is only here so arrow keys can walk the samples from the
      keyboard — the pointer already scrubs the chart without it. Letting a
      click focus the svg as well gains nothing and costs the ring a plain
      `:focus-visible` rule can't keep off a click: Chromium isn't as
      forgiving of a bare `tabindex` element there as it is of a real button.
      Blocking the pointer's own default focus keeps focus, and the ring,
      keyboard-only.
    -->
    <svg
      v-if="width > 0"
      :viewBox="`0 0 ${width} ${height}`"
      :width="width"
      :height="height"
      role="img"
      tabindex="0"
      :aria-label="description"
      @pointerdown.prevent
      @pointermove="moveCursor($event.clientX)"
      @pointerleave="clearCursor"
      @blur="clearCursor"
      @keydown.left.prevent="stepCursor(-1)"
      @keydown.right.prevent="stepCursor(1)"
      @keydown.esc.prevent="clearCursor"
    >
      <defs>
        <!--
          The plot rectangle, and the reason the axis below may be drawn
          shifted. A series carried past this edge is cut off by it, so the
          newest sample sits just outside rather than at the boundary — which
          is what stops the trace's tip retreating from the right-hand side
          and snapping back each time a sample lands. The left edge is the
          same bargain from the other end, and the caller holds samples from
          before the window (`chartBleedSamples`) so there is always line to
          be cut off there too.
        -->
        <clipPath :id="clipId">
          <rect :x="gutterStart" :y="gutterTop" :width="plotWidth" :height="plotHeight" />
        </clipPath>
        <!--
          The time labels sit below the plot, where a clip would slice one in
          half as it left. Black and white here are a mask's luminance rather
          than paint — the neutral the theme rules already allow — so a label
          leaving fades out and one arriving fades in, without either being
          moved off its own gridline to stay on the card.
        -->
        <linearGradient
          :id="labelFadeId"
          gradientUnits="userSpaceOnUse"
          :x1="gutterStart"
          :x2="gutterStart + plotWidth"
          y1="0"
          y2="0"
        >
          <stop offset="0" stop-color="black" />
          <stop :offset="labelFade" stop-color="white" />
          <stop :offset="1 - labelFade" stop-color="white" />
          <stop offset="1" stop-color="black" />
        </linearGradient>
        <mask :id="labelMaskId">
          <rect
            x="0"
            :y="gutterTop + plotHeight"
            :width="width"
            :height="Math.max(0, height - gutterTop - plotHeight)"
            :fill="`url(#${labelFadeId})`"
          />
        </mask>
      </defs>
      <line
        v-for="line in gridLines"
        :key="`grid-${line.tick}`"
        :x1="gutterStart"
        :y1="line.y"
        :x2="gutterStart + plotWidth"
        :y2="line.y"
        class="temperature-chart__grid"
      />
      <text
        v-for="line in gridLines"
        :key="`value-${line.tick}`"
        :x="gutterStart - 5"
        :y="line.y + 3"
        text-anchor="end"
        class="temperature-chart__label"
      >
        {{ line.label }}
      </text>

      <text
        v-for="tick in powerTicks"
        :key="`power-${tick.fraction}`"
        :x="gutterStart + plotWidth + powerLabelGap"
        :y="tick.y + 3"
        text-anchor="start"
        class="temperature-chart__label"
      >
        {{ Math.round(tick.fraction * 100) }}%
      </text>

      <!--
        Everything measured against the time axis moves as one: the gridlines,
        the trace, and the cursor tied to a sample of it. One transform on one
        group is also what keeps this affordable — the paths are rebuilt only
        when a sample lands, and each frame in between costs a single attribute
        rather than reprojecting every point in every series. The transform is
        set through the ref by `applyScroll`, never bound: a binding read here
        re-rendered the whole svg on every animation frame.
      -->
      <g :clip-path="`url(#${clipId})`">
        <g ref="traceGroup">
          <line
            v-for="line in timeLines"
            :key="`time-grid-${line.key}`"
            :x1="line.x"
            :y1="gutterTop"
            :x2="line.x"
            :y2="gutterTop + plotHeight"
            class="temperature-chart__grid temperature-chart__grid--time"
          />
          <path
            v-for="path in paths"
            :key="path.key"
            :d="path.d"
            class="temperature-chart__series"
            :class="`temperature-chart__series--${path.kind}`"
            :style="{ stroke: path.color }"
          />
          <template v-if="cursor">
            <line
              :x1="cursor.x"
              :y1="gutterTop"
              :x2="cursor.x"
              :y2="gutterTop + plotHeight"
              class="temperature-chart__cursor"
            />
            <circle
              v-for="dot in cursor.dots"
              :key="`cursor-${dot.key}`"
              :cx="cursor.x"
              :cy="dot.y"
              r="2.8"
              class="temperature-chart__cursor-dot"
              :style="{ stroke: dot.color }"
            />
          </template>
        </g>
      </g>

      <!-- The labels travel with their own gridlines, faded rather than clipped. -->
      <g :mask="`url(#${labelMaskId})`">
        <g ref="labelGroup">
          <text
            v-for="line in timeLines"
            :key="`time-${line.key}`"
            :x="line.x"
            :y="height - 3"
            text-anchor="middle"
            class="temperature-chart__label"
          >
            {{ line.label }}
          </text>
        </g>
      </g>
    </svg>
  </div>
</template>
