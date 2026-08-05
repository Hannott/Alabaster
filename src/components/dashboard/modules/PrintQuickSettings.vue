<script setup lang="ts">
import PrintCardSettingsFields from '@/components/dashboard/modules/PrintCardSettingsFields.vue'
import PrintProgressSettingsFields from '@/components/dashboard/modules/PrintProgressSettingsFields.vue'

/**
 * What the card's own disclosure layer shows: exactly the settings the user has
 * promoted from the full settings pane, in the same fixed order the pane lists
 * them — see `docs/design/settings-surface.md`. Every section renders, in pane
 * order, so a promoted row sits where the pane taught the user to expect it;
 * each renders nothing at all when none of its rows are promoted.
 */
</script>

<template>
  <PrintCardSettingsFields mode="quick" />
  <PrintProgressSettingsFields mode="quick" />
</template>
