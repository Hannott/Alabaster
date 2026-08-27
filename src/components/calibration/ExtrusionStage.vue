<script setup lang="ts">
import { computed } from 'vue'

import RunoutSensorsPanel from '@/components/calibration/RunoutSensorsPanel.vue'
import HostedDashboardModule from '@/components/dashboard/HostedDashboardModule.vue'
import ExtruderModule from '@/components/dashboard/modules/ExtruderModule.vue'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useRunoutSensorsStore } from '@/stores/runoutSensors'

/**
 * What the extruder is set to do: pressure advance and its smoothing, the
 * retraction figures, and the extrude/retract controls a pressure-advance
 * check needs in order to push filament through at all.
 *
 * All of that is `ExtruderModule`, hosted whole for the same reason
 * `MovementModule` is: these are values somebody sets once and verifies, which
 * is this destination's own definition of what belongs here, and they already
 * live in one card. Filament sensors join the stage because a sensor reporting
 * no filament while filament is loaded is an extrusion fault, not a bed one.
 */
const printerConfig = usePrinterConfigStore()
const runoutSensors = useRunoutSensorsStore()

const hasExtruder = computed(() => printerConfig.hasSection('extruder'))
</script>

<template>
  <div class="calibration-stage calibration-stage--split">
    <HostedDashboardModule v-if="hasExtruder" module-id="extruder">
      <ExtruderModule />
    </HostedDashboardModule>

    <RunoutSensorsPanel v-if="runoutSensors.hasSensors" />
  </div>
</template>
