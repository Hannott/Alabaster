<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  isExtruderMoving,
  useFilamentDiameter,
  volumetricFlow,
} from '@/components/dashboard/modules/extruderFlow'
import { usePrinterStore } from '@/stores/printer'

const props = defineProps<{ inHeader?: boolean }>()

const printer = usePrinterStore()
const filamentDiameter = useFilamentDiameter()
const { locale, t } = useI18n({ useScope: 'global' })
const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)

/**
 * `motion_report` pushes a change only when the value actually changes, so a
 * printer holding one exact extrusion speed across a long straight segment
 * never re-fires the reading at all. A hold keyed to "when did a sample last
 * arrive" would read that silence as the flow having stopped and decay to
 * zero while the extruder is still running exactly as before — which is the
 * "drops to 0" this once did. Judged against the printer's current reported
 * value on every tick instead, so a sustained reading keeps re-crediting
 * itself rather than aging out for having never changed.
 */
const peakWindowMs = 1000
const peakExtruderVelocity = ref(0)
let peakSetAt = 0

/** Below this the toolhead is not meaningfully moving — Movement's own threshold for `live_velocity`. */
const toolheadMovingThreshold = 0.5

/**
 * Whether the current reading is even eligible to be shown.
 *
 * A bare E-only move — retract or unretract, with no X/Y/Z component — pulls
 * filament back through the bowden tube rather than melting it through the
 * nozzle, so it runs at whatever speed `firmware_retraction` was configured
 * with, which is easily double or triple a real print's flow and would read
 * as an absurd melt rate if credited at face value. Excluded only while a
 * print is running, because that is the only time an E-only move is
 * retraction rather than this card's own manual Extrude/Retract buttons —
 * which move the extruder the same way, and whose whole reason for having a
 * live reading is to show that they are doing it.
 */
function isCreditableSample(toolheadVelocity: number): boolean {
  return !printer.isPrinting || toolheadVelocity >= toolheadMovingThreshold
}

/**
 * A negative-zero reading. Klipper reports a retract's tail-end velocity with
 * the sign of its own direction, so a settled retract can report exactly
 * `-0` — a value `Intl.NumberFormat` prints as "-0", a distinct-looking
 * reading for something that means precisely zero. Checked against the same
 * rounding the display itself uses, since a value that only rounds to zero —
 * `-0.02` at one decimal place — hits the same defect.
 */
function withoutNegativeZero(value: number, fractionDigits: number): number {
  return Number(value.toFixed(fractionDigits)) === 0 ? 0 : value
}

function tick(): void {
  const now = Date.now()
  const credible = isCreditableSample(printer.motion.liveVelocity)
  const candidate = withoutNegativeZero(credible ? printer.motion.liveExtruderVelocity : 0, 1)
  const stillHolding = now - peakSetAt < peakWindowMs
  if (stillHolding && Math.abs(candidate) < Math.abs(peakExtruderVelocity.value)) return
  peakExtruderVelocity.value = candidate
  peakSetAt = now
}

watch(() => [printer.motion.liveExtruderVelocity, printer.motion.liveVelocity], tick, {
  immediate: true,
})

let peakTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  peakTimer = setInterval(tick, 100)
})
onUnmounted(() => {
  if (peakTimer !== undefined) clearInterval(peakTimer)
})

/*
 * What the extruder is doing at this instant, held over the trailing second.
 *
 * Without it a slow purge and an extrude Klipper silently refused look
 * identical — the same defect Movement named for the toolhead and fixed only
 * there. It remains visible at rest so a refused move and an idle extruder do
 * not collapse into the same blank state; the too-cold warning joins it only
 * when the user has something actionable to resolve.
 *
 * It never animates. ADR 0004 forbids animating telemetry at its own update
 * frequency; the number changes when the peak-hold above says it changed.
 */
const isMoving = computed(() => isExtruderMoving(peakExtruderVelocity.value))

/**
 * Volumetric flow from the loaded spool's diameter, falling back to the
 * printer's configured filament diameter when Spoolman has no more specific
 * answer. Absent otherwise rather than computed from an assumed 1.75 mm,
 * since flow scales with the square of the diameter and this is a figure
 * people compare against a hotend's rated limit.
 */
const flowValue = computed(() => volumetricFlow(peakExtruderVelocity.value, filamentDiameter.value))

/**
 * The volumetric-flow number this card shows. Without either a spool or
 * configured filament diameter the value is unavailable rather than replaced
 * with a differently dimensioned linear-speed reading. Re-checked for
 * negative zero here too: multiplying the peak by the filament's cross-section
 * can round a value that was already clean back into one that isn't.
 */
const readoutValue = computed(() =>
  flowValue.value === null
    ? t('dashboard.unavailableValue')
    : numberFormatter.value.format(withoutNegativeZero(flowValue.value, 1)),
)
const isZero = computed(
  () => props.inHeader && flowValue.value !== null && withoutNegativeZero(flowValue.value, 1) === 0,
)
const hideIdleHeader = ref(false)

watch(
  isZero,
  (zero, _, onCleanup) => {
    hideIdleHeader.value = false
    if (!zero) return

    const timer = setTimeout(() => (hideIdleHeader.value = true), 1000)
    onCleanup(() => clearTimeout(timer))
  },
  { immediate: true },
)
</script>

<template>
  <p
    v-if="!inHeader || !hideIdleHeader"
    :class="[
      inHeader ? 'dashboard-module__summary' : 'text-value-micro',
      isMoving ? 'text-data-sky' : 'text-muted',
    ]"
  >
    <span :class="{ 'text-value-slot': !inHeader }">{{ readoutValue }}</span>
    {{ t('dashboard.extruder.cubicMillimetresPerSecondUnit') }}
  </p>
</template>
