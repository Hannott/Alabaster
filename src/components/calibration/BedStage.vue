<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import CalibrationBench from '@/components/calibration/CalibrationBench.vue'
import MeshProfilesPanel from '@/components/calibration/MeshProfilesPanel.vue'
import HostedDashboardModule from '@/components/dashboard/HostedDashboardModule.vue'
import BedMeshModule from '@/components/dashboard/modules/BedMeshModule.vue'
import { useMeshProbeRunStore } from '@/stores/meshProbeRun'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * The bed as a surface: levelling, the mesh, the probe's offset and
 * repeatability, and whatever probe calibrations this printer's probe offers.
 *
 * The height map and the saved profiles are the live column, and it takes the
 * width: the map is what every procedure here changes or depends on, and a
 * mesh being probed fills in on it point by point while the run is going.
 */
const { t } = useI18n({ useScope: 'global' })
const printerConfig = usePrinterConfigStore()
const probeRun = useMeshProbeRunStore()

const hasBedMesh = computed(() => printerConfig.hasBedMesh)
</script>

<template>
  <CalibrationBench stage="bed" live-wide>
    <template #live>
      <HostedDashboardModule
        v-if="hasBedMesh"
        module-id="bedMesh"
        :title="t('calibration.map.title')"
        class="calibration-stage__map"
      >
        <template #actions>
          <p v-if="probeRun.isRunning" class="calibration-map__running" role="status">
            <AppIcon name="mesh" class="size-4 shrink-0" aria-hidden="true" />
            {{ t('calibration.map.probing', { count: probeRun.points.length }) }}
          </p>
        </template>

        <!--
          Said while it matters and not before: the points are plotted against the
          mean of the run so far, because Klipper reports absolute trigger heights
          and the surface is drawn as deviation. Early points move as that mean
          settles, so the panel says the shape is provisional rather than letting
          it be read as the finished mesh.
        -->
        <p v-if="probeRun.isRunning" class="calibration-panel__hint">
          {{ t('calibration.map.provisional') }}
        </p>
        <p v-else-if="probeRun.isScanning" class="calibration-notice" role="status">
          <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
          <span>{{ t('calibration.map.scanningProbe') }}</span>
        </p>

        <!--
          The dashboard's own bed-mesh module, hosted at page size. It is the same
          component and the same renderer, not a second one — and the same saved
          configuration a dashboard card would read and write, so the settings gear
          `HostedDashboardModule` puts in the header changes both.
        -->
        <BedMeshModule live-probing force-probe-labels />
      </HostedDashboardModule>

      <MeshProfilesPanel v-if="hasBedMesh" class="calibration-stage__profiles" />
    </template>
  </CalibrationBench>
</template>
