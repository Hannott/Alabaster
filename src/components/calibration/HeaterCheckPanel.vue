<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import { useProcedureContext } from '@/composables/useProcedureContext'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * What each heater runs on and what will trip it: its control model's current
 * constants, and the `verify_heater` limits Klipper shuts the printer down
 * over. Read only — nothing here runs — because the question it answers is
 * "what is this heater set to", which used to need the config file open.
 *
 * Klipper's defaults stand where a heater has no `[verify_heater]` section of
 * its own, and they are marked as defaults rather than shown as if set.
 */
const { t } = useI18n({ useScope: 'global' })
const printerConfig = usePrinterConfigStore()
const context = useProcedureContext()

const verifyOptions = ['max_error', 'check_gain_time', 'hysteresis', 'heating_gain'] as const
const modelOptions = {
  pid: ['pid_kp', 'pid_ki', 'pid_kd'],
  mpc: ['block_heat_capacity', 'sensor_responsiveness', 'ambient_transfer', 'fan_ambient_transfer'],
} as const

/** `verify_heater.py`'s own defaults; the bed gets a longer gain window. */
function verifyDefault(heater: string, option: (typeof verifyOptions)[number]): number {
  if (option === 'max_error') return 120
  if (option === 'check_gain_time') return heater === 'heater_bed' ? 60 : 20
  if (option === 'hysteresis') return 5
  return 2
}

function shown(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim() !== '') return value
  // Kalico reports `fan_ambient_transfer` as one value per fan speed.
  if (Array.isArray(value) && value.length > 0) return value.join(', ')
  return null
}

const heaters = computed(() =>
  context.value.heaters.map((heater) => {
    const verify = printerConfig.section(`verify_heater ${heater.objectName}`)
    const own = printerConfig.section(heater.objectName)
    return {
      ...heater,
      model: modelOptions[heater.kind].map((option) => ({ option, value: shown(own?.[option]) })),
      verify: verifyOptions.map((option) => {
        const value = shown(verify?.[option])
        return {
          option,
          value: value ?? String(verifyDefault(heater.objectName, option)),
          isDefault: value === null,
        }
      }),
    }
  }),
)
</script>

<template>
  <CalibrationCard
    class="calibration-workspace"
    :title="t('calibration.procedure.heaterCheck.name')"
  >
    <template #aside>
      <span class="calibration-workspace__command">verify_heater</span>
    </template>
    <p class="calibration-workspace__description">
      {{ t('calibration.procedure.heaterCheck.detail') }}
    </p>

    <div v-for="heater in heaters" :key="heater.objectName" class="calibration-heater">
      <h3 class="calibration-heater__title">
        {{ heater.label }}
        <span class="calibration-heater__kind">{{ heater.kind.toUpperCase() }}</span>
      </h3>
      <table class="calibration-result__table">
        <tbody>
          <tr v-for="entry in heater.model" :key="entry.option">
            <th scope="row">{{ entry.option }}</th>
            <td class="calibration-result__number">{{ entry.value ?? '—' }}</td>
          </tr>
          <tr v-for="entry in heater.verify" :key="entry.option">
            <th scope="row">{{ entry.option }}</th>
            <td class="calibration-result__number">
              {{ entry.value }}
              <span v-if="entry.isDefault" class="calibration-heater__default">{{
                t('calibration.heaterCheck.default')
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </CalibrationCard>
</template>
