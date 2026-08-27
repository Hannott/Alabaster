<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import MeshProfilesPanel from '@/components/calibration/MeshProfilesPanel.vue'
import ProbeAccuracyPanel from '@/components/calibration/ProbeAccuracyPanel.vue'
import HostedDashboardModule from '@/components/dashboard/HostedDashboardModule.vue'
import BedMeshModule from '@/components/dashboard/modules/BedMeshModule.vue'
import { useMeshProbeRunStore } from '@/stores/meshProbeRun'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * The bed as a surface: what it actually looks like, how repeatable the probe
 * that measured it is, and which of the saved meshes is on the machine.
 *
 * The map leads, in the markup as well as on screen. Its grid placement would
 * put it in the first column whatever order these three were written in, which
 * is exactly why the order matters: a reader tabbing through the stage has to
 * reach the leftmost card first, and a stacked narrow viewport has to open on
 * the artifact rather than on the check against it. Probe accuracy and the
 * profile list stack in the second column, which absorbs whatever width the
 * map's own cap leaves over.
 */
const { t } = useI18n({ useScope: 'global' })
const printerConfig = usePrinterConfigStore()
const probeRun = useMeshProbeRunStore()

const hasProbe = computed(() => printerConfig.hasProbe)
const hasBedMesh = computed(() => printerConfig.hasBedMesh)
</script>

<template>
  <div class="calibration-stage calibration-stage--split calibration-stage--bed">
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

    <ProbeAccuracyPanel v-if="hasProbe" class="calibration-stage__probe" />

    <MeshProfilesPanel v-if="hasBedMesh" class="calibration-stage__profiles" />
  </div>
</template>
