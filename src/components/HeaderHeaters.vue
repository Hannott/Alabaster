<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import {
  sensorColorVariable,
  sensorLabel,
  sensorRowIcon,
} from '@/components/dashboard/modules/temperatureSensors'
import { useAvailability } from '@/composables/useAvailability'
import { configStringMap } from '@/dashboard/context'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useTelemetryStore } from '@/stores/telemetry'

/**
 * One pill per heater that has a target, beside the connection pill. Display
 * only: it answers "is something hot or heating" from every page, and the
 * Temperatures card stays the one place a target is changed.
 */
const { t } = useI18n({ useScope: 'global' })
const telemetry = useTelemetryStore()
const { availability } = useAvailability('klipper')
const dashboardLayout = useDashboardLayoutStore()

/**
 * The colours the reader picked on the Temperatures card, so a heater is the
 * same hue here as on its chart line. With more than one Temperatures card the
 * first one in the profile decides; with none, every heater takes its default.
 */
const sensorColors = computed(() => {
  const instance = dashboardLayout.profile.instances.find(
    (candidate) => candidate.moduleId === 'temperatures',
  )
  return configStringMap(instance?.config ?? {}, 'sensorColors')
})

/**
 * Wider than the store's 0.5° settle margin on purpose: a heater holding
 * temperature wobbles by a degree under PID, and the target unfolding and
 * folding on every wobble would be exactly the flicker ADR 0004 rules out.
 */
const approachMarginCelsius = 2

const heaters = computed(() =>
  telemetry.sensors
    .filter(
      (sensor) =>
        (sensor.kind === 'extruder' || sensor.kind === 'bed' || sensor.kind === 'heater') &&
        sensor.target !== null &&
        sensor.target > 0,
    )
    .map((sensor) => {
      const target = sensor.target as number
      const temperature = sensor.temperature === null ? null : Math.round(sensor.temperature)
      const roundedTarget = Math.round(target)
      const name = sensorLabel(sensor, t)
      return {
        objectName: sensor.objectName,
        icon: sensorRowIcon(sensor, sensor.temperature),
        color: sensorColorVariable(sensor.objectName, sensorColors.value),
        reading:
          temperature === null
            ? t('header.heaters.noReading')
            : t('header.heaters.reading', { value: temperature }),
        target: t('header.heaters.target', { value: roundedTarget }),
        isApproaching:
          sensor.temperature === null ||
          Math.abs(target - sensor.temperature) > approachMarginCelsius,
        label:
          temperature === null
            ? t('header.heaters.labelNoReading', { name, target: roundedTarget })
            : t('header.heaters.label', { name, temperature, target: roundedTarget }),
      }
    }),
)
</script>

<template>
  <TransitionGroup name="header-heater">
    <span
      v-for="heater in heaters"
      :key="heater.objectName"
      class="header-heater text-xs font-semibold"
      :class="[
        `header-heater--${availability.phase}`,
        { 'header-heater--approaching': heater.isApproaching },
      ]"
      tabindex="0"
      :aria-label="heater.label"
    >
      <AppIcon
        :name="heater.icon"
        class="header-heater__icon"
        :style="{ color: heater.color }"
        aria-hidden="true"
      />
      <span class="header-heater__reading" aria-hidden="true">{{ heater.reading }}</span>
      <span class="header-heater__target" aria-hidden="true">{{ heater.target }}</span>
    </span>
  </TransitionGroup>
</template>
