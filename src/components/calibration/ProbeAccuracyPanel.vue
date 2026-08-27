<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import { useAvailability } from '@/composables/useAvailability'
import { probeBedPosition } from '@/features/bedMesh/probeRun'
import { useProbeAccuracyStore } from '@/stores/probeAccuracy'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'

/**
 * `PROBE_ACCURACY` repeats one point ten times and answers with a single
 * console line — see `stores/probeAccuracy.ts` — so this panel has one button
 * and one result, not a running transcript.
 */
const { locale, t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const probeAccuracy = useProbeAccuracyStore()
const { availability: klipperAvailability } = useAvailability('klipper')

const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
)

const canCommand = computed(() => klipperAvailability.value.isAvailable && !printer.hasActivePrint)

/**
 * `PROBE_ACCURACY` probes at wherever the toolhead currently sits, not at a
 * coordinate Alabaster chooses — and the probe tip is not the nozzle. A probe
 * with a real `x_offset`/`y_offset` sits somewhere else entirely, so a nozzle
 * comfortably inside the bed can still carry the probe past its edge, into a
 * frame rail or simply out of the travel range Klipper will refuse to enter.
 * `probeBedPosition` is the same toolhead-plus-offset arithmetic the live mesh
 * view already uses to place the moving probe marker; `buildVolume` is
 * Klipper's own reported `axis_minimum`/`axis_maximum`, the actual legal range,
 * not a nominal bed size. Unknown position or unknown bounds do not block —
 * there is nothing to warn about yet, not evidence of a problem.
 */
const probeOutsideBed = computed(() => {
  const position = probeBedPosition(printer.toolheadPosition, printerConfig.probeOffset)
  if (!position) return false
  const [minX, minY] = printer.buildVolume.minimum
  const [maxX, maxY] = printer.buildVolume.maximum
  if (
    typeof minX !== 'number' ||
    typeof minY !== 'number' ||
    typeof maxX !== 'number' ||
    typeof maxY !== 'number'
  ) {
    return false
  }
  return position.x < minX || position.x > maxX || position.y < minY || position.y > maxY
})

function formatProbeValue(value: number): string {
  return t('calibration.probe.millimetres', { value: numberFormatter.value.format(value) })
}
</script>

<template>
  <section class="page-card calibration-panel" :aria-label="t('calibration.probe.title')">
    <header class="calibration-panel__header">
      <div>
        <h2 class="calibration-panel__title">{{ t('calibration.probe.title') }}</h2>
        <p class="calibration-panel__hint">{{ t('calibration.probe.hint') }}</p>
      </div>
      <button
        type="button"
        class="button button--xs"
        :disabled="!canCommand || printer.pendingCommands.probeAccuracy || probeOutsideBed"
        :data-pending="printer.pendingCommands.probeAccuracy ? 'true' : undefined"
        @click="printer.probeAccuracy()"
      >
        <AppIcon name="play" class="size-4" aria-hidden="true" />
        {{ t('calibration.probe.run') }}
      </button>
    </header>

    <p v-if="probeOutsideBed" class="calibration-notice" role="status">
      <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
      <span>{{ t('calibration.probe.outsideBed') }}</span>
    </p>
    <p v-else-if="probeAccuracy.isRunning" class="calibration-notice" role="status">
      <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
      <span>{{ t('calibration.probe.running') }}</span>
    </p>
    <p v-else-if="!probeAccuracy.result" class="calibration-panel__hint">
      {{ t('calibration.probe.empty') }}
    </p>

    <dl v-if="probeAccuracy.result" class="calibration-probe-results">
      <div>
        <dt>{{ t('calibration.probe.maximum') }}</dt>
        <dd>{{ formatProbeValue(probeAccuracy.result.maximum) }}</dd>
      </div>
      <div>
        <dt>{{ t('calibration.probe.minimum') }}</dt>
        <dd>{{ formatProbeValue(probeAccuracy.result.minimum) }}</dd>
      </div>
      <div>
        <dt>{{ t('calibration.probe.range') }}</dt>
        <dd>{{ formatProbeValue(probeAccuracy.result.range) }}</dd>
      </div>
      <div>
        <dt>{{ t('calibration.probe.average') }}</dt>
        <dd>{{ formatProbeValue(probeAccuracy.result.average) }}</dd>
      </div>
      <div>
        <dt>{{ t('calibration.probe.median') }}</dt>
        <dd>{{ formatProbeValue(probeAccuracy.result.median) }}</dd>
      </div>
      <div>
        <dt>{{ t('calibration.probe.standardDeviation') }}</dt>
        <dd>{{ formatProbeValue(probeAccuracy.result.standardDeviation) }}</dd>
      </div>
    </dl>
  </section>
</template>
