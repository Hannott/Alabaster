<script setup lang="ts">
import BeltGuideCard from '@/components/calibration/BeltGuideCard.vue'
import CalibrationBench from '@/components/calibration/CalibrationBench.vue'
import ShaperFitsCard from '@/components/calibration/ShaperFitsCard.vue'
import TuningResultsPanel from '@/components/calibration/TuningResultsPanel.vue'
import type { CalibrationProcedure, ProcedureId } from '@/features/calibration/procedures'
import type { ShakeTuneCategory } from '@/stores/shakeTune'

/**
 * Resonance: Klipper's own shaper calibration, Shake&Tune's runs, and the
 * accelerometer checks worth making before either.
 *
 * Shake&Tune's graphs are the live column, and it takes the width: they are
 * wide images read at size, and a finished run presents its own graph there.
 * The runs themselves are procedures like every other stage's, so the graph
 * panel only reads.
 *
 * Klipper's own shaper calibration has no graph on disk, so its column is the
 * comparison of every shaper it fitted instead of Shake&Tune's graphs. A
 * Shake&Tune procedure opens its own newest graph — the axis map its
 * orientation plot, the belts their comparison — rather than whichever graph
 * of any kind is newest; `AXES_MAP_CALIBRATION` is Shake&Tune's alone, and
 * its plot already draws the chip's axes against the machine's.
 *
 * The belt comparison adds its guide under the graphs rather than above them:
 * the guide's inputs are read off the graph, and opening it above would push
 * the graph being read out of view.
 */

const graphCategories: Partial<Record<ProcedureId, ShakeTuneCategory>> = {
  axesMap: 'axesMap',
  shakeTuneBelts: 'belts',
  shakeTuneShaper: 'inputShaper',
  shakeTuneVibrations: 'vibrations',
}

function categoryFor(procedure: CalibrationProcedure | null): ShakeTuneCategory | undefined {
  return procedure ? graphCategories[procedure.id] : undefined
}
</script>

<template>
  <CalibrationBench stage="resonance" live-wide>
    <template #live="{ procedure }">
      <ShaperFitsCard v-if="procedure?.id === 'shaperCalibrate'" />
      <TuningResultsPanel v-else :category="categoryFor(procedure)" />
      <BeltGuideCard v-if="procedure?.id === 'shakeTuneBelts'" />
    </template>
  </CalibrationBench>
</template>
