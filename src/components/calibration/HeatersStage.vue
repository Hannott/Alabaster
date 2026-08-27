<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import HeaterCalibrationPanel from '@/components/calibration/HeaterCalibrationPanel.vue'
import HostedDashboardModule from '@/components/dashboard/HostedDashboardModule.vue'
import TemperaturesModule from '@/components/dashboard/modules/TemperaturesModule.vue'
import { configBoolean } from '@/dashboard/context'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'

/**
 * Fitting each heater's control model: `PID_CALIBRATE` or `MPC_CALIBRATE`,
 * whichever the heater is configured for.
 *
 * The Temperatures card is hosted beside it rather than as decoration. A
 * calibration run drives the heater through a deliberate overshoot cycle for
 * several minutes, and the climb curve is the only way to see it is behaving —
 * which is what used to send somebody to the Dashboard in the middle of their
 * own calibration, since the run itself was started from behind that card's
 * gear on another route entirely.
 */
const { t } = useI18n({ useScope: 'global' })
const layout = useDashboardLayoutStore()

/**
 * The Temperatures card's own "skip the calibration warning" toggle, read from
 * the instance the layout store keeps for it.
 *
 * The flag belongs to that card — `confirmations.md`'s split puts a module's own
 * confirmation behind a toggle in its settings pane, not on the Settings page —
 * and this stage runs the same procedure the card's pane does. Reading the same
 * flag is what keeps one switch from meaning two different things depending on
 * which route the user happened to start the run from. The global override in
 * `useActionGuard` still reaches both.
 */
const skipCalibrationWarning = computed(() =>
  configBoolean(
    layout.profile.instances.find((instance) => instance.instanceId === 'temperatures')?.config ??
      {},
    'skipCalibrationWarning',
    false,
  ),
)
</script>

<template>
  <div class="calibration-stage calibration-stage--split">
    <section class="page-card calibration-panel" :aria-label="t('calibration.heaters.title')">
      <header class="calibration-panel__header">
        <div>
          <h2 class="calibration-panel__title">{{ t('calibration.heaters.title') }}</h2>
          <p class="calibration-panel__hint">{{ t('calibration.heaters.hint') }}</p>
        </div>
      </header>

      <HeaterCalibrationPanel :skip-warning="skipCalibrationWarning" />
    </section>

    <HostedDashboardModule module-id="temperatures">
      <TemperaturesModule />
    </HostedDashboardModule>
  </div>
</template>
