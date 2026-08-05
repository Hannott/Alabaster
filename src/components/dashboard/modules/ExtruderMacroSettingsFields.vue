<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import { configStringList, useDashboardModule } from '@/dashboard/context'
import { formatMacroLabel, useMacrosStore } from '@/stores/macros'

/**
 * Which macros the Extruder card offers beside Extrude and Retract.
 *
 * There is no default, and that is the point. Klipper defines no filament
 * macros — no `[load_filament]` section, no reserved name, no convention beyond
 * what individual users and vendor configs happen to write. The card previously
 * compiled in `LOAD_FILAMENT` and `UNLOAD_FILAMENT`, which were one person's
 * `printer.cfg`, and every other printer got an empty space with nothing to
 * configure and no hint that the card had been looking for anything.
 *
 * So the list starts empty and is filled from what this machine actually
 * reports. Any "sensible default" here is only a different person's config, and
 * it restores exactly the failure it was meant to soften: buttons that work on
 * the author's machine and nowhere else.
 *
 * A list rather than three fixed slots — load, unload and purge are what this
 * is for, but the shape that holds three holds four for free, and naming the
 * slots would bake in the same assumption about what a printer has.
 *
 * Not promotable to the quick layer: a picker over every macro the printer
 * defines is a pane-sized control, and this is chosen once per printer rather
 * than adjusted during a filament change. The lengths the buttons command are
 * the promotable part, and they already are.
 */
const { t } = useI18n({ useScope: 'global' })
const macros = useMacrosStore()
const { config, updateConfig } = useDashboardModule('extruder')

const selected = computed(() => configStringList(config.value, 'macros'))

const selectedButtons = computed(() =>
  selected.value.map((name) => ({
    name,
    label: formatMacroLabel(name),
    isMissing: macros.isMissing(name),
  })),
)

/** Everything the printer offers that this card is not already showing. */
const available = computed(() =>
  macros.discovered
    .filter((name) => !selected.value.includes(name))
    .map((name) => ({ name, label: formatMacroLabel(name) })),
)

function add(name: string): void {
  if (selected.value.includes(name)) return
  updateConfig({ macros: [...selected.value, name] })
}

function remove(name: string): void {
  updateConfig({ macros: selected.value.filter((entry) => entry !== name) })
}
</script>

<template>
  <p class="surface-section__subtitle">{{ t('dashboard.macros.selectedTitle') }}</p>
  <ul v-if="selectedButtons.length > 0" class="macro-picker__selected mt-2 grid gap-1">
    <li v-for="macro in selectedButtons" :key="macro.name" class="macro-row">
      <span class="macro-row__name text-mono-name">{{ macro.label }}</span>
      <!--
        A macro this printer no longer defines keeps its row and says so, rather
        than being dropped silently: the row is the only place the user can find
        out why a button on the card stopped working.
      -->
      <span v-if="macro.isMissing" class="shrink-0 text-[0.68rem] font-bold text-muted">
        {{ t('dashboard.macros.missingShort') }}
      </span>
      <button
        type="button"
        class="button button--quiet button--xs button--icon"
        :title="t('dashboard.macros.remove', { macro: macro.label })"
        :aria-label="t('dashboard.macros.remove', { macro: macro.label })"
        @click="remove(macro.name)"
      >
        <AppIcon name="close" class="size-4" aria-hidden="true" />
      </button>
    </li>
  </ul>
  <p v-else class="mt-2 text-xs text-muted">{{ t('dashboard.extruder.macrosNoneSelected') }}</p>

  <div class="macro-picker__rule"></div>

  <p class="surface-section__subtitle">{{ t('dashboard.macros.availableTitle') }}</p>
  <ul v-if="available.length > 0" class="macro-picker__available mt-2 grid gap-1">
    <li v-for="macro in available" :key="macro.name" class="macro-row">
      <span class="macro-row__name text-mono-name">{{ macro.label }}</span>
      <button
        type="button"
        class="button button--quiet button--xs button--icon"
        :title="t('dashboard.macros.add', { macro: macro.label })"
        :aria-label="t('dashboard.macros.add', { macro: macro.label })"
        @click="add(macro.name)"
      >
        <AppIcon name="add" class="size-4" aria-hidden="true" />
      </button>
    </li>
  </ul>
  <p v-else class="mt-2 text-xs text-muted">
    {{
      macros.discovered.length === 0
        ? t('dashboard.macros.noneReported')
        : t('dashboard.extruder.macrosAllSelected')
    }}
  </p>
</template>
