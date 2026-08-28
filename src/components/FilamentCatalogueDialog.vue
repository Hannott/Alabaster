<script setup lang="ts">
import { onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import type { SpoolmanExternalFilament } from '@/services/moonraker'
import { useSpoolStore } from '@/stores/spool'

/**
 * Browses Spoolman's own cached copy of SpoolmanDB (thousands of filaments)
 * and picks one. None of `dialog-system.md`'s three existing shapes fit this:
 * it is not a yes/no decision, not a single typed value, and not a fixed
 * small set of actions — it is a live search over a result set too large to
 * show at once. Selecting a row *is* the decision, so there is no separate
 * confirm step; only Escape or the close button leaves without picking one.
 */

const emit = defineEmits<{
  select: [filament: { name: string; extruder: number | null; bed: number | null }]
  cancel: []
}>()

const props = defineProps<{ open: boolean }>()

const { t } = useI18n({ useScope: 'global' })
const spool = useSpoolStore()
const dialog = ref<HTMLDialogElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const titleId = useId()

const query = ref('')
const results = ref<SpoolmanExternalFilament[]>([])
const isLoading = ref(false)
const failed = ref(false)

/** The debounce searches, not this — searching every keystroke's own query is one round trip too many. */
let searchGeneration = 0
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function resetSearch(): void {
  searchGeneration += 1
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  query.value = ''
  results.value = []
  isLoading.value = false
  failed.value = false
}

/**
 * A network round trip per keystroke would hammer Spoolman for no benefit —
 * 300ms is longer than `gcodeFiles.ts`'s 120ms directory-refresh debounce
 * because this one leaves the browser entirely, through Moonraker, to
 * Spoolman's own cached catalogue.
 */
watch(query, (value) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  const trimmed = value.trim()
  if (trimmed === '') {
    searchGeneration += 1
    results.value = []
    isLoading.value = false
    failed.value = false
    return
  }
  debounceTimer = setTimeout(() => void runSearch(trimmed), 300)
})

/** Guards against a slow early response overwriting a newer one, the same shape `printer.loadMetadata`'s callers already guard with a generation counter. */
async function runSearch(value: string): Promise<void> {
  const generation = ++searchGeneration
  isLoading.value = true
  const { filaments, failed: didFail } = await spool.searchExternalFilaments(value)
  if (generation !== searchGeneration) return
  results.value = filaments
  failed.value = didFail
  isLoading.value = false
}

function pick(entry: SpoolmanExternalFilament): void {
  emit('select', {
    name: `${entry.manufacturer} ${entry.name}`,
    extruder: entry.extruder_temp ?? null,
    bed: entry.bed_temp ?? null,
  })
}

function swatchColor(entry: SpoolmanExternalFilament): string | null {
  const hex = entry.color_hex ?? entry.color_hexes?.[0]
  return hex ? `#${hex.replace(/^#/, '')}` : null
}

/**
 * A native dialog gives modal focus trapping, Escape handling, and the top
 * layer without a bespoke focus manager, matching every other dialog. The
 * search resets on open, same as `PromptDialog` reseeds its field — a stale
 * result from the last time this dialog was open must not greet the user.
 */
watch(
  () => props.open,
  async (isOpen) => {
    const element = dialog.value
    if (!element) return
    if (isOpen && !element.open) {
      resetSearch()
      element.showModal()
      input.value?.focus()
    }
    if (!isOpen && element.open) element.close()
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog filament-catalogue-dialog"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('cancel')"
  >
    <header class="filament-catalogue-dialog__header">
      <h2 :id="titleId" class="text-dialog-title">{{ t('filamentCatalogue.title') }}</h2>
      <AppButton
        icon-only
        icon="close"
        :aria-label="t('filamentCatalogue.close')"
        @click="emit('cancel')"
      />
    </header>

    <label class="sr-only" for="filament-catalogue-search">{{
      t('filamentCatalogue.searchLabel')
    }}</label>
    <input
      id="filament-catalogue-search"
      ref="input"
      v-model="query"
      type="search"
      class="field field--sm field--block mt-3"
      :placeholder="t('filamentCatalogue.searchLabel')"
      autocomplete="off"
      data-1p-ignore
      data-lpignore="true"
      data-bwignore
    />

    <p v-if="query.trim() === ''" class="filament-catalogue-dialog__note">
      {{ t('filamentCatalogue.noQuery') }}
    </p>
    <p v-else-if="isLoading" class="filament-catalogue-dialog__note">
      {{ t('filamentCatalogue.loading') }}
    </p>
    <p v-else-if="failed" class="filament-catalogue-dialog__note text-alert-inline">
      {{ t('filamentCatalogue.failed') }}
    </p>
    <p v-else-if="results.length === 0" class="filament-catalogue-dialog__note">
      {{ t('filamentCatalogue.noResults') }}
    </p>
    <ul v-else class="filament-catalogue-dialog__list">
      <li v-for="entry in results" :key="entry.id">
        <AppButton
          variant="quiet"
          start
          block
          class="filament-catalogue-dialog__row"
          :aria-label="
            t('filamentCatalogue.selectAria', { filament: `${entry.manufacturer} ${entry.name}` })
          "
          @click="pick(entry)"
        >
          <span
            v-if="swatchColor(entry)"
            class="filament-chip__swatch"
            :style="{ background: swatchColor(entry) ?? undefined }"
            aria-hidden="true"
          ></span>
          <span class="filament-catalogue-dialog__name">
            {{ entry.manufacturer }} {{ entry.name }}
            <span class="filament-chip__type">{{ entry.material }}</span>
          </span>
          <span v-if="entry.extruder_temp" class="filament-catalogue-dialog__temp">
            {{ t('filamentCatalogue.celsius', { value: entry.extruder_temp }) }}
          </span>
          <span v-if="entry.bed_temp" class="filament-catalogue-dialog__temp">
            {{ t('filamentCatalogue.celsius', { value: entry.bed_temp }) }}
          </span>
        </AppButton>
      </li>
    </ul>
  </dialog>
</template>
