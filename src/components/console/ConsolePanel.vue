<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ConsoleCommandBrowser from '@/components/console/ConsoleCommandBrowser.vue'
import ConsoleCommandInput from '@/components/console/ConsoleCommandInput.vue'
import ConsoleSettingsFields from '@/components/console/ConsoleSettingsFields.vue'
import ConsoleTranscript from '@/components/console/ConsoleTranscript.vue'
import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import { macroParamsFromSettings } from '@/dashboard/macroParams'
import { useAvailability } from '@/composables/useAvailability'
import { useConsoleSettings } from '@/composables/useConsoleSettings'
import { filterConsoleEntries } from '@/services/console/transcript'
import { useActionGuard } from '@/composables/useActionGuard'
import { useConsoleStore } from '@/stores/console'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'

/**
 * The full console: toolbar, transcript, prompt, and the aside that browses the
 * machine's command list or edits the settings.
 *
 * This is the Console route's own console, extracted so a second surface can
 * render it rather than approximate it. The Calibration bench is that surface,
 * and the approximation it replaced is the reason this component exists: the
 * bench first hosted the *dashboard card* instead, which looked close enough and
 * was not. The card is a glance at the last few lines — it reads its filters
 * from one dashboard instance's configuration and it has no command browser, and
 * the filters a reader set up on the Console page were simply not the ones they
 * got.
 *
 * Sharing this component instead settles all three at once: `useConsoleSettings`
 * is module-level state, so a filter, a timestamp preference or a prompt
 * position set on either surface holds on the other, and the two clears keep
 * answering to the same guard keys — see `dialog-system.md`'s "One action on two
 * surfaces".
 *
 * The one real difference between the two hosts is height, which is what `fill`
 * names. It is not a styling flag: the two branches are genuinely different
 * mechanisms in `ConsoleTranscript`, a pane-filling box that owns its own
 * scrolling versus a box that states its height in lines. That is also why the
 * bench is where `visibleLines` finally means something — the setting has been
 * in the shared shape all along, carried and never rendered because the page
 * fills its pane.
 */
const props = defineProps<{
  /**
   * Take the height the surrounding pane gives, and own the scrolling inside
   * it. For a `workspace-page` that has bounded the console already. Without
   * it the console states its own height from `visibleLines`, which is what a
   * `standard-page` needs, since nothing there has bounded anything.
   */
  fill?: boolean
}>()

const { t } = useI18n({ useScope: 'global' })
// The transcript, history and command list are the console store's; the pending
// flag and error for the `console` command key stay with the printer store's
// command runner, which is where the dispatch actually happens.
const gcodeConsole = useConsoleStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
/*
 * Both clears are surface-level rather than per-instance even though a dashboard
 * card reaches the same transcript: one action with one consequence must not
 * answer to two settings, or the reader sets a preference twice and finds it
 * held half the time. See dialog-system.md's "One action on two surfaces".
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

/**
 * `null` hands the transcript its pane-filling mode; a count makes it state its
 * own height. Clamped to the bounds the settings field itself accepts, because
 * the value is persisted in a preference a user can hand-edit and a console
 * sized from an absurd count would either collapse to nothing or push the page
 * below it out of reach.
 */
const transcriptLines = computed(() =>
  props.fill ? null : Math.min(Math.max(Math.round(settings.value.visibleLines), 5), 100),
)

function togglePanel(next: 'commands' | 'settings'): void {
  panel.value = panel.value === next ? 'none' : next
}

function useCommand(command: string): void {
  void prompt.value?.fill(command)
}

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
  <div class="console-workspace" :class="{ 'console-workspace--sized': !fill }" :data-panel="panel">
    <!--
      The prompt's side is a flex reversal on one DOM order, so moving it never
      remounts the transcript or the field and never loses a half-typed command.
    -->
    <section
      class="console-main"
      :class="{ 'console-main--input-top': inputOnTop }"
      :aria-label="t('console.title')"
    >
      <header class="console-toolbar">
        <!--
          No title here: on the Console route the page-heading above already
          names it, and on the Calibration bench the transcript below says what
          it is more plainly than a word would. This div only ever carries the
          hidden-by-filters note, but it stays even when that note is absent so
          the actions on the other side of `space-between` keep one sibling to
          justify against.
        -->
        <div class="console-toolbar__identity">
          <p v-if="hiddenCount > 0" class="console-toolbar__note">
            {{ t('console.hiddenCount', { count: hiddenCount }) }}
          </p>
        </div>
        <div class="console-toolbar__actions">
          <AppButton
            variant="quiet"
            size="sm"
            icon="console"
            :label="t('console.help.open')"
            :aria-pressed="panel === 'commands'"
            @click="togglePanel('commands')"
          />
          <AppButton
            variant="quiet"
            size="sm"
            icon="settings"
            :label="t('console.settings.open')"
            :aria-pressed="panel === 'settings'"
            @click="togglePanel('settings')"
          />
          <AppButton
            size="sm"
            :guard="clearGuard"
            icon="trash"
            :label="t('console.clear')"
            :disabled="gcodeConsole.consoleEntries.length === 0"
            @click="requestClear"
          />
        </div>
      </header>

      <ConsoleTranscript
        :entries="entries"
        :lines="transcriptLines"
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
        <AppButton
          variant="quiet"
          size="xs"
          icon-only
          icon="close"
          :aria-label="t('console.closePanel')"
          @click="panel = 'none'"
        />
      </header>
      <div class="console-aside__body">
        <ConsoleCommandBrowser
          v-if="panel === 'commands'"
          :commands="gcodeConsole.gcodeHelp"
          @select="useCommand"
        />
        <template v-else>
          <!--
            `show-line-count` follows the same fact `fill` does: a console that
            states its height in lines is one whose line count is worth
            offering. On a pane-filling console the setting means nothing, which
            is why the field has always been gated rather than merely hidden.
          -->
          <ConsoleSettingsFields
            :settings="settings"
            :has-timelapse="hasTimelapse"
            :show-line-count="!fill"
            mode="page"
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
          <SurfaceSection :title="t('console.history')" :hint="t('console.historyHint')" divided>
            <p class="hint">
              {{
                gcodeConsole.commandHistory.length > 0
                  ? t('console.historyCount', { count: gcodeConsole.commandHistory.length })
                  : t('console.historyEmpty')
              }}
            </p>
            <AppButton
              size="sm"
              start
              :guard="clearHistoryGuard"
              icon="trash"
              :label="t('console.clearHistory')"
              :disabled="gcodeConsole.commandHistory.length === 0"
              @click="requestClearHistory"
            />
          </SurfaceSection>
        </template>
      </div>
    </aside>

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
  </div>
</template>
