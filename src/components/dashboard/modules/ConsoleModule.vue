<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ConsoleCommandInput from '@/components/console/ConsoleCommandInput.vue'
import ConsoleTranscript from '@/components/console/ConsoleTranscript.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import ConsoleQuickSettings from '@/components/dashboard/modules/ConsoleQuickSettings.vue'
import { filterConsoleEntries } from '@/services/console/transcript'
import {
  configBoolean,
  configNumber,
  configString,
  useDashboardModule,
  useDashboardModuleHeaderAction,
} from '@/dashboard/context'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useConsoleStore } from '@/stores/console'
import { usePrinterStore } from '@/stores/printer'

const { t } = useI18n({ useScope: 'global' })
// The transcript, history and command list are the console store's; the pending
// flag and error for the `console` command key stay with the printer store's
// command runner, which is where the dispatch actually happens.
const gcodeConsole = useConsoleStore()
const printer = usePrinterStore()
const confirmations = useConfirmationsStore()
const { config, isSettingsOpen } = useDashboardModule('console')
const prompt = ref<InstanceType<typeof ConsoleCommandInput> | null>(null)
const clearing = ref(false)

/**
 * Clamped here rather than trusted, to the same bounds the settings field accepts:
 * the value is persisted in a profile a user can hand-edit, and a card sized from
 * an absurd count would either collapse to nothing or push every card below it off
 * the dashboard.
 */
const visibleLines = computed(() =>
  Math.min(Math.max(Math.round(configNumber(config.value, 'visibleLines', 12)), 5), 100),
)
const hideTemperatureReports = computed(() =>
  configBoolean(config.value, 'hideTemperatureReports', true),
)
const hideTimelapseCommands = computed(() =>
  configBoolean(config.value, 'hideTimelapseCommands', true),
)
const showTimestamps = computed(() => configBoolean(config.value, 'showTimestamps', false))
const compact = computed(() => configBoolean(config.value, 'compact', false))
const rawOutput = computed(() => configBoolean(config.value, 'rawOutput', false))
const followNewest = computed(() => configBoolean(config.value, 'followNewest', true))
const inputOnTop = computed(() => configString(config.value, 'inputPosition', 'bottom') === 'top')

const entries = computed(() =>
  filterConsoleEntries(gcodeConsole.consoleEntries, {
    hideTemperatureReports: hideTemperatureReports.value,
    hideTimelapseCommands: hideTimelapseCommands.value,
  }),
)

const commands = computed(() => gcodeConsole.gcodeHelp.map((entry) => entry.command))

/**
 * Clear is frequent enough on a card that exists to watch a live transcript
 * that it earns a header spot beside Settings and Collapse, rather than
 * living behind the gear where the transcript filling up is not visible.
 *
 * It asks first, on the shared `clearConsole` key rather than a module-local
 * one: the page's toolbar clears the same transcript and writes the same
 * printer-wide cutoff, and one action with one consequence must not answer to
 * two settings — see `docs/design/dialog-system.md`'s "One action on two
 * surfaces". A trash icon between Settings and Collapse is a plausible misclick,
 * and what it costs is not recoverable from anywhere: Moonraker's retained
 * output from before the cutoff stays hidden for good.
 */
function clearConsole(): void {
  clearing.value = false
  gcodeConsole.clearConsole()
}

useDashboardModuleHeaderAction(
  computed(() => ({
    icon: 'trash',
    label: t('dashboard.console.clear'),
    disabled: gcodeConsole.consoleEntries.length === 0,
    onClick: () => {
      if (confirmations.shouldConfirm('clearConsole')) clearing.value = true
      else clearConsole()
    },
  })),
)
</script>

<template>
  <!--
    inset: the transcript below runs to the card's edges, so this body
    carries no padding of its own — the same situation Print is in, and the
    same class (see AppDashboardModule's own doc comment for why).
  -->
  <AppDashboardModule inset :open="isSettingsOpen">
    <template #quick-settings>
      <ConsoleQuickSettings />
      <!--
        The card is a place to send a command and watch the answer. Reading back
        through a print's history, or looking up what a macro takes, is the
        page's job — so the card links there rather than growing a second copy of
        it.
      -->
      <RouterLink :to="{ name: 'console' }" class="button button--quiet button--xs button--start">
        <AppIcon name="console" class="size-4" aria-hidden="true" />
        {{ t('dashboard.console.openPage') }}
      </RouterLink>
    </template>

    <!--
      The prompt sits against the transcript with no separator between them: the
      two are one surface, the way a terminal's input line belongs to the output
      beside it rather than to a form elsewhere. Which side it takes is the user's
      choice, and the transcript flips which end is newest to match.
    -->
    <div class="console-module__body" :class="{ 'console-module__body--input-top': inputOnTop }">
      <ConsoleTranscript
        :entries="entries"
        :lines="visibleLines"
        :show-timestamps="showTimestamps"
        :compact="compact"
        :raw-output="rawOutput"
        :follow="followNewest"
        :newest-first="inputOnTop"
        @command="prompt?.fill($event)"
      />
      <div class="console-module__prompt">
        <ConsoleCommandInput
          ref="prompt"
          :history="gcodeConsole.commandHistory"
          :commands="commands"
          :pending="printer.pendingCommands.console"
          @send="gcodeConsole.sendConsoleCommand($event)"
        />
      </div>
    </div>

    <ConfirmDialog
      :open="clearing"
      :title="t('console.clearTitle')"
      :description="t('console.clearConfirm')"
      :confirm-label="t('console.clear')"
      tone="danger"
      @confirm="clearConsole"
      @cancel="clearing = false"
    />
  </AppDashboardModule>
</template>
