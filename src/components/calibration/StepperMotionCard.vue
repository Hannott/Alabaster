<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import { levelingLayout, onPlan, planBox } from '@/features/calibration/bedContext'
import { planDirectionKey, stepperMotion } from '@/features/calibration/stepperMotion'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * Which way the machine should move when `STEPPER_BUZZ` turns this stepper
 * forward — the answer the stepper check asks the reader for once it has run.
 * "Did it move the right way" has no answer without knowing the right way,
 * and on CoreXY the right way for one motor is a diagonal nobody guesses.
 *
 * A Z stepper on a printer that levels with `z_tilt` or `quad_gantry_level`
 * is drawn where it lifts, since which corner rose is how the reader tells
 * `stepper_z1` from `stepper_z2`.
 */
const props = defineProps<{ stepper: string }>()

const { t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()

const kinematics = computed(() => {
  const value = printerConfig.section('printer')?.kinematics
  return typeof value === 'string' ? value : null
})

const motion = computed(() => stepperMotion(props.stepper, kinematics.value))

const width = 320
const height = 200
const centre = { x: 160, y: 95 }
const reach = 70

function arrowHead(x1: number, y1: number, x2: number, y2: number, size = 9): string {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const spread = 0.45
  const left = [x2 - size * Math.cos(angle - spread), y2 - size * Math.sin(angle - spread)]
  const right = [x2 - size * Math.cos(angle + spread), y2 - size * Math.sin(angle + spread)]
  return `${left[0]},${left[1]} ${x2},${y2} ${right[0]},${right[1]}`
}

/** The move as an arrow from the toolhead, for the two views that have one. */
const arrow = computed(() => {
  const value = motion.value
  if (value?.kind === 'plan') {
    return { x2: centre.x + value.x * reach, y2: centre.y - value.y * reach }
  }
  if (value?.kind === 'front') {
    return { x2: centre.x + value.x * reach, y2: centre.y - value.z * reach }
  }
  return null
})

/** The Z steppers where the levelling section puts them, with this one's number. */
const zPlan = computed(() => {
  const value = motion.value
  if (value?.kind !== 'z') return null
  const layout =
    levelingLayout('quadGantryLevel', printerConfig.section('quad_gantry_level')) ??
    levelingLayout('zTilt', printerConfig.section('z_tilt'))
  if (!layout || layout.steppers.length <= value.index) return null
  const box = planBox(printer.buildVolume, layout.steppers)
  if (!box) return null
  const scale = Math.min((width - 40) / box.width, (height - 40) / box.depth)
  const offsetX = (width - box.width * scale) / 2
  const offsetY = (height - box.depth * scale) / 2
  const place = (point: { x: number; y: number }) => {
    const planned = onPlan(point, box)
    return { x: offsetX + planned.x * scale, y: offsetY + planned.y * scale }
  }
  const [minX, minY] = printer.buildVolume.minimum
  const [maxX, maxY] = printer.buildVolume.maximum
  const bed =
    typeof minX === 'number' &&
    typeof minY === 'number' &&
    typeof maxX === 'number' &&
    typeof maxY === 'number'
      ? {
          ...place({ x: minX, y: maxY }),
          width: (maxX - minX) * scale,
          depth: (maxY - minY) * scale,
        }
      : null
  return {
    bed,
    steppers: layout.steppers.map((point, index) => ({
      ...place(point),
      name: index === 0 ? 'z' : `z${index}`,
      active: index === value.index,
    })),
  }
})

/** Klipper's delta towers stand at 210°, 330° and 90°: front left, front right, back. */
const towers = computed(() => {
  const value = motion.value
  if (value?.kind !== 'tower') return []
  return (
    [
      ['a', 210],
      ['b', 330],
      ['c', 90],
    ] as const
  ).map(([tower, degrees]) => {
    const radians = (degrees * Math.PI) / 180
    return {
      tower,
      x: centre.x + 80 * Math.cos(radians),
      y: centre.y - 80 * Math.sin(radians),
      active: tower === value.tower,
    }
  })
})

const sentence = computed(() => {
  const value = motion.value
  if (!value) return ''
  if (value.kind === 'plan') {
    const isCartesianY =
      /cartesian/.test(kinematics.value ?? '') && /^stepper_y\d*$/.test(props.stepper)
    if (isCartesianY) return t('calibration.context.motion.cartesianY')
    return t('calibration.context.motion.plan', {
      direction: t(planDirectionKey(value.x, value.y)),
    })
  }
  if (value.kind === 'front') {
    return t(
      value.z > 0
        ? 'calibration.context.motion.frontAway'
        : 'calibration.context.motion.frontToward',
    )
  }
  if (value.kind === 'z') {
    return t(zPlan.value ? 'calibration.context.motion.zAt' : 'calibration.context.motion.z')
  }
  if (value.kind === 'tower') {
    return t('calibration.context.motion.tower', { tower: value.tower.toUpperCase() })
  }
  return t('calibration.context.motion.extruder')
})
</script>

<template>
  <CalibrationCard v-if="motion" :title="t('calibration.context.motion.title')">
    <template #aside>
      <span class="calibration-context__aside calibration-context__aside--mono">{{ stepper }}</span>
    </template>

    <svg
      class="calibration-context__figure calibration-motion"
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      :aria-label="sentence"
    >
      <!-- From above: the bed, the toolhead on it, and where it goes. -->
      <template v-if="motion.kind === 'plan'">
        <rect class="calibration-motion__bed" x="40" y="22" width="240" height="146" rx="4" />
        <text class="calibration-context__label" :x="centre.x" y="14" text-anchor="middle">
          {{ t('calibration.context.motion.edgeBack') }}
        </text>
        <text class="calibration-context__label" :x="centre.x" y="186" text-anchor="middle">
          {{ t('calibration.context.motion.edgeFront') }}
        </text>
      </template>

      <!-- From the front: the bed under the toolhead. -->
      <template v-else-if="motion.kind === 'front'">
        <rect class="calibration-motion__bed" x="30" y="168" width="260" height="10" />
      </template>

      <template v-if="arrow">
        <circle class="calibration-motion__head" :cx="centre.x" :cy="centre.y" r="10" />
        <line
          class="calibration-motion__arrow"
          :x1="centre.x"
          :y1="centre.y"
          :x2="arrow.x2"
          :y2="arrow.y2"
        />
        <polyline
          class="calibration-motion__arrow"
          :points="arrowHead(centre.x, centre.y, arrow.x2, arrow.y2)"
        />
      </template>

      <!-- Z steppers where they lift, this one marked. -->
      <template v-if="motion.kind === 'z' && zPlan">
        <rect
          v-if="zPlan.bed"
          class="calibration-motion__bed"
          :x="zPlan.bed.x"
          :y="zPlan.bed.y"
          :width="zPlan.bed.width"
          :height="zPlan.bed.depth"
          rx="4"
        />
        <g
          v-for="stepper in zPlan.steppers"
          :key="stepper.name"
          class="calibration-motion__stepper"
          :class="{ 'calibration-motion__stepper--active': stepper.active }"
        >
          <rect :x="stepper.x - 11" :y="stepper.y - 11" width="22" height="22" rx="3" />
          <text :x="stepper.x" :y="stepper.y" text-anchor="middle" dominant-baseline="central">
            {{ stepper.name }}
          </text>
        </g>
      </template>

      <!-- Z without a levelling section: nozzle and bed, drawn apart. -->
      <template v-else-if="motion.kind === 'z'">
        <rect class="calibration-motion__bed" x="60" y="150" width="200" height="12" />
        <polygon class="calibration-motion__head" points="146,70 174,70 164,100 156,100" />
        <line class="calibration-motion__arrow" x1="200" y1="112" x2="200" y2="52" />
        <polyline class="calibration-motion__arrow" :points="arrowHead(200, 112, 200, 52)" />
        <line class="calibration-motion__arrow" x1="220" y1="120" x2="220" y2="146" />
        <polyline class="calibration-motion__arrow" :points="arrowHead(220, 120, 220, 146)" />
      </template>

      <!-- A delta from above: the three towers, this one marked. -->
      <template v-else-if="motion.kind === 'tower'">
        <circle class="calibration-motion__bed" :cx="centre.x" :cy="centre.y" r="62" />
        <g
          v-for="tower in towers"
          :key="tower.tower"
          class="calibration-motion__stepper"
          :class="{ 'calibration-motion__stepper--active': tower.active }"
        >
          <rect :x="tower.x - 12" :y="tower.y - 12" width="24" height="24" rx="3" />
          <text :x="tower.x" :y="tower.y" text-anchor="middle" dominant-baseline="central">
            {{ tower.tower.toUpperCase() }}
          </text>
        </g>
      </template>

      <!-- An extruder: filament through the drive into the nozzle. -->
      <template v-else-if="motion.kind === 'extruder'">
        <line class="calibration-motion__filament" x1="150" y1="10" x2="150" y2="150" />
        <rect class="calibration-motion__part" x="118" y="52" width="64" height="44" rx="4" />
        <circle class="calibration-motion__part" cx="138" cy="74" r="10" />
        <circle class="calibration-motion__part" cx="162" cy="74" r="10" />
        <polygon class="calibration-motion__head" points="136,140 164,140 154,170 146,170" />
        <line class="calibration-motion__arrow" x1="206" y1="40" x2="206" y2="130" />
        <polyline class="calibration-motion__arrow" :points="arrowHead(206, 40, 206, 130)" />
      </template>
    </svg>

    <p class="calibration-motion__sentence">{{ sentence }}</p>
  </CalibrationCard>
</template>
