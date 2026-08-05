<script setup lang="ts">
import BedMeshScaleSettingsFields from '@/components/dashboard/modules/BedMeshScaleSettingsFields.vue'
import BedMeshViewSettingsFields from '@/components/dashboard/modules/BedMeshViewSettingsFields.vue'

/**
 * What the card's own disclosure layer shows: exactly the settings the user has
 * promoted from the full settings pane, in the same fixed order the pane lists
 * them — see `docs/design/settings-surface.md`. Both sections render, in pane
 * order, so a promoted row sits where the pane taught the user to expect it;
 * each renders nothing at all when none of its rows are promoted.
 */
</script>

<template>
  <BedMeshViewSettingsFields mode="quick" />
  <BedMeshScaleSettingsFields mode="quick" />
</template>
