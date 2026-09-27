<script setup lang="ts">
import { computed, ref } from 'vue'

import CalibrationProcedureList from '@/components/calibration/CalibrationProcedureList.vue'
import CalibrationProcedureWorkspace from '@/components/calibration/CalibrationProcedureWorkspace.vue'
import CalibrationReadiness from '@/components/calibration/CalibrationReadiness.vue'
import EndstopsPanel from '@/components/calibration/EndstopsPanel.vue'
import HeaterCheckPanel from '@/components/calibration/HeaterCheckPanel.vue'
import RotationDistancePanel from '@/components/calibration/RotationDistancePanel.vue'
import RunoutSensorsPanel from '@/components/calibration/RunoutSensorsPanel.vue'
import { useProcedureContext } from '@/composables/useProcedureContext'
import {
  initialProcedure,
  proceduresForStage,
  type ProcedureId,
} from '@/features/calibration/procedures'
import type { CalibrationStageId } from '@/features/calibration/stages'
import { useCalibrationStore } from '@/stores/calibration'

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

defineSlots<{ live(): unknown }>()

const calibration = useCalibrationStore()
const context = useProcedureContext()

const procedures = computed(() => proceduresForStage(props.stage, context.value))

/*
 * Component state, like the stage itself: a query would remount the page and
 * the docked console with it (see CalibrationView). Resolved against the live
 * list, so a procedure whose hardware disappears mid-sitting falls back rather
 * than leaving an empty workspace. Chosen on arrival as the first ageing
 * procedure that is due, which shows what needs doing without a notification.
 */
const requested = ref<ProcedureId | null>(null)
const selected = computed(() => {
  const chosen = procedures.value.find((procedure) => procedure.id === requested.value)
  if (chosen) return chosen
  return initialProcedure(procedures.value, (id) => calibration.lastRunAt(id), Date.now())
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
          @select="requested = $event"
        />
      </div>

      <div v-if="selected" class="calibration-bench__column calibration-bench__column--work">
        <EndstopsPanel v-if="selected.panel === 'endstops'" />
        <RunoutSensorsPanel v-else-if="selected.panel === 'runoutSensors'" />
        <HeaterCheckPanel v-else-if="selected.panel === 'heaterCheck'" />
        <RotationDistancePanel v-else-if="selected.panel === 'rotationDistance'" />
        <!--
          One instance across procedures, not one per procedure: the values a
          reader typed are kept per procedure inside it while the page is open.
        -->
        <CalibrationProcedureWorkspace v-else :procedure="selected" :skip-confirm="skipConfirm" />
      </div>

      <div class="calibration-bench__column calibration-bench__column--live">
        <slot name="live"></slot>
      </div>
    </div>
  </div>
</template>
