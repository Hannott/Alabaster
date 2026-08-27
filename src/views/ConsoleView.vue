<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ConsoleCommandBrowser from '@/components/console/ConsoleCommandBrowser.vue'
import ConsoleCommandInput from '@/components/console/ConsoleCommandInput.vue'
import ConsoleSettingsFields from '@/components/console/ConsoleSettingsFields.vue'
import ConsoleTranscript from '@/components/console/ConsoleTranscript.vue'
import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import PageHeading from '@/components/PageHeading.vue'
import { macroParamsFromSettings } from '@/dashboard/macroParams'
import { useAvailability } from '@/composables/useAvailability'
import { useConsoleSettings } from '@/composables/useConsoleSettings'
import { filterConsoleEntries } from '@/services/console/transcript'
import { useActionGuard } from '@/composables/useActionGuard'
import { useConsoleStore } from '@/stores/console'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'

/**
 * The full console. The dashboard card is for sending a command and watching the
 * answer; this is where a print's whole history is read back, where a filter is
 * set up, and where the machine's own command list is browsed.
 *
 * A `workspace-page` rather than a `standard-page`: the transcript has to take
 * the remaining viewport and own its own scrolling, which is the distinction
 * interface-standards.md draws between the two shells.
 */
const { t } = useI18n({ useScope: 'global' })
// The transcript, history and command list are the console store's; the pending
// flag and error for the `console` command key stay with the printer store's
// command runner, which is where the dispatch actually happens.
const gcodeConsole = useConsoleStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
/*
 * Both clears are page-level rather than module-local even though the card
 * reaches the transcript too: one action with one consequence must not answer to
 * two settings, or the reader sets a preference twice and finds it held half the
 * time. See dialog-system.md's "One action on two surfaces".
 */
const clearGuard = useActionGuard({ tier: 'terminal', emphasis: 'quiet', key: 'clearConsole' })
const clearHistoryGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'clearCommandHistory',
})
const klipper = useAvailability('klipper')
const { settings, update } = useConsoleSettings()
const prompt = ref<InstanceType<typeof ConsoleCommandInput> | null>(null)

/** Which aside is showing. One region rather than two, so narrow widths have one
 * thing to linearize and the toolbar has no state that survives out of view. */
const panel = ref<'none' | 'commands' | 'settings'>('none')

const entries = computed(() =>
  filterConsoleEntries(gcodeConsole.consoleEntries, {
    hideTemperatureReports: settings.value.hideTemperatureReports,
    hideTimelapseCommands: settings.value.hideTimelapseCommands,
  }),
)

const hiddenCount = computed(() => gcodeConsole.consoleEntries.length - entries.value.length)
const inputOnTop = computed(() => settings.value.inputPosition === 'top')
const commands = computed(() => gcodeConsole.gcodeHelp.map((entry) => entry.command))
function getMacroParams(macroName: string) {
  return macroParamsFromSettings(printerConfig.settings, macroName)
}
const hasTimelapse = computed(() =>
  gcodeConsole.gcodeHelp.some((entry) => entry.command.includes('TIMELAPSE')),
)

function togglePanel(next: 'commands' | 'settings'): void {
  panel.value = panel.value === next ? 'none' : next
}

function useCommand(command: string): void {
  void prompt.value?.fill(command)
}

/*
 * Both clears ask first, on the same keys the dashboard card's header action
 * uses — the transcript and the history belong to the printer rather than to
 * whichever surface emptied them, so the setting is shared. See
 * `docs/design/dialog-system.md`'s "One action on two surfaces".
 */
const clearing = ref(false)
const clearingHistory = ref(false)

function clearConsole(): void {
  clearing.value = false
  gcodeConsole.clearConsole()
}

function requestClear(): void {
  if (clearGuard.guarded.value) clearing.value = true
  else clearConsole()
}

function clearCommandHistory(): void {
  clearingHistory.value = false
  gcodeConsole.clearCommandHistory()
}

function requestClearHistory(): void {
  if (clearHistoryGuard.guarded.value) clearingHistory.value = true
  else clearCommandHistory()
}
</script>

<template>
  <section class="workspace-page console-page">
    <PageHeading :title="t('console.title')" />

    <AvailabilityRegion requires="klipper" class="console-page__availability">
      <div class="console-workspace" :data-panel="panel">
        <!--
          The prompt's side is a flex reversal on one DOM order, so moving it
          never remounts the transcript or the field and never loses a half-typed
          command.
        -->
        <section
          class="console-main"
          :class="{ 'console-main--input-top': inputOnTop }"
          :aria-label="t('console.title')"
        >
          <header class="console-toolbar">
            <!--
              No title here: the page-heading above already names the route, and
              repeating "Console" in this toolbar would be the same landmark name
              read twice. This div only ever carries the hidden-by-filters note,
              but it stays even when that note is absent so the actions on the
              other side of `space-between` keep one sibling to justify against.
            -->
            <div class="console-toolbar__identity">
              <p v-if="hiddenCount > 0" class="console-toolbar__note">
                {{ t('console.hiddenCount', { count: hiddenCount }) }}
              </p>
            </div>
            <div class="console-toolbar__actions">
              <button
                type="button"
                class="button button--quiet button--sm"
                :aria-pressed="panel === 'commands'"
                @click="togglePanel('commands')"
              >
                <AppIcon name="console" class="size-4" aria-hidden="true" />
                {{ t('console.help.open') }}
              </button>
              <button
                type="button"
                class="button button--quiet button--sm"
                :aria-pressed="panel === 'settings'"
                @click="togglePanel('settings')"
              >
                <AppIcon name="settings" class="size-4" aria-hidden="true" />
                {{ t('console.settings.open') }}
              </button>
              <button
                type="button"
                class="button button--sm"
                :class="clearGuard.variant.value"
                v-bind="clearGuard.bind.value"
                :disabled="gcodeConsole.consoleEntries.length === 0"
                @click="requestClear"
              >
                <AppIcon name="trash" class="size-4" aria-hidden="true" />
                {{ t('console.clear') }}
              </button>
            </div>
          </header>

          <ConsoleTranscript
            :entries="entries"
            :lines="null"
            :show-timestamps="settings.showTimestamps"
            :compact="settings.compact"
            :raw-output="settings.rawOutput"
            :follow="settings.followNewest"
            :newest-first="inputOnTop"
            @command="useCommand"
          />

          <div class="console-main__prompt">
            <ConsoleCommandInput
              ref="prompt"
              :history="gcodeConsole.commandHistory"
              :commands="commands"
              :get-macro-params="getMacroParams"
              :disabled="!klipper.isAvailable.value"
              :pending="printer.pendingCommands.console"
              @send="gcodeConsole.sendConsoleCommand($event)"
            />
          </div>
        </section>

        <aside
          v-if="panel !== 'none'"
          class="console-aside"
          :aria-label="panel === 'commands' ? t('console.help.title') : t('console.settings.title')"
        >
          <header class="console-aside__header">
            <h2 class="text-card-title">
              {{ panel === 'commands' ? t('console.help.title') : t('console.settings.title') }}
            </h2>
            <button
              type="button"
              class="button button--quiet button--xs button--icon"
              :aria-label="t('console.closePanel')"
              @click="panel = 'none'"
            >
              <AppIcon name="close" class="size-4" aria-hidden="true" />
            </button>
          </header>
          <div class="console-aside__body">
            <ConsoleCommandBrowser
              v-if="panel === 'commands'"
              :commands="gcodeConsole.gcodeHelp"
              @select="useCommand"
            />
            <template v-else>
              <ConsoleSettingsFields
                :settings="settings"
                :has-timelapse="hasTimelapse"
                @update="update($event)"
              />
              <!--
                The history is the one thing on this panel that is stored rather
                than displayed, so it gets a section instead of a row: the rows
                above are shared with the card and own no state, and an action
                among them would appear on the card's quick layer too. It says
                how much is remembered before offering to forget it, because the
                arrow-key history is invisible until it is gone.
              -->
              <SurfaceSection
                :title="t('console.history')"
                :hint="t('console.historyHint')"
                divided
              >
                <p class="hint">
                  {{
                    gcodeConsole.commandHistory.length > 0
                      ? t('console.historyCount', { count: gcodeConsole.commandHistory.length })
                      : t('console.historyEmpty')
                  }}
                </p>
                <button
                  type="button"
                  class="button button--sm button--start"
                  :class="clearHistoryGuard.variant.value"
                  v-bind="clearHistoryGuard.bind.value"
                  :disabled="gcodeConsole.commandHistory.length === 0"
                  @click="requestClearHistory"
                >
                  <AppIcon name="trash" class="size-4" aria-hidden="true" />
                  {{ t('console.clearHistory') }}
                </button>
              </SurfaceSection>
            </template>
          </div>
        </aside>
      </div>
    </AvailabilityRegion>

    <ConfirmDialog
      :open="clearing"
      :title="t('console.clearTitle')"
      :description="t('console.clearConfirm')"
      :confirm-label="t('console.clear')"
      tone="danger"
      @confirm="clearConsole"
      @cancel="clearing = false"
    />

    <ConfirmDialog
      :open="clearingHistory"
      :title="t('console.clearHistoryTitle')"
      :description="t('console.clearHistoryConfirm')"
      :confirm-label="t('console.clearHistoryAction')"
      tone="danger"
      @confirm="clearCommandHistory"
      @cancel="clearingHistory = false"
    />
  </section>
</template>
