<script setup lang="ts">
import { computed } from 'vue'

import CalibrationBench from '@/components/calibration/CalibrationBench.vue'
import HostedDashboardModule from '@/components/dashboard/HostedDashboardModule.vue'
import ExtruderModule from '@/components/dashboard/modules/ExtruderModule.vue'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * What the extruder moves and how: rotation distance, measured with a ruler,
 * pressure advance tried live and kept in the file, and the filament sensors.
 *
 * The Extruder card is the live column, for the extrude and retract controls a
 * pressure-advance check needs in order to push filament through at all.
 */
const printerConfig = usePrinterConfigStore()

const hasExtruder = computed(() => printerConfig.hasSection('extruder'))
</script>

<template>
  <CalibrationBench stage="extrusion">
    <template #live>
      <!--
        The hotend and the extrude and retract controls; macros, retraction and
        pressure advance are not what a measurement reaches for.
      -->
      <HostedDashboardModule
        v-if="hasExtruder"
        module-id="extruder"
        :sections="['status', 'manual']"
      >
        <ExtruderModule />
      </HostedDashboardModule>
    </template>
  </CalibrationBench>
</template>
