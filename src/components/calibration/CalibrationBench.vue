<script setup lang="ts">
import { computed, type Component } from 'vue'

import AxisRotationPanel from '@/components/calibration/AxisRotationPanel.vue'
import CalibrationProcedureList from '@/components/calibration/CalibrationProcedureList.vue'
import CalibrationProcedureWorkspace from '@/components/calibration/CalibrationProcedureWorkspace.vue'
import CalibrationReadiness from '@/components/calibration/CalibrationReadiness.vue'
import EndstopsPanel from '@/components/calibration/EndstopsPanel.vue'
import HeaterCheckPanel from '@/components/calibration/HeaterCheckPanel.vue'
import LoadCellPanel from '@/components/calibration/LoadCellPanel.vue'
import NonlinearPressureAdvancePanel from '@/components/calibration/NonlinearPressureAdvancePanel.vue'
import ProbeXyOffsetPanel from '@/components/calibration/ProbeXyOffsetPanel.vue'
import RotationDistancePanel from '@/components/calibration/RotationDistancePanel.vue'
import RunoutSensorsPanel from '@/components/calibration/RunoutSensorsPanel.vue'
import ScrewPositionsPanel from '@/components/calibration/ScrewPositionsPanel.vue'
import SensorlessHomingPanel from '@/components/calibration/SensorlessHomingPanel.vue'
import SkewCorrectionPanel from '@/components/calibration/SkewCorrectionPanel.vue'
import TuningTowerPanel from '@/components/calibration/TuningTowerPanel.vue'
import { useCalibrationSelection } from '@/composables/useCalibrationSelection'
import { useProcedureContext } from '@/composables/useProcedureContext'
import {
  proceduresForStage,
  type CalibrationProcedure,
  type ProcedureId,
  type ProcedurePanel,
} from '@/features/calibration/procedures'
import type { CalibrationStageId } from '@/features/calibration/stages'

/** The guided panel each `panel:` entry in the registry renders as. */
const panelComponents: Record<ProcedurePanel, Component> = {
  endstops: EndstopsPanel,
  axisRotation: AxisRotationPanel,
  runoutSensors: RunoutSensorsPanel,
  heaterCheck: HeaterCheckPanel,
  rotationDistance: RotationDistancePanel,
  nonlinearPressureAdvance: NonlinearPressureAdvancePanel,
  sensorlessHoming: SensorlessHomingPanel,
  skewCorrection: SkewCorrectionPanel,
  probeXyOffset: ProbeXyOffsetPanel,
  screwPositions: ScrewPositionsPanel,
  loadCell: LoadCellPanel,
  tuningTower: TuningTowerPanel,
}

/**
 * One stage of Calibration: what the procedures here need, the procedures
 * themselves, the selected one's workspace, and — in the `live` slot — what
 * they act on, still live: the height map, the toolhead, the heater chart.
 *
 * Three independent column stacks, never a grid whose rows the columns share.
 * The stages used to place dashboard cards of very different heights side by
 * side in one grid, and every row took the height of its tallest card: up to
 * 400 px of nothing sat under the shorter ones. A column that is its own stack
 * cannot leave a hole in another.
 */
const props = defineProps<{
  stage: CalibrationStageId
  /** The live column holds the stage's artifact (a map, the graphs) and takes the width. */
  liveWide?: boolean | undefined
  skipConfirm?: boolean | undefined
}>()

defineSlots<{
  /**
   * Given the open procedure, so a stage can put what that procedure is about
   * in the live column instead of the same card for every one of them.
   */
  live(props: { procedure: CalibrationProcedure | null }): unknown
}>()

/** Forwarded from `CalibrationProcedureWorkspace`, up to whichever stage passed `skipConfirm`. */
const emit = defineEmits<{ skip: [] }>()

const context = useProcedureContext()

const procedures = computed(() => proceduresForStage(props.stage, context.value))

/*
 * In-memory state, like the stage itself and kept per stage beside it: a
 * query would remount the page and the docked console with it (see
 * CalibrationView). Resolved against the live
 * list, so a procedure whose hardware disappears mid-sitting falls back rather
 * than leaving an empty workspace. A stage arrives on its first procedure: the
 * list is ordered verify-first, and a procedure that is due says so in its own
 * row and under the result before it.
 */
const selection = useCalibrationSelection()
const selected = computed(() => {
  const requested = selection.procedureFor(props.stage)
  const chosen = procedures.value.find((procedure) => procedure.id === requested)
  if (chosen) return chosen
  return procedures.value[0] ?? null
})

/*
 * One dynamic child for `KeepAlive`, which keeps one instance per component:
 * the generic workspace across every procedure it serves, and each guided
 * panel across the procedures opened in between. A `v-if`/`v-else` pair
 * inside `KeepAlive` is the shape Vue's runtime trips over on unmount.
 */
const workComponent = computed<Component | null>(() => {
  if (!selected.value) return null
  return selected.value.panel
    ? panelComponents[selected.value.panel]
    : CalibrationProcedureWorkspace
})

const workProps = computed<Record<string, unknown>>(() => {
  if (!selected.value || selected.value.panel) return {}
  return {
    procedure: selected.value,
    procedures: procedures.value,
    skipConfirm: props.skipConfirm,
    onSkip: () => emit('skip'),
    onSelect: (id: ProcedureId) => selection.selectProcedure(props.stage, id),
  }
})
</script>

<template>
  <div class="calibration-bench" :class="{ 'calibration-bench--wide-live': liveWide }">
    <CalibrationReadiness :procedures="procedures" />

    <div class="calibration-bench__columns">
      <div class="calibration-bench__column calibration-bench__column--list">
        <CalibrationProcedureList
          :procedures="procedures"
          :selected="selected?.id ?? null"
          @select="selection.selectProcedure(stage, $event)"
        />
      </div>

      <div v-if="selected" class="calibration-bench__column calibration-bench__column--work">
        <!--
          Kept alive across procedures, not remounted: a guided panel holds
          what the reader typed and recorded — a skew's lengths, a tower's
          height, the two positions an offset is measured between — and
          opening another row to check something lost all of it. The generic
          workspace keeps its values per procedure itself; the panels are kept
          whole. The stage's own remount (see CalibrationView) still clears
          them when the reader moves to another stage.
        -->
        <KeepAlive>
          <component :is="workComponent" v-bind="workProps" />
        </KeepAlive>
      </div>

      <div class="calibration-bench__column calibration-bench__column--live">
        <slot name="live" :procedure="selected"></slot>
      </div>
    </div>
  </div>
</template>
