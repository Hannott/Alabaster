<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import { useProcedureContext } from '@/composables/useProcedureContext'
import {
  parseAxesMap,
  sameAxesMap,
  type Axis,
  type ChipAxisDirection,
} from '@/features/calibration/axesMapping'
import { axesMapChip, type ProcedureResultRow } from '@/features/calibration/procedures'
import { useCalibrationStore } from '@/stores/calibration'

/**
 * The accelerometer drawn the way it is mounted: the printer's X, Y and Z,
 * and beside them the chip's own three axes pointing where the `axes_map` in
 * the file says they point — and, once `AXES_MAP_CALIBRATION` has run, where
 * it found them pointing. `-y, x, z` is three tokens a reader has to turn
 * around in their head; two sets of arrows that disagree are a board mounted
 * a quarter-turn from what the file assumes, which they can check by looking
 * at the silkscreen on the chip.
 */
const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const context = useProcedureContext()

const chip = computed(() => axesMapChip(context.value))

const fileMap = computed(() => {
  if (chip.value === null) return null
  const value = context.value.settings(chip.value)?.axes_map
  if (Array.isArray(value)) return value.map(String).join(',')
  return typeof value === 'string' ? value : 'x,y,z'
})

function mapRow(rows: readonly ProcedureResultRow[] | undefined): string | null {
  const row = rows?.find(
    (candidate) => 'literal' in candidate.label && candidate.label.literal === 'axes_map',
  )
  return row?.after || null
}

/** This sitting's run, or else the newest one in the log. */
const detectedMap = computed(
  () =>
    mapRow(calibration.resultFor('axesMap')?.rows) ??
    mapRow(calibration.historyFor('axesMap').at(-1)?.rows),
)

interface Tripod {
  key: string
  title: string
  text: string
  arrows: { label: string; vector: [number, number]; chip: boolean }[]
}

/** Printer axes on the page: X to the right, Y into the page, Z up. */
const printerVectors: Record<Axis, [number, number]> = {
  x: [1, 0],
  y: [0.62, -0.55],
  z: [0, -1],
}

function signed(direction: ChipAxisDirection): string {
  return `${direction.sign < 0 ? '−' : '+'}${direction.printer.toUpperCase()}`
}

function chipTripod(key: string, title: string, map: string | null): Tripod | null {
  const directions = parseAxesMap(map)
  if (!directions) return null
  return {
    key,
    title,
    text: directions.map((direction) => `${direction.chip} → ${signed(direction)}`).join(' · '),
    arrows: directions.map((direction) => {
      const [x, y] = printerVectors[direction.printer]
      return { label: direction.chip, vector: [x * direction.sign, y * direction.sign], chip: true }
    }),
  }
}

const tripods = computed<Tripod[]>(() => {
  const printer: Tripod = {
    key: 'printer',
    title: t('calibration.context.axesMap.printer'),
    text: '',
    arrows: (['x', 'y', 'z'] as const).map((axis) => ({
      label: axis.toUpperCase(),
      vector: printerVectors[axis],
      chip: false,
    })),
  }
  const list = [printer]
  const file = chipTripod('file', t('calibration.context.axesMap.file'), fileMap.value)
  if (file) list.push(file)
  if (detectedMap.value !== null && !sameAxesMap(detectedMap.value, fileMap.value)) {
    const detected = chipTripod(
      'detected',
      t('calibration.context.axesMap.detected'),
      detectedMap.value,
    )
    if (detected) list.push(detected)
  }
  return list
})

const matches = computed(
  () => detectedMap.value !== null && sameAxesMap(detectedMap.value, fileMap.value),
)

const cell = 150
const length = 42
const origin: [number, number] = [75, 75]

function tip(vector: [number, number], scale = 1): [number, number] {
  return [origin[0] + vector[0] * length * scale, origin[1] + vector[1] * length * scale]
}

function head(vector: [number, number]): string {
  const [x, y] = tip(vector)
  const angle = Math.atan2(vector[1], vector[0])
  const spread = 0.45
  const size = 8
  const left = [x - size * Math.cos(angle - spread), y - size * Math.sin(angle - spread)]
  const right = [x - size * Math.cos(angle + spread), y - size * Math.sin(angle + spread)]
  return `${left[0]},${left[1]} ${x},${y} ${right[0]},${right[1]}`
}
</script>

<template>
  <CalibrationCard :title="t('calibration.context.axesMap.title')">
    <template v-if="chip" #aside>
      <span class="calibration-context__aside calibration-context__aside--mono">[{{ chip }}]</span>
    </template>

    <p v-if="!chip" class="calibration-panel__hint">
      {{ t('calibration.context.axesMap.noChip') }}
    </p>

    <template v-else>
      <div class="calibration-tripods">
        <figure v-for="tripod in tripods" :key="tripod.key" class="calibration-tripod">
          <svg
            class="calibration-tripod__figure"
            :viewBox="`0 0 ${cell} ${cell}`"
            role="img"
            :aria-label="`${tripod.title}: ${tripod.text || tripod.arrows.map((arrow) => arrow.label).join(', ')}`"
          >
            <g
              v-for="arrow in tripod.arrows"
              :key="arrow.label"
              class="calibration-tripod__arrow"
              :class="{ 'calibration-tripod__arrow--chip': arrow.chip }"
            >
              <line
                :x1="origin[0]"
                :y1="origin[1]"
                :x2="tip(arrow.vector)[0]"
                :y2="tip(arrow.vector)[1]"
              />
              <polyline :points="head(arrow.vector)" />
              <text
                :x="tip(arrow.vector, 1.32)[0]"
                :y="tip(arrow.vector, 1.32)[1]"
                text-anchor="middle"
                dominant-baseline="central"
              >
                {{ arrow.label }}
              </text>
            </g>
          </svg>
          <figcaption class="calibration-tripod__caption">
            <span class="calibration-tripod__title">{{ tripod.title }}</span>
            <span v-if="tripod.text" class="calibration-tripod__map">{{ tripod.text }}</span>
          </figcaption>
        </figure>
      </div>

      <p v-if="matches" class="calibration-panel__hint">
        {{ t('calibration.context.axesMap.matches') }}
      </p>
    </template>
  </CalibrationCard>
</template>
