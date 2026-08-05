<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import MachineCardSettingsFields from '@/components/dashboard/modules/MachineCardSettingsFields.vue'
import { configBoolean, useDashboardModule } from '@/dashboard/context'

/**
 * Machine's full configuration: the print-time lock, shared with the card's
 * quick layer, and what happens to a runtime limit once a job ends.
 *
 * Velocity, acceleration, square corner velocity and minimum cruise ratio are
 * Klipper session state, not job state — `SET_VELOCITY_LIMIT` outlives the
 * print it was raised for exactly the way the speed and flow factors do, so a
 * limit changed to fix one job silently carries into the next one either way.
 * Three independent settings, so three `.settings-row`s rather than the
 * tighter `.check-row` seam reserved for the alternatives of a single
 * setting — Print's own reset-on-finish block and Movement's confirmations
 * follow the same rule. No pin on any of the three: each is decided once and
 * then forgotten, not something reached for while working, which is the test
 * `docs/design/settings-surface.md` sets for the card's quick layer.
 */
const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('machine')

const resetOnComplete = computed(() => configBoolean(config.value, 'resetOnComplete', false))
const resetOnCancelled = computed(() => configBoolean(config.value, 'resetOnCancelled', false))
const resetOnError = computed(() => configBoolean(config.value, 'resetOnError', false))
</script>

<template>
  <SurfaceSection :title="t('dashboard.surface.cardSection')">
    <MachineCardSettingsFields mode="pane" />
  </SurfaceSection>

  <SurfaceSection :title="t('dashboard.machine.resetOnFinishTitle')" divided>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="resetOnComplete"
          @change="updateConfig({ resetOnComplete: !resetOnComplete })"
        />
        <span>{{ t('dashboard.machine.resetOnComplete') }}</span>
      </label>
    </div>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="resetOnCancelled"
          @change="updateConfig({ resetOnCancelled: !resetOnCancelled })"
        />
        <span>{{ t('dashboard.machine.resetOnCancelled') }}</span>
      </label>
    </div>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="resetOnError"
          @change="updateConfig({ resetOnError: !resetOnError })"
        />
        <span>{{ t('dashboard.machine.resetOnError') }}</span>
      </label>
    </div>
  </SurfaceSection>
</template>
