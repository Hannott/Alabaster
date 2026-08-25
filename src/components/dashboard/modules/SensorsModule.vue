<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import { useDashboardModule } from '@/dashboard/context'
import { useSensorsStore } from '@/stores/sensors'
import { titleCaseIdentifier } from '@/utils/identifierCase'

interface SensorRow {
  key: string
  label: string
  value: number
}

const { locale, t } = useI18n({ useScope: 'global' })
const sensors = useSensorsStore()
const { isSettingsOpen } = useDashboardModule('sensors')

const valueFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }),
)

/**
 * One row per value a sensor reports, not one row per sensor: a sensor with
 * several named readings (an MQTT sensor publishing `value1`/`value2`, say)
 * has no single number that speaks for it. A sensor reporting exactly one
 * value keeps its own name on the row; a sensor reporting several appends
 * which one, humanized the same way a macro or pressure-advance key is
 * (`titleCaseIdentifier`) since these names are whatever the sensor's own
 * config called them, not translated UI copy.
 */
const rows = computed<SensorRow[]>(() =>
  sensors.sensors.flatMap((sensor) => {
    const keys = Object.keys(sensor.values)
    return keys.map((key) => ({
      key: `${sensor.id}:${key}`,
      label:
        keys.length > 1
          ? `${sensor.friendlyName} · ${titleCaseIdentifier(key)}`
          : sensor.friendlyName,
      value: sensor.values[key]!,
    }))
  }),
)
</script>

<template>
  <AppDashboardModule :open="isSettingsOpen">
    <div v-if="rows.length > 0" class="module-table sensor-table">
      <div v-for="row in rows" :key="row.key" class="module-table__row">
        <span class="module-table__name">{{ row.label }}</span>
        <span class="module-table__value">{{ valueFormatter.format(row.value) }}</span>
      </div>
    </div>
    <p v-else class="text-card-title text-muted">
      {{ t('dashboard.sensors.none') }}
    </p>
  </AppDashboardModule>
</template>
