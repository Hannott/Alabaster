<script setup lang="ts">
import ConsoleSettingsFields from '@/components/console/ConsoleSettingsFields.vue'
import { useConsoleModuleSettings } from '@/components/dashboard/modules/useConsoleModuleSettings'

/**
 * The card's full configuration, shown in the settings surface with the card
 * docked beside it — which is what makes the line count and the row density
 * judgeable: both change the card's height, and the effect is the point.
 *
 * The rows themselves come from `ConsoleSettingsFields`, shared with the card's
 * own quick layer and with the console page's settings, so the three surfaces
 * cannot drift into offering different options for the same behavior. Every row
 * renders here exactly once, in its own section, carrying the pin that decides
 * whether it also appears on the card — it is never repeated above the pane.
 */
const { settings, quick, hasTimelapse, update } = useConsoleModuleSettings()
</script>

<template>
  <ConsoleSettingsFields
    mode="pane"
    :settings="settings"
    :quick="quick"
    :has-timelapse="hasTimelapse"
    :show-line-count="true"
    @update="update($event)"
  />
</template>
