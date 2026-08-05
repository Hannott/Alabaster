<script setup lang="ts">
import MacrosCardSettingsFields from '@/components/dashboard/modules/MacrosCardSettingsFields.vue'

/**
 * What the card's own disclosure layer shows: exactly the settings the user has
 * promoted from the full settings pane, in the same fixed order the pane lists
 * them — see `docs/design/settings-surface.md`.
 */
</script>

<template>
  <MacrosCardSettingsFields mode="quick" />
</template>
