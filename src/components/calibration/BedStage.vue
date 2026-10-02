<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import BedLayoutCard from '@/components/calibration/BedLayoutCard.vue'
import CalibrationBench from '@/components/calibration/CalibrationBench.vue'
import MeshProfilesPanel from '@/components/calibration/MeshProfilesPanel.vue'
import ProbeOffsetCard from '@/components/calibration/ProbeOffsetCard.vue'
import ProbeSamplesCard from '@/components/calibration/ProbeSamplesCard.vue'
import HostedDashboardModule from '@/components/dashboard/HostedDashboardModule.vue'
import BedMeshModule from '@/components/dashboard/modules/BedMeshModule.vue'
import MovementModule from '@/components/dashboard/modules/MovementModule.vue'
import { useCalibrationSelection } from '@/composables/useCalibrationSelection'
import { layoutProcedures, type LayoutProcedure } from '@/features/calibration/bedContext'
import type { CalibrationProcedure, ProcedureId } from '@/features/calibration/procedures'
import { useMeshProbeRunStore } from '@/stores/meshProbeRun'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * The bed as a surface: levelling, the mesh, the probe's offset and
 * repeatability, and whatever probe calibrations this printer's probe offers.
 *
 * The live column follows the open procedure, and it takes the width. A
 * procedure whose subject is something other than the surface gets a picture
 * of that subject: the probe's samples side on, the probe and the nozzle over
 * the bed, the bed from above with its screws or its steppers and probe
 * points. The two recorded by standing the toolhead somewhere — the probe's
 * X/Y offset and the screw positions — also get the Movement card under that
 * picture, to jog with. Every other procedure — the mesh itself, and the
 * probe calibrations whose result is the surface they map — gets the height
 * map and the saved profiles, the thing they change or depend on, which a
 * mesh being probed fills in point by point while the run is going.
 */
const { t } = useI18n({ useScope: 'global' })
const printerConfig = usePrinterConfigStore()
const probeRun = useMeshProbeRunStore()
const selection = useCalibrationSelection()

const hasBedMesh = computed(() => printerConfig.hasBedMesh)

/**
 * The open procedure, where it is drawn as the bed from above. Recording
 * screw positions draws the section being recorded, which its panel names.
 */
function layoutFor(procedure: CalibrationProcedure | null): LayoutProcedure | null {
  const id = procedure?.id
  if (id === 'screwPositions') {
    const subject = selection.subjectFor('screwPositions')
    if (subject === 'bedScrews' || subject === 'screwsTilt') return subject
    return printerConfig.hasSection('screws_tilt_adjust') ? 'screwsTilt' : 'bedScrews'
  }
  return layoutProcedures.find((candidate) => candidate === id) ?? null
}

/*
 * The procedures recorded by standing the toolhead somewhere, which put the
 * jog controls beside what they record.
 */
const jogProcedures = new Set<ProcedureId>(['probeXyOffset', 'screwPositions'])

/** The procedures about a sensor rather than the surface, which the map says nothing about. */
const sensorProcedures = new Set<ProcedureId>([
  'probeAccuracy',
  'probeZOffset',
  'loadCell',
  'eddyDriveCurrent',
  'probeDrift',
])

/** Whether the open procedure is about the surface, and so gets the map. */
function showsMap(procedure: CalibrationProcedure | null): boolean {
  const id = procedure?.id
  return (
    !(id !== undefined && sensorProcedures.has(id)) &&
    !(id !== undefined && jogProcedures.has(id)) &&
    layoutFor(procedure) === null
  )
}
</script>

<template>
  <CalibrationBench stage="bed" live-wide>
    <template #live="{ procedure }">
      <ProbeSamplesCard v-if="procedure?.id === 'probeAccuracy'" />
      <ProbeOffsetCard
        v-else-if="procedure?.id === 'probeZOffset' || procedure?.id === 'probeXyOffset'"
      />
      <BedLayoutCard
        v-else-if="layoutFor(procedure)"
        :procedure="layoutFor(procedure)!"
        :recording="procedure?.id === 'screwPositions'"
      />

      <HostedDashboardModule
        v-if="procedure && jogProcedures.has(procedure.id)"
        module-id="movement"
        :title="t('calibration.axes.movementTitle')"
        :sections="['motion', 'plan']"
      >
        <MovementModule />
      </HostedDashboardModule>

      <HostedDashboardModule
        v-if="hasBedMesh && showsMap(procedure)"
        module-id="bedMesh"
        :title="t('calibration.map.title')"
        class="calibration-stage__map"
      >
        <template #actions>
          <p
            v-if="probeRun.isRunning && !probeRun.isScanning"
            class="calibration-map__running"
            role="status"
          >
            <AppIcon name="mesh" class="size-4 shrink-0" aria-hidden="true" />
            {{ t('calibration.map.probing', { count: probeRun.points.length }) }}
          </p>
        </template>

        <!--
          Said while it matters and not before: the points are plotted against the
          mean of the run so far, because Klipper reports absolute trigger heights
          and the surface is drawn as deviation. Early points move as that mean
          settles, so the panel says the shape is provisional rather than letting
          it be read as the finished mesh. A scanning probe reports no points at
          all while it sweeps, so a machine with one says that instead, before
          and during a run — never "probing, 0 points so far" over a sweep.
        -->
        <p v-if="probeRun.isScanning" class="calibration-notice" role="status">
          <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
          <span>{{ t('calibration.map.scanningProbe') }}</span>
        </p>
        <p v-else-if="probeRun.isRunning" class="calibration-panel__hint">
          {{ t('calibration.map.provisional') }}
        </p>

        <!--
          The dashboard's own bed-mesh module, hosted at page size. It is the same
          component and the same renderer, not a second one — and the same saved
          configuration a dashboard card would read and write, so the settings gear
          `HostedDashboardModule` puts in the header changes both.
        -->
        <BedMeshModule live-probing force-probe-labels />
      </HostedDashboardModule>

      <!-- Its Calibrate opens the mesh procedure here rather than running a second copy of it. -->
      <MeshProfilesPanel
        v-if="hasBedMesh && showsMap(procedure)"
        class="calibration-stage__profiles"
        @calibrate="selection.selectProcedure('bed', 'bedMesh')"
      />
    </template>
  </CalibrationBench>
</template>
