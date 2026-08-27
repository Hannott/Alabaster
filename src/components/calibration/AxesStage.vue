<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import EndstopsPanel from '@/components/calibration/EndstopsPanel.vue'
import HostedDashboardModule from '@/components/dashboard/HostedDashboardModule.vue'
import MovementModule from '@/components/dashboard/modules/MovementModule.vue'

/**
 * Squaring the machine: homing, jogging, parking, the levelling procedure this
 * printer is configured for, the screw turns it answers with, and the Z offset.
 *
 * All of that is `MovementModule`, hosted whole rather than taken apart. The
 * card is one physical subject — where the toolhead is and how the frame sits
 * against the bed — and it already holds every command this sitting needs,
 * including the `SCREWS_TILT_CALCULATE` table and the Z-offset trim that
 * `Z_OFFSET_APPLY_PROBE` writes. Splitting three page-local panels out of it
 * would be a second implementation of the same commands, which is the thing
 * hosting exists to avoid; and jogging is not incidental here — `PROBE_ACCURACY`
 * on the next stage probes wherever the toolhead currently sits, so its own
 * "move the toolhead before running this" warning used to be advice with no
 * control on the page to act on.
 *
 * Endstops sit beside it because that is when a reading is consulted: homing
 * behaving oddly, not a glance at an idle machine.
 */
const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <div class="calibration-stage calibration-stage--split">
    <HostedDashboardModule module-id="movement" :title="t('calibration.axes.movementTitle')">
      <MovementModule />
    </HostedDashboardModule>

    <EndstopsPanel />
  </div>
</template>
