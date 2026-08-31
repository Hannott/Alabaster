<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { useRunoutSensorsStore } from '@/stores/runoutSensors'

/**
 * States only, the same split `endstops.ts` draws: arming or disarming a sensor
 * belongs with the print it protects, on the Print module, not here. It sits in
 * the extrusion stage because that is the sitting a sensor reading belongs to —
 * a sensor that reports no filament while filament is loaded is an extrusion
 * problem, not a bed one.
 */
const { t } = useI18n({ useScope: 'global' })
const runoutSensors = useRunoutSensorsStore()
</script>

<template>
  <section class="page-card calibration-panel" :aria-label="t('calibration.sensors.title')">
    <header class="calibration-panel__header">
      <div>
        <h2 class="calibration-panel__title">{{ t('calibration.sensors.title') }}</h2>
      </div>
    </header>

    <ul class="calibration-sensors">
      <li
        v-for="sensor in runoutSensors.readings"
        :key="sensor.objectName"
        class="calibration-sensor"
      >
        <span class="calibration-sensor__name">{{ sensor.name }}</span>
        <span
          class="calibration-sensor__state"
          :class="`calibration-sensor__state--${sensor.filamentDetected ? 'detected' : 'empty'}`"
        >
          <span class="calibration-sensor__mark" aria-hidden="true"></span>
          {{
            t(
              sensor.filamentDetected
                ? 'calibration.sensors.detected'
                : 'calibration.sensors.notDetected',
            )
          }}
        </span>
        <span v-if="!sensor.enabled" class="calibration-sensor__armed">
          {{ t('calibration.sensors.disarmed') }}
        </span>
      </li>
    </ul>
  </section>
</template>
