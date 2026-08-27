<script setup lang="ts">
import TuningResultsPanel from '@/components/calibration/TuningResultsPanel.vue'

/**
 * Resonance: the accelerometer noise floor, and Shake&Tune's graphs.
 *
 * One panel, given the whole canvas. The graph strips are wide and are read
 * newest-first along a row, so nothing sits beside them — this is the one stage
 * where a second column would take width the content is actually using.
 */
</script>

<template>
  <div class="calibration-stage">
    <TuningResultsPanel />
  </div>
</template>
