<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import { macroColorVariable } from '@/components/dashboard/modules/macroColors'
import MacroRunControl from '@/components/dashboard/modules/MacroRunControl.vue'
import { currentVisibilityState } from '@/components/dashboard/modules/macroVisibility'
import MacrosQuickSettings from '@/components/dashboard/modules/MacrosQuickSettings.vue'
import {
  configBoolean,
  configStringList,
  configStringMap,
  useDashboardModule,
} from '@/dashboard/context'
import { dividerId, isDividerEntry } from '@/dashboard/macroDividers'
import { macroParamsFromSettings, type MacroParameter } from '@/dashboard/macroParams'
import { formatMacroLabel, useMacrosStore } from '@/stores/macros'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'

interface MacroEntry {
  kind: 'macro'
  key: string
  name: string
  label: string
  isMissing: boolean
  isRunning: boolean
  params: MacroParameter[]
  colorVariable: string | null
}

/** A section heading — see `dashboard/macroDividers.ts`. Renders as a plain
 * rule with no run behavior, so it never needs the fields a macro carries. */
interface DividerEntry {
  kind: 'divider'
  key: string
  label: string
}

type ListEntry = MacroEntry | DividerEntry

const { t } = useI18n({ useScope: 'global' })
const macros = useMacrosStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const { config, isSettingsOpen, isSurfaceOpen, openSurface } = useDashboardModule('macros')

const hideMissing = computed(() => configBoolean(config.value, 'hideMissing', false))
const selection = computed(() => configStringList(config.value, 'macros'))
const colors = computed(() => configStringMap(config.value, 'colors'))
const dividerLabels = computed(() => configStringMap(config.value, 'dividerLabels'))
const printState = computed(() => currentVisibilityState(printer.isPrinting, printer.isPaused))

/**
 * The whole card can be set aside for a print state — a maintenance group has
 * nothing to offer mid-print, and a load/unload group is a distraction once a
 * job is running. Absent keys default to shown, so a dashboard carried over
 * from before this setting existed loses nothing.
 */
const groupVisibleForState = computed(() => {
  const key =
    printState.value === 'standby'
      ? 'showInStandby'
      : printState.value === 'paused'
        ? 'showInPause'
        : 'showInPrinting'
  return configBoolean(config.value, key, true)
})

const hiddenMacroKey = computed(() =>
  printState.value === 'standby'
    ? 'hiddenInStandby'
    : printState.value === 'paused'
      ? 'hiddenInPaused'
      : 'hiddenInPrinting',
)

/** Selected minus whatever this print state hides, before the missing-macro
 * filter — kept separate so the empty state can tell "hidden right now" apart
 * from "the printer no longer defines these," which need different words. A
 * section heading is never hidden by print state — only a real macro row can
 * appear in `hiddenNow` — so it always survives this filter untouched. */
const visibleForState = computed(() => {
  const hiddenNow = configStringList(config.value, hiddenMacroKey.value)
  return selection.value.filter((entry) => !hiddenNow.includes(entry))
})

/** Selection entries that are actual macros, ignoring section headings —
 * what decides whether the card has "nothing chosen" versus "everything
 * chosen is hidden or missing right now." */
const macroSelectionCount = computed(
  () => selection.value.filter((entry) => !isDividerEntry(entry)).length,
)
const visibleMacroCount = computed(
  () => visibleForState.value.filter((entry) => !isDividerEntry(entry)).length,
)

const displayEntries = computed<ListEntry[]>(() =>
  visibleForState.value
    .map((entry): ListEntry => {
      const id = dividerId(entry)
      if (id !== null) {
        return { kind: 'divider', key: entry, label: dividerLabels.value[id] ?? '' }
      }
      return {
        kind: 'macro',
        key: entry,
        name: entry,
        label: formatMacroLabel(entry),
        isMissing: macros.isMissing(entry),
        isRunning: macros.isRunning(entry),
        params: macroParamsFromSettings(printerConfig.settings, entry),
        colorVariable: macroColorVariable(entry, colors.value),
      }
    })
    .filter((entry) => entry.kind === 'divider' || !entry.isMissing || !hideMissing.value),
)

/*
 * The grid's floor derives from the widest selected label rather than from a
 * constant, because macro names are user-authored and unbounded — a fixed
 * floor is how CALIBRATE_INPUT_SHAPER-length names truncate into identical
 * buttons. 0.45rem per character was measured against a true monospace
 * `--font-mono` (Liberation Mono, the Pi's own — not the developer
 * machine's), where every character is the same width. `--font-mono` now
 * tracks whichever typeface Settings has selected — see
 * `src/fonts/fonts.css` — and four of the five choices are proportional, so
 * this constant is a floor tuned for the monospace case, not an exact
 * per-character measurement for all of them. `min(…, 100%)` and the 9.5rem
 * floor below are what keep an under-estimate from actually overflowing a
 * card rather than merely reading a little tight.
 */
const gridStyle = computed(() => {
  const longest = displayEntries.value.reduce(
    (max, entry) => (entry.kind === 'macro' ? Math.max(max, entry.label.length) : max),
    0,
  )
  return { '--macro-min-col': `${(longest * 0.45 + 3.6).toFixed(2)}rem` }
})
</script>

<template>
  <AppDashboardModule :open="isSettingsOpen">
    <template #quick-settings>
      <MacrosQuickSettings />
    </template>

    <p v-if="!groupVisibleForState && macroSelectionCount > 0" class="text-xs text-muted">
      {{ t(`dashboard.macros.hiddenWhile.${printState}`) }}
    </p>

    <template v-else>
      <div v-if="displayEntries.length > 0" class="macro-grid" :style="gridStyle">
        <template v-for="entry in displayEntries" :key="entry.key">
          <p
            v-if="entry.kind === 'divider'"
            class="macro-heading text-label-caps text-muted"
            :aria-hidden="!entry.label || undefined"
          >
            {{ entry.label }}
          </p>
          <MacroRunControl
            v-else
            :label="entry.label"
            :is-missing="entry.isMissing"
            :is-running="entry.isRunning"
            :params="entry.params"
            :color-variable="entry.colorVariable"
            :disabled="isSurfaceOpen"
            @run="(values) => macros.run(entry.name, values)"
          />
        </template>
      </div>

      <!--
        Hiding every button is not the same as having chosen none, and offering
        "choose macros" to someone who already has would be a card lying about
        its own configuration. Which sentence fires depends on why the grid is
        empty: every candidate hidden for this print state reads differently
        from every candidate missing from the printer entirely. Section
        headings never factor into any of these three counts — an all-hidden
        or all-missing state is about the macros a heading merely labels.
      -->
      <p v-else-if="visibleMacroCount === 0 && macroSelectionCount > 0" class="text-xs text-muted">
        {{ t(`dashboard.macros.hiddenWhile.${printState}`) }}
      </p>
      <p v-else-if="macroSelectionCount > 0" class="text-xs text-muted">
        {{ t('dashboard.macros.allMissing') }}
      </p>

      <div v-else class="grid gap-3">
        <p class="text-xs text-muted">{{ t('dashboard.macros.empty') }}</p>
        <AppButton
          variant="primary"
          icon="add"
          :label="t('dashboard.macros.choose')"
          @click="openSurface()"
        />
      </div>
    </template>

    <p v-if="macros.failed" class="text-alert-inline" role="alert">
      {{ t('dashboard.macros.loadFailed') }}
    </p>
  </AppDashboardModule>
</template>
