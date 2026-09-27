<script setup lang="ts">
import CalibrationBench from '@/components/calibration/CalibrationBench.vue'
import TuningResultsPanel from '@/components/calibration/TuningResultsPanel.vue'

/**
 * Resonance: Klipper's own shaper calibration, Shake&Tune's runs, and the
 * accelerometer checks worth making before either.
 *
 * Shake&Tune's graphs are the live column, and it takes the width: they are
 * wide images read at size, and a finished run presents its own graph there.
 * The runs themselves are procedures like every other stage's, so the graph
 * panel only reads.
 */
</script>

<template>
  <CalibrationBench stage="resonance" live-wide>
    <template #live>
      <TuningResultsPanel />
    </template>
  </CalibrationBench>
</template>
