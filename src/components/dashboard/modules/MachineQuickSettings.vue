<script setup lang="ts">
import MachineCardSettingsFields from '@/components/dashboard/modules/MachineCardSettingsFields.vue'

/**
 * What the card's own gear-opened disclosure layer shows: exactly the
 * settings promoted from the full settings pane, in pane order — see
 * `docs/design/settings-surface.md`. Renders nothing when none are promoted.
 */
</script>

<template>
  <MachineCardSettingsFields mode="quick" />
</template>
