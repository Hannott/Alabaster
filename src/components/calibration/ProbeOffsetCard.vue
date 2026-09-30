<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import { usePrinterStore } from '@/stores/printer'
import { probeSections, usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * The probe and the nozzle side by side over the bed, at the moment the probe
 * triggers: the probe at the bed, the nozzle `z_offset` above it, and the two
 * `x_offset`/`y_offset` apart. That is the whole meaning of the three numbers,
 * and the one that is easy to get backwards — a larger `z_offset` puts the
 * nozzle *closer* to the bed once printing, because it is how far the nozzle
 * still is from the bed when the probe says "here".
 *
 * Drawn to a fixed shape rather than to scale: a millimetre of `z_offset`
 * beside 30 mm of `x_offset` would be a line one pixel long. The numbers are
 * printed where they are drawn. A value `PROBE_CALIBRATE` staged and
 * `SAVE_CONFIG` has not written yet is shown against the file's own.
 */
const { t, locale } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()

const section = computed(
  () => probeSections.find((name) => printerConfig.section(name)?.z_offset !== undefined) ?? null,
)

function numberFrom(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : null
}

const offsets = computed(() => {
  if (section.value === null) return null
  const values = printerConfig.section(section.value) ?? {}
  const z = numberFrom(values.z_offset)
  if (z === null) return null
  return { x: numberFrom(values.x_offset) ?? 0, y: numberFrom(values.y_offset) ?? 0, z }
})

const stagedZ = computed(() =>
  section.value === null
    ? null
    : numberFrom(printer.saveConfigPendingItems[section.value]?.z_offset),
)

const zFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
)
const xyFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)

/** Klipper's option name, shown as it is spelled in the file. */
const zOption = 'z_offset'

const width = 360
const height = 190
const bedTop = 148
const nozzleTip = bedTop - 36
const carriageTop = 34

/** The probe is drawn on the side the offset puts it, so the picture agrees with the machine. */
const direction = computed(() => {
  const value = offsets.value
  if (!value) return 1
  if (value.x !== 0) return Math.sign(value.x)
  if (value.y !== 0) return Math.sign(value.y)
  return 1
})

const nozzleX = computed(() => (direction.value > 0 ? 130 : 230))
const probeX = computed(() => nozzleX.value + direction.value * 110)
const zArrowX = computed(() => nozzleX.value - direction.value * 44)

const horizontalText = computed(() =>
  offsets.value
    ? t('calibration.context.offset.horizontal', {
        x: xyFormatter.value.format(offsets.value.x),
        y: xyFormatter.value.format(offsets.value.y),
      })
    : '',
)

const zText = computed(() =>
  offsets.value
    ? t('calibration.context.offset.millimetres', {
        value: zFormatter.value.format(offsets.value.z),
      })
    : '',
)

const description = computed(() =>
  offsets.value
    ? t('calibration.context.offset.summary', {
        x: xyFormatter.value.format(offsets.value.x),
        y: xyFormatter.value.format(offsets.value.y),
        z: zFormatter.value.format(offsets.value.z),
      })
    : '',
)
</script>

<template>
  <CalibrationCard :title="t('calibration.context.offset.title')">
    <template v-if="section" #aside>
      <span class="calibration-context__aside calibration-context__aside--mono"
        >[{{ section }}]</span
      >
    </template>

    <p v-if="!offsets" class="calibration-panel__hint">
      {{ t('calibration.context.offset.missing') }}
    </p>

    <template v-else>
      <svg
        class="calibration-context__figure calibration-offset"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        :aria-label="description"
      >
        <!-- The toolhead both hang from. -->
        <rect
          class="calibration-offset__part"
          :x="Math.min(nozzleX, probeX) - 34"
          :y="carriageTop"
          :width="Math.abs(probeX - nozzleX) + 68"
          height="14"
          rx="2"
        />

        <!-- Nozzle: heat break, heater block, tip. -->
        <line
          class="calibration-offset__stem"
          :x1="nozzleX"
          :x2="nozzleX"
          :y1="carriageTop + 14"
          :y2="nozzleTip - 50"
        />
        <rect
          class="calibration-offset__part"
          :x="nozzleX - 24"
          :y="nozzleTip - 50"
          width="48"
          height="24"
          rx="2"
        />
        <polygon
          class="calibration-offset__part"
          :points="`${nozzleX - 11},${nozzleTip - 26} ${nozzleX + 11},${nozzleTip - 26} ${nozzleX + 3},${nozzleTip} ${nozzleX - 3},${nozzleTip}`"
        />

        <!-- Probe: mount, body, and the point it triggers at, on the bed. -->
        <line
          class="calibration-offset__stem"
          :x1="probeX"
          :x2="probeX"
          :y1="carriageTop + 14"
          :y2="72"
        />
        <rect
          class="calibration-offset__part"
          :x="probeX - 13"
          y="72"
          width="26"
          height="46"
          rx="3"
        />
        <line class="calibration-offset__pin" :x1="probeX" :x2="probeX" y1="118" :y2="bedTop" />
        <circle class="calibration-offset__trigger" :cx="probeX" :cy="bedTop" r="3" />

        <rect class="calibration-offset__bed" x="8" :y="bedTop" :width="width - 16" height="12" />

        <!-- x_offset / y_offset: nozzle axis to probe axis. -->
        <line
          v-for="axis in [nozzleX, probeX]"
          :key="axis"
          class="calibration-context__guide"
          :x1="axis"
          :x2="axis"
          y1="18"
          :y2="carriageTop"
        />
        <line class="calibration-context__dimension" :x1="nozzleX" :x2="probeX" y1="22" y2="22" />
        <polyline
          class="calibration-context__dimension"
          :points="`${nozzleX + direction * 6},18 ${nozzleX},22 ${nozzleX + direction * 6},26`"
        />
        <polyline
          class="calibration-context__dimension"
          :points="`${probeX - direction * 6},18 ${probeX},22 ${probeX - direction * 6},26`"
        />
        <text
          class="calibration-context__value"
          :x="(nozzleX + probeX) / 2"
          y="14"
          text-anchor="middle"
        >
          {{ horizontalText }}
        </text>

        <!-- z_offset: nozzle tip to bed, while the probe is triggered. -->
        <line
          class="calibration-context__guide"
          :x1="zArrowX - direction * 4"
          :x2="nozzleX - 3 * direction"
          :y1="nozzleTip"
          :y2="nozzleTip"
        />
        <line
          class="calibration-context__dimension"
          :x1="zArrowX"
          :x2="zArrowX"
          :y1="nozzleTip"
          :y2="bedTop"
        />
        <polyline
          class="calibration-context__dimension"
          :points="`${zArrowX - 4},${nozzleTip + 6} ${zArrowX},${nozzleTip} ${zArrowX + 4},${nozzleTip + 6}`"
        />
        <polyline
          class="calibration-context__dimension"
          :points="`${zArrowX - 4},${bedTop - 6} ${zArrowX},${bedTop} ${zArrowX + 4},${bedTop - 6}`"
        />
        <text
          class="calibration-context__value"
          :x="zArrowX - direction * 8"
          :y="(nozzleTip + bedTop) / 2 - 2"
          :text-anchor="direction > 0 ? 'end' : 'start'"
        >
          {{ zOption }}
        </text>
        <text
          class="calibration-context__value"
          :x="zArrowX - direction * 8"
          :y="(nozzleTip + bedTop) / 2 + 12"
          :text-anchor="direction > 0 ? 'end' : 'start'"
        >
          {{ zText }}
        </text>

        <text class="calibration-context__label" :x="nozzleX" :y="height - 8" text-anchor="middle">
          {{ t('calibration.context.offset.nozzle') }}
        </text>
        <text class="calibration-context__label" :x="probeX" :y="height - 8" text-anchor="middle">
          {{ t('calibration.context.offset.probe') }}
        </text>
      </svg>

      <dl class="calibration-context__facts">
        <div class="calibration-context__fact">
          <dt>{{ zOption }}</dt>
          <dd>{{ zText }}</dd>
        </div>
        <div
          v-if="stagedZ !== null"
          class="calibration-context__fact calibration-context__fact--staged"
        >
          <dt>{{ t('calibration.context.offset.staged') }}</dt>
          <dd>
            {{ t('calibration.context.offset.millimetres', { value: zFormatter.format(stagedZ) }) }}
          </dd>
        </div>
      </dl>
    </template>
  </CalibrationCard>
</template>
