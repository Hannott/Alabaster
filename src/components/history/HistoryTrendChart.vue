<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { valueScale, type TimedValue } from '@/dashboard/chartGeometry'
import { formatHistoryDuration, formatHistoryFilament } from '@/features/history/format'
import type { HistoryBucket, HistoryStatsMeasure } from '@/features/history/statistics'

/**
 * A static, categorical bar chart — never a continuous time axis — because a
 * bucket's own width is a calendar unit (a day, a week, a month) and those are
 * not equal numbers of seconds. Equal-width columns are the honest shape for
 * that; a linear time axis would draw a 31-day month narrower than a 28-day
 * one for no reason a reader could see.
 */
const props = defineProps<{
  buckets: readonly HistoryBucket[]
  measure: HistoryStatsMeasure
}>()

const { t, locale } = useI18n({ useScope: 'global' })

function measureValue(completed: number, notCompleted: number): number {
  return completed + notCompleted
}

/**
 * Millimetres and seconds are the units the history store keeps, but they are
 * not the units an axis should count in: a 90-day window's per-bucket totals
 * run into the tens of thousands of either, and `chartGeometry`'s tick ladder
 * — built for temperature-sized ranges — has no rung coarse enough to keep
 * that to a handful of gridlines. Scaling to metres and hours here, the same
 * units the rest of History already reports in, brings the range back down to
 * where that ladder was designed to work.
 */
const measureUnitDivisor: Record<HistoryStatsMeasure, number> = {
  jobs: 1,
  filament: 1000,
  time: 3600,
}

function bucketValues(bucket: HistoryBucket): { completed: number; notCompleted: number } {
  const divisor = measureUnitDivisor[props.measure]
  if (props.measure === 'filament') {
    return {
      completed: bucket.completedFilament / divisor,
      notCompleted: bucket.notCompletedFilament / divisor,
    }
  }
  if (props.measure === 'time') {
    return {
      completed: bucket.completedTime / divisor,
      notCompleted: bucket.notCompletedTime / divisor,
    }
  }
  return { completed: bucket.completedJobs, notCompleted: bucket.notCompletedJobs }
}

const width = 480
const height = 170
const margin = { top: 10, right: 8, bottom: 22, left: 34 }
const plotWidth = width - margin.left - margin.right
const plotHeight = height - margin.top - margin.bottom

const scale = computed(() => {
  const series: TimedValue[][] = [
    props.buckets.map((bucket, index) => {
      const { completed, notCompleted } = bucketValues(bucket)
      return { eventtime: index, value: measureValue(completed, notCompleted) }
    }),
  ]
  return valueScale(series, { lockToZero: true, maximumTicks: 4 })
})

function projectY(value: number): number {
  const { minimum, maximum } = scale.value
  if (maximum <= minimum) return margin.top + plotHeight
  const fraction = (value - minimum) / (maximum - minimum)
  return margin.top + plotHeight * (1 - fraction)
}

const columnWidth = computed(() => {
  const count = props.buckets.length || 1
  const gap = Math.min(6, plotWidth / count / 4)
  return { gap, width: plotWidth / count - gap }
})

const columns = computed(() =>
  props.buckets.map((bucket, index) => {
    const { completed, notCompleted } = bucketValues(bucket)
    const x = margin.left + index * (plotWidth / props.buckets.length)
    const completedTop = projectY(completed)
    const stackedTop = projectY(completed + notCompleted)
    const baseline = margin.top + plotHeight
    return {
      key: bucket.start,
      x,
      completedY: completedTop,
      completedHeight: Math.max(0, baseline - completedTop),
      notCompletedY: stackedTop,
      notCompletedHeight: Math.max(0, completedTop - stackedTop),
    }
  }),
)

const dateFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' }),
)

/** Every label would collide on a 90-bucket window; a handful spread across it reads fine. */
const labeledIndexes = computed(() => {
  const count = props.buckets.length
  if (count === 0) return new Set<number>()
  const target = Math.min(5, count)
  const step = Math.max(1, Math.round(count / target))
  const indexes = new Set<number>()
  for (let index = 0; index < count; index += step) indexes.add(index)
  indexes.add(count - 1)
  return indexes
})

const ticks = computed(() => scale.value.ticks)

const integerFormatter = computed(() => new Intl.NumberFormat(locale.value))

/** The axis reads in the same units `bucketValues` scaled to, not the store's raw mm/seconds. */
function tickLabel(tick: number): string {
  if (props.measure === 'filament') return t('history.filamentValue', { value: tick })
  if (props.measure === 'time') return t('history.stats.trend.axisHours', { value: tick })
  return integerFormatter.value.format(tick)
}

const description = computed(() => {
  const count = props.buckets.length
  const measureLabel = t(`history.stats.measure.${props.measure}`)
  return t('history.stats.trend.description', { count, measure: measureLabel })
})

/**
 * The hit target spans a column's full plot height, not just the (possibly
 * short, possibly zero) painted bar — a bucket with no completed jobs still
 * needs somewhere to hover to learn that.
 */
const hoveredIndex = ref<number | null>(null)

/**
 * Built once per bucket set rather than per hit target per render. Hovering a
 * column changes `hoveredIndex`, which re-renders this component, and a label
 * function called from the template would rebuild every bucket's sentence —
 * two formatted values and a formatted date range each — on every one of those
 * renders, for a string that only the focused target ever reads out. At the 500
 * buckets `historyTrend`'s own backstop allows, that is the difference between
 * a hover costing nothing and a hover costing the whole axis.
 */
const bucketLabels = computed(() =>
  props.buckets.map((bucket) => {
    const range = t('history.stats.trend.tooltipRange', {
      start: dateFormatter.value.format(bucket.start * 1000),
      end: dateFormatter.value.format((bucket.end - 1) * 1000),
    })
    const completed = t('history.stats.trend.tooltipCompleted')
    const notCompleted = t('history.stats.trend.tooltipNotCompleted')
    return `${range}: ${completed} ${rawValueLabel(bucket, 'completed')}, ${notCompleted} ${rawValueLabel(bucket, 'notCompleted')}`
  }),
)

/** Formatted from the bucket's own stored units, never from the axis-scaled values, so rounding for display never compounds with rounding for the grid. */
function rawValueLabel(bucket: HistoryBucket, kind: 'completed' | 'notCompleted'): string {
  if (props.measure === 'filament') {
    const raw = kind === 'completed' ? bucket.completedFilament : bucket.notCompletedFilament
    return formatHistoryFilament(raw, t, locale.value)
  }
  if (props.measure === 'time') {
    const raw = kind === 'completed' ? bucket.completedTime : bucket.notCompletedTime
    return formatHistoryDuration(raw, t)
  }
  const raw = kind === 'completed' ? bucket.completedJobs : bucket.notCompletedJobs
  return integerFormatter.value.format(raw)
}

const tooltip = computed(() => {
  const index = hoveredIndex.value
  if (index === null) return null
  const bucket = props.buckets[index]
  const column = columns.value[index]
  if (!bucket || !column) return null
  return {
    left: Math.min(92, Math.max(8, ((column.x + columnWidth.value.width / 2) / width) * 100)),
    range: t('history.stats.trend.tooltipRange', {
      start: dateFormatter.value.format(bucket.start * 1000),
      end: dateFormatter.value.format((bucket.end - 1) * 1000),
    }),
    completed: rawValueLabel(bucket, 'completed'),
    notCompleted: rawValueLabel(bucket, 'notCompleted'),
  }
})
</script>

<template>
  <div v-if="buckets.length > 0" class="history-trend-wrapper">
    <div v-if="tooltip" class="history-trend__tooltip" :style="{ left: `${tooltip.left}%` }">
      <p class="history-trend__tooltip-range">{{ tooltip.range }}</p>
      <p>
        <span class="history-trend__tooltip-swatch history-trend__tooltip-swatch--completed" />
        {{ t('history.stats.trend.tooltipCompleted') }}: {{ tooltip.completed }}
      </p>
      <p>
        <span class="history-trend__tooltip-swatch history-trend__tooltip-swatch--not-completed" />
        {{ t('history.stats.trend.tooltipNotCompleted') }}: {{ tooltip.notCompleted }}
      </p>
    </div>
    <svg
      :viewBox="`0 0 ${width} ${height}`"
      class="history-trend"
      role="img"
      :aria-label="description"
    >
      <line
        v-for="tick in ticks"
        :key="tick"
        class="history-trend__grid"
        :x1="margin.left"
        :x2="width - margin.right"
        :y1="projectY(tick)"
        :y2="projectY(tick)"
      />
      <text
        v-for="tick in ticks"
        :key="`label-${tick}`"
        class="history-trend__tick-label"
        :x="margin.left - 4"
        :y="projectY(tick) + 3"
        text-anchor="end"
      >
        {{ tickLabel(tick) }}
      </text>
      <line
        class="history-trend__axis"
        :x1="margin.left"
        :x2="width - margin.right"
        :y1="margin.top + plotHeight"
        :y2="margin.top + plotHeight"
      />
      <g v-for="(column, index) in columns" :key="column.key">
        <rect
          class="history-trend__bar history-trend__bar--completed"
          :x="column.x + columnWidth.gap / 2"
          :y="column.completedY"
          :width="columnWidth.width"
          :height="column.completedHeight"
        />
        <rect
          v-if="column.notCompletedHeight > 0"
          class="history-trend__bar history-trend__bar--not-completed"
          :x="column.x + columnWidth.gap / 2"
          :y="column.notCompletedY"
          :width="columnWidth.width"
          :height="column.notCompletedHeight"
        />
        <text
          v-if="labeledIndexes.has(index)"
          class="history-trend__tick-label"
          :x="column.x + columnWidth.gap / 2 + columnWidth.width / 2"
          :y="height - 6"
          text-anchor="middle"
        >
          {{ dateFormatter.format(buckets[index]!.start * 1000) }}
        </text>
        <!--
          The hit target spans the whole plot height and the column's full
          width including its gap — hovering anywhere in a bucket's vertical
          band shows its detail, not only the painted pixels of a bar that may
          be short or, for a bucket with nothing completed, absent entirely.
          Focusable so the same detail reaches keyboard users, not only a
          mouse — see `docs/design/interface-standards.md`'s History contract.
        -->
        <rect
          class="history-trend__hit"
          :x="column.x"
          :y="margin.top"
          :width="plotWidth / buckets.length"
          :height="plotHeight"
          tabindex="0"
          role="img"
          :aria-label="bucketLabels[index]"
          @mouseenter="hoveredIndex = index"
          @mouseleave="hoveredIndex = null"
          @focus="hoveredIndex = index"
          @blur="hoveredIndex = null"
        />
      </g>
    </svg>
  </div>
</template>
