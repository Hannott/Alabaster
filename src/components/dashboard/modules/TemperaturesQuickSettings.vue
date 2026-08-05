<script setup lang="ts">
import TemperaturesChartSettingsFields from '@/components/dashboard/modules/TemperaturesChartSettingsFields.vue'

/**
 * What the card's own disclosure layer shows: exactly the History chart
 * settings the user has promoted from the full settings pane, in the same
 * fixed order — see `TemperaturesChartSettingsFields` and
 * `docs/design/settings-surface.md`.
 */
</script>

<template>
  <TemperaturesChartSettingsFields mode="quick" />
</template>
