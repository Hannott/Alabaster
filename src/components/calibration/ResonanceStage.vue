<script setup lang="ts">
import AxesMapCard from '@/components/calibration/AxesMapCard.vue'
import CalibrationBench from '@/components/calibration/CalibrationBench.vue'
import ShaperFitsCard from '@/components/calibration/ShaperFitsCard.vue'
import TuningResultsPanel from '@/components/calibration/TuningResultsPanel.vue'

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
 * comparison of every shaper it fitted instead of Shake&Tune's graphs. The axis
 * map puts the accelerometer's orientation above them, and keeps them: Shake&Tune
 * draws the axis map as a graph of its own.
 */
</script>

<template>
  <CalibrationBench stage="resonance" live-wide>
    <template #live="{ procedure }">
      <ShaperFitsCard v-if="procedure?.id === 'shaperCalibrate'" />
      <AxesMapCard v-if="procedure?.id === 'axesMap'" />
      <TuningResultsPanel v-if="procedure?.id !== 'shaperCalibrate'" />
    </template>
  </CalibrationBench>
</template>
