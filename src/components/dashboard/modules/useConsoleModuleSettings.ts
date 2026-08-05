import { computed, type ComputedRef } from 'vue'

import type { ConsoleSettings } from '@/components/console/ConsoleSettingsFields.vue'
import { configBoolean, configNumber, configString, useDashboardModule } from '@/dashboard/context'
import { consoleDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings, type QuickSettingsController } from '@/dashboard/quickSettings'
import { useConsoleStore } from '@/stores/console'

/**
 * Everything `ConsoleSettingsFields` needs to render the Console card's rows,
 * read once here rather than twice.
 *
 * The card's settings pane and its own quick layer both mount those fields, and
 * both have to hand them the same settings object, the same promotion
 * controller, and the same answer about timelapse. Written out in each
 * component, the pair drifted the moment one of them gained a key — which is
 * the same failure the shared fields component itself exists to prevent, one
 * level up.
 */
export interface ConsoleModuleSettings {
  settings: ComputedRef<ConsoleSettings>
  quick: QuickSettingsController
  /**
   * Whether this machine has timelapse at all, read from its own command list
   * rather than from a hard-coded assumption. A printer without it gets no
   * timelapse row, the same way a printer without a chamber heater gets no
   * chamber control.
   */
  hasTimelapse: ComputedRef<boolean>
  update: (patch: Partial<ConsoleSettings>) => void
}

export function useConsoleModuleSettings(): ConsoleModuleSettings {
  const gcodeConsole = useConsoleStore()
  const { config, updateConfig } = useDashboardModule('console')

  const settings = computed<ConsoleSettings>(() => ({
    hideTemperatureReports: configBoolean(config.value, 'hideTemperatureReports', true),
    hideTimelapseCommands: configBoolean(config.value, 'hideTimelapseCommands', true),
    showTimestamps: configBoolean(config.value, 'showTimestamps', false),
    compact: configBoolean(config.value, 'compact', false),
    rawOutput: configBoolean(config.value, 'rawOutput', false),
    followNewest: configBoolean(config.value, 'followNewest', true),
    visibleLines: configNumber(config.value, 'visibleLines', 12),
    inputPosition:
      configString(config.value, 'inputPosition', 'bottom') === 'top' ? 'top' : 'bottom',
  }))

  return {
    settings,
    quick: useQuickSettings(config, updateConfig, consoleDefaultQuickKeys),
    hasTimelapse: computed(() =>
      gcodeConsole.gcodeHelp.some((entry) => entry.command.includes('TIMELAPSE')),
    ),
    update: (patch) => updateConfig(patch),
  }
}
