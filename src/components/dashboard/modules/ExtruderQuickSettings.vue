<script setup lang="ts">
import ExtruderCardSettingsFields from '@/components/dashboard/modules/ExtruderCardSettingsFields.vue'

/**
 * What the card's own disclosure layer shows: exactly the settings the user has
 * promoted from the full settings pane, in the same fixed order the pane lists
 * them — see `docs/design/settings-surface.md`.
 *
 * Length and feedrate used to be promotable rows here. They are now a
 * permanent part of the card's main body, beside the buttons they command —
 * see `ExtruderModule.vue`'s feed rows — so there is nothing left for this
 * layer to promote them from.
 */
</script>

<template>
  <ExtruderCardSettingsFields mode="quick" />
</template>
