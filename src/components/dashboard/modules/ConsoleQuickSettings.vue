<script setup lang="ts">
import ConsoleSettingsFields from '@/components/console/ConsoleSettingsFields.vue'
import { useConsoleModuleSettings } from '@/components/dashboard/modules/useConsoleModuleSettings'

/**
 * What the card's own disclosure layer shows: exactly the settings the user has
 * promoted from the full settings pane, in the same fixed order the pane lists
 * them, from the same component the pane renders — see
 * `docs/design/settings-surface.md`.
 */
const { settings, quick, hasTimelapse, update } = useConsoleModuleSettings()
</script>

<template>
  <ConsoleSettingsFields
    mode="quick"
    :settings="settings"
    :quick="quick"
    :has-timelapse="hasTimelapse"
    @update="update($event)"
  />
</template>
