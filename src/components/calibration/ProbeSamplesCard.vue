<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import {
  probeSamples,
  probeSummaryOf,
  sampleScale,
  summarize,
} from '@/features/calibration/bedContext'
import { useCalibrationStore } from '@/stores/calibration'

/**
 * `PROBE_ACCURACY` seen from the side: every sample a short line at the
 * height it triggered, in the order it was taken, across the band from the
 * lowest to the highest. A range and a standard deviation say how much the
 * probe wandered; the picture says how — one outlier, a steady drift as the
 * probe warmed, or an even scatter — which is what decides whether to clean
 * the pin, let the bed soak, or accept it.
 *
 * The samples are this sitting's run, drawn as they arrive. The log keeps a
 * run's summary rather than its samples, so an earlier run is drawn as its
 * lowest, highest, average and median lines.
 */
const { t, locale } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()

const width = 320
const height = 150
const plotLeft = 64
const plotRight = width - 8
const plotTop = 10
const plotBottom = height - 10

const samples = computed(() => probeSamples(calibration.linesFor('probeAccuracy')))
const isRunning = computed(() => calibration.runFor('probeAccuracy')?.running === true)

const logged = computed(() => {
  const history = calibration.historyFor('probeAccuracy')
  return probeSummaryOf(history[history.length - 1])
})

const summary = computed(() => summarize(samples.value) ?? logged.value)
const fromSamples = computed(() => samples.value.length > 0)

const scale = computed(() => (summary.value ? sampleScale(summary.value) : null))

function y(z: number): number {
  return plotTop + (scale.value?.at(z) ?? 0.5) * (plotBottom - plotTop)
}

const heightFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
)

function millimetres(value: number): string {
  return heightFormatter.value.format(value)
}

const sampleLines = computed(() => {
  const count = samples.value.length
  const step = (plotRight - plotLeft) / Math.max(count, 1)
  return samples.value.map((z, index) => ({
    x1: plotLeft + step * index + step * 0.2,
    x2: plotLeft + step * (index + 1) - step * 0.2,
    y: y(z),
  }))
})

const referenceLines = computed(() => {
  const value = summary.value
  if (!value) return []
  // The average is labelled over its line and the median under it: the two
  // are usually within a micron of each other and would print on one spot.
  const lines: { key: string; z: number; label: string; offset: number }[] = []
  if (value.average !== null) {
    lines.push({
      key: 'average',
      z: value.average,
      label: t('calibration.probe.average'),
      offset: -4,
    })
  }
  if (!fromSamples.value && value.median !== null) {
    lines.push({ key: 'median', z: value.median, label: t('calibration.probe.median'), offset: 12 })
  }
  return lines
})

/** One standard deviation either side of the average, where the result reports both. */
const deviationBand = computed(() => {
  const value = summary.value
  if (!value || value.average === null || value.standardDeviation === null) return null
  const top = y(value.average + value.standardDeviation)
  return { y: top, height: Math.max(y(value.average - value.standardDeviation) - top, 1) }
})

const description = computed(() =>
  summary.value
    ? t('calibration.context.samples.summary', {
        count: samples.value.length,
        minimum: millimetres(summary.value.minimum),
        maximum: millimetres(summary.value.maximum),
      })
    : '',
)

const facts = computed(() => {
  const value = summary.value
  if (!value) return []
  const facts = [
    {
      key: 'range',
      label: t('calibration.probe.range'),
      value: `${millimetres(value.maximum - value.minimum)} mm`,
    },
  ]
  if (value.standardDeviation !== null) {
    facts.push({
      key: 'standardDeviation',
      label: t('calibration.probe.standardDeviation'),
      value: `${millimetres(value.standardDeviation)} mm`,
    })
  }
  return facts
})
</script>

<template>
  <CalibrationCard :title="t('calibration.context.samples.title')">
    <template #aside>
      <span class="calibration-context__aside">
        {{
          fromSamples
            ? t('calibration.context.samples.count', { count: samples.length })
            : summary
              ? t('calibration.context.samples.lastRun')
              : ''
        }}
      </span>
    </template>

    <p v-if="!summary" class="calibration-panel__hint">
      {{
        isRunning
          ? t('calibration.context.samples.waiting')
          : t('calibration.context.samples.empty')
      }}
    </p>

    <template v-else>
      <svg
        class="calibration-context__figure calibration-samples"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        :aria-label="description"
      >
        <rect
          class="calibration-samples__band"
          :x="plotLeft"
          :y="y(summary.maximum)"
          :width="plotRight - plotLeft"
          :height="Math.max(y(summary.minimum) - y(summary.maximum), 1)"
        />
        <rect
          v-if="deviationBand"
          class="calibration-samples__deviation"
          :x="plotLeft"
          :y="deviationBand.y"
          :width="plotRight - plotLeft"
          :height="deviationBand.height"
        />
        <line
          v-for="(edge, index) in [summary.maximum, summary.minimum]"
          :key="index"
          class="calibration-samples__edge"
          :x1="plotLeft"
          :x2="plotRight"
          :y1="y(edge)"
          :y2="y(edge)"
        />
        <text
          class="calibration-context__label"
          :x="plotLeft - 6"
          :y="y(summary.maximum)"
          text-anchor="end"
          dominant-baseline="middle"
        >
          {{ millimetres(summary.maximum) }}
        </text>
        <text
          class="calibration-context__label"
          :x="plotLeft - 6"
          :y="y(summary.minimum)"
          text-anchor="end"
          dominant-baseline="middle"
        >
          {{ millimetres(summary.minimum) }}
        </text>

        <g v-for="reference in referenceLines" :key="reference.key">
          <line
            class="calibration-samples__reference"
            :x1="plotLeft"
            :x2="plotRight"
            :y1="y(reference.z)"
            :y2="y(reference.z)"
          />
          <text
            class="calibration-context__label"
            :x="plotRight"
            :y="y(reference.z) + reference.offset"
            text-anchor="end"
          >
            {{ reference.label }}
          </text>
        </g>

        <line
          v-for="(sample, index) in sampleLines"
          :key="index"
          class="calibration-samples__sample"
          :x1="sample.x1"
          :x2="sample.x2"
          :y1="sample.y"
          :y2="sample.y"
        />
      </svg>

      <dl class="calibration-context__facts">
        <div v-for="fact in facts" :key="fact.key" class="calibration-context__fact">
          <dt>{{ fact.label }}</dt>
          <dd>{{ fact.value }}</dd>
        </div>
      </dl>
    </template>
  </CalibrationCard>
</template>
