<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import {
  levelingLayout,
  onPlan,
  planBox,
  type BedPoint,
  type LayoutProcedure,
} from '@/features/calibration/bedContext'
import {
  configuredScrews,
  levelWithinMinutes,
  screwReadings,
  type ScrewReading,
} from '@/features/calibration/screws'
import { useBedScrewsStore } from '@/stores/bedScrews'
import { useCalibrationStore } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useScrewsTiltStore } from '@/stores/screwsTilt'

/**
 * The bed from above, to scale, with what a levelling procedure works with
 * drawn where the configuration puts it: the screws and what the last
 * `SCREWS_TILT_CALCULATE` found at each, the screws `BED_SCREWS_ADJUST` walks
 * with the one it is standing at marked, or the Z steppers and the points
 * `Z_TILT_ADJUST` and `QUAD_GANTRY_LEVEL` probe. The nozzle is drawn on it
 * once X and Y are homed, so the reader can see which screw it is over.
 *
 * The workspace's screw grid is the result to act on and keeps its "Go to"
 * buttons; this is the same bed at its real proportions, and it is drawn
 * before any run, from the configuration alone, which is when somebody is
 * checking that the screws in the file are the screws on the machine.
 */
const props = defineProps<{ procedure: LayoutProcedure }>()

const { t, locale } = useI18n({ useScope: 'global' })
const bedScrews = useBedScrewsStore()
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const screwsTilt = useScrewsTiltStore()

interface ScrewMarker {
  key: string
  name: string
  point: BedPoint
  reading: ScrewReading | null
  current: boolean
}

const screws = computed<ScrewMarker[]>(() => {
  if (props.procedure === 'screwsTilt') {
    const settings = printerConfig.section('screws_tilt_adjust')
    const readings = screwReadings(screwsTilt.status, settings)
    return configuredScrews(settings).map((screw) => ({
      key: screw.key,
      name: screw.name,
      point: { x: screw.x, y: screw.y },
      reading: readings.find((reading) => reading.key === screw.key) ?? null,
      current: false,
    }))
  }
  if (props.procedure === 'bedScrews') {
    const visited =
      bedScrews.pass === 'fine'
        ? printerConfig.bedScrews.filter((screw) => screw.hasFineAdjust)
        : printerConfig.bedScrews
    const current = bedScrews.isActive ? visited[bedScrews.currentScrew] : undefined
    return printerConfig.bedScrews.map((screw, index) => ({
      key: `screw${index + 1}`,
      name: screw.name ?? `${index + 1}`,
      point: { x: screw.x, y: screw.y },
      reading: null,
      current: screw === current,
    }))
  }
  return []
})

const leveling = computed(() =>
  props.procedure === 'zTilt'
    ? levelingLayout('zTilt', printerConfig.section('z_tilt'))
    : props.procedure === 'quadGantryLevel'
      ? levelingLayout('quadGantryLevel', printerConfig.section('quad_gantry_level'))
      : null,
)

const box = computed(() =>
  planBox(printer.buildVolume, [
    ...screws.value.map((screw) => screw.point),
    ...(leveling.value?.steppers ?? []),
    ...(leveling.value?.points ?? []),
  ]),
)

/** One size for every mark and label, from the drawing's own scale rather than pixels. */
const unit = computed(() => (box.value ? Math.max(box.value.width, box.value.depth) / 100 : 1))

const bed = computed(() => {
  const plan = box.value
  const [minX, minY] = printer.buildVolume.minimum
  const [maxX, maxY] = printer.buildVolume.maximum
  if (!plan || typeof minX !== 'number' || typeof minY !== 'number') return null
  if (typeof maxX !== 'number' || typeof maxY !== 'number') return null
  const corner = onPlan({ x: minX, y: maxY }, plan)
  return {
    x: corner.x,
    y: corner.y,
    width: maxX - minX,
    depth: maxY - minY,
    circular: printerConfig.bedShape === 'circular',
  }
})

const nozzle = computed(() => {
  const plan = box.value
  const homed = printer.motion.homedAxes.toLowerCase()
  if (!plan || !homed.includes('x') || !homed.includes('y')) return null
  const [x, y] = printer.toolheadPosition
  if (x === null || y === null) return null
  return onPlan({ x, y }, plan)
})

function place(point: BedPoint): BedPoint {
  return box.value ? onPlan(point, box.value) : point
}

/** Labels go under a mark, or over it for one near the front edge. */
function labelBelow(point: BedPoint): boolean {
  return box.value ? place(point).y < box.value.depth * 0.75 : true
}

const heightFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
)

function screwLines(screw: ScrewMarker): string[] {
  const lines = [screw.name]
  const reading = screw.reading
  if (reading) {
    if (reading.isBase) lines.push(t('calibration.screws.base'))
    else if (reading.minutes < levelWithinMinutes) lines.push(t('calibration.screws.level'))
    else lines.push(`${reading.sign} ${reading.adjust}`)
    lines.push(t('calibration.screws.z', { value: heightFormatter.value.format(reading.z) }))
  }
  if (screw.current) lines.push(t('calibration.context.layout.current'))
  return lines
}

function screwState(screw: ScrewMarker): string {
  if (screw.current) return 'current'
  const reading = screw.reading
  if (!reading) return 'plain'
  if (reading.isBase) return 'base'
  return reading.minutes < levelWithinMinutes ? 'level' : 'adjust'
}

/** Klipper's own stepper names: `stepper_z`, then `stepper_z1` onwards. */
function stepperName(index: number): string {
  return index === 0 ? 'z' : `z${index}`
}

const lastRange = computed(() => {
  if (props.procedure !== 'zTilt' && props.procedure !== 'quadGantryLevel') return null
  const history = calibration.historyFor(props.procedure)
  const row = history[history.length - 1]?.rows.find(
    (candidate) => 'key' in candidate.label && candidate.label.key === 'calibration.result.range',
  )
  return row?.after ?? null
})

const title = computed(() =>
  leveling.value
    ? t('calibration.context.layout.levelingTitle')
    : t('calibration.context.layout.screwsTitle'),
)

const isEmpty = computed(
  () =>
    screws.value.length === 0 &&
    (leveling.value?.steppers.length ?? 0) === 0 &&
    (leveling.value?.points.length ?? 0) === 0,
)
</script>

<template>
  <CalibrationCard :title="title">
    <template v-if="lastRange !== null" #aside>
      <span class="calibration-context__aside">
        {{ t('calibration.context.layout.range', { value: lastRange }) }}
      </span>
    </template>

    <p v-if="!box || isEmpty" class="calibration-panel__hint">
      {{ t('calibration.context.layout.unknown') }}
    </p>

    <svg
      v-else
      class="calibration-context__figure calibration-layout"
      :viewBox="`0 0 ${box.width} ${box.depth}`"
      role="img"
      :aria-label="title"
      :style="{ '--layout-unit': unit }"
    >
      <template v-if="bed">
        <ellipse
          v-if="bed.circular"
          class="calibration-layout__bed"
          :cx="bed.x + bed.width / 2"
          :cy="bed.y + bed.depth / 2"
          :rx="bed.width / 2"
          :ry="bed.depth / 2"
        />
        <rect
          v-else
          class="calibration-layout__bed"
          :x="bed.x"
          :y="bed.y"
          :width="bed.width"
          :height="bed.depth"
          :rx="unit"
        />
      </template>

      <g v-if="leveling">
        <polyline
          v-if="leveling.points.length > 1"
          class="calibration-layout__path"
          :points="leveling.points.map((point) => `${place(point).x},${place(point).y}`).join(' ')"
        />
        <g v-for="(point, index) in leveling.points" :key="`point-${index}`">
          <circle
            class="calibration-layout__point"
            :cx="place(point).x"
            :cy="place(point).y"
            :r="unit * 2.2"
          />
          <text
            class="calibration-layout__point-number"
            :x="place(point).x"
            :y="place(point).y"
            :font-size="unit * 2.6"
            text-anchor="middle"
            dominant-baseline="central"
          >
            {{ index + 1 }}
          </text>
        </g>
        <g v-for="(stepper, index) in leveling.steppers" :key="`stepper-${index}`">
          <rect
            class="calibration-layout__stepper"
            :x="place(stepper).x - unit * 2.6"
            :y="place(stepper).y - unit * 2.6"
            :width="unit * 5.2"
            :height="unit * 5.2"
            :rx="unit * 0.6"
          />
          <text
            class="calibration-layout__screw-text calibration-layout__screw-text--name"
            :x="place(stepper).x"
            :y="place(stepper).y + (labelBelow(stepper) ? unit * 7 : -unit * 4.5)"
            :font-size="unit * 3.2"
            text-anchor="middle"
          >
            {{ stepperName(index) }}
          </text>
        </g>
      </g>

      <g
        v-for="screw in screws"
        :key="screw.key"
        class="calibration-layout__screw"
        :class="`calibration-layout__screw--${screwState(screw)}`"
      >
        <circle :cx="place(screw.point).x" :cy="place(screw.point).y" :r="unit * 3" />
        <line
          :x1="place(screw.point).x - unit * 1.8"
          :x2="place(screw.point).x + unit * 1.8"
          :y1="place(screw.point).y"
          :y2="place(screw.point).y"
        />
        <text
          v-for="(line, index) in screwLines(screw)"
          :key="index"
          class="calibration-layout__screw-text"
          :class="{ 'calibration-layout__screw-text--name': index === 0 }"
          :x="place(screw.point).x"
          :y="
            labelBelow(screw.point)
              ? place(screw.point).y + unit * (8 + index * 4)
              : place(screw.point).y - unit * (5 + (screwLines(screw).length - 1 - index) * 4)
          "
          :font-size="unit * 3.2"
          text-anchor="middle"
        >
          {{ line }}
        </text>
      </g>

      <g v-if="nozzle" class="calibration-layout__nozzle">
        <circle :cx="nozzle.x" :cy="nozzle.y" :r="unit * 1.6" />
        <line :x1="nozzle.x - unit * 3" :x2="nozzle.x + unit * 3" :y1="nozzle.y" :y2="nozzle.y" />
        <line :x1="nozzle.x" :x2="nozzle.x" :y1="nozzle.y - unit * 3" :y2="nozzle.y + unit * 3" />
      </g>
    </svg>

    <ul v-if="box && !isEmpty" class="calibration-context__legend">
      <li v-if="screws.length > 0">
        <span
          class="calibration-context__key calibration-context__key--screw"
          aria-hidden="true"
        ></span>
        {{ t('calibration.context.layout.screw') }}
      </li>
      <li v-if="(leveling?.steppers.length ?? 0) > 0">
        <span
          class="calibration-context__key calibration-context__key--stepper"
          aria-hidden="true"
        ></span>
        {{ t('calibration.context.layout.stepper') }}
      </li>
      <li v-if="(leveling?.points.length ?? 0) > 0">
        <span
          class="calibration-context__key calibration-context__key--point"
          aria-hidden="true"
        ></span>
        {{ t('calibration.context.layout.point') }}
      </li>
      <li v-if="nozzle">
        <span
          class="calibration-context__key calibration-context__key--nozzle"
          aria-hidden="true"
        ></span>
        {{ t('calibration.context.layout.nozzle') }}
      </li>
    </ul>
  </CalibrationCard>
</template>
