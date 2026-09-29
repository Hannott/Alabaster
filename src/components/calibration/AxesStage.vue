<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import CalibrationBench from '@/components/calibration/CalibrationBench.vue'
import HostedDashboardModule from '@/components/dashboard/HostedDashboardModule.vue'
import MovementModule from '@/components/dashboard/modules/MovementModule.vue'

/**
 * Squaring the machine: endstops, steppers, the Z endstop's position, the
 * endstop phase, a driver autotune — whichever of these this printer has.
 *
 * The Movement card is the live column rather than the stage. It is still the
 * one place homing, jogging and parking live, and those are what a procedure
 * here keeps reaching for: a stepper check wants the axis somewhere clear, and
 * the Z endstop's paper test wants the toolhead over the bed first.
 */
const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <CalibrationBench stage="axes">
    <template #live>
      <!--
        Where the toolhead is and how to move it, which is what a procedure here
        reaches for. Z-offset steps and the speed factor are print tuning, and
        levelling has its own procedures on the bed stage.
      -->
      <HostedDashboardModule
        module-id="movement"
        :title="t('calibration.axes.movementTitle')"
        :sections="['motion', 'plan', 'park']"
      >
        <MovementModule />
      </HostedDashboardModule>
    </template>
  </CalibrationBench>
</template>
