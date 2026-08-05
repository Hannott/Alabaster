<script setup lang="ts">
import MovementCardSettingsFields from '@/components/dashboard/modules/MovementCardSettingsFields.vue'
import MovementStepSettingsFields from '@/components/dashboard/modules/MovementStepSettingsFields.vue'

/**
 * What the card's own disclosure layer shows: exactly the settings the user
 * has promoted from the full settings pane, in the same fixed order the pane
 * lists them — see `docs/design/settings-surface.md`. Both sections render, in
 * pane order, so a promoted row sits where the pane taught the user to expect
 * it; each renders nothing at all when none of its rows are promoted.
 */
</script>

<template>
  <MovementCardSettingsFields mode="quick" />
  <MovementStepSettingsFields mode="quick" />
</template>
