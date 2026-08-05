<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'

/**
 * Picks one icon from a small, local, fixed catalogue — dialog-system.md's
 * Shape 4 (`FilamentCatalogueDialog`) minus the search box: that shape's
 * debounce and three empty states exist for a live, potentially-large
 * *remote* result set, and this one is neither. What carries over unchanged
 * is the behaviour that made Shape 4 right for this in the first place:
 * clicking a tile *is* the decision, so there is no confirm/cancel action
 * track, and the only way to leave without picking is Escape or the close
 * button.
 *
 * Every tile is an ordinary `button--icon` — button-system.md's own
 * `[aria-pressed='true']` rule already draws the inset accent ring "Selected"
 * needs, so there is no bespoke tile-selected class to invent or keep in
 * step with that system.
 *
 * Generic over any small `AppIconName` catalogue rather than specific to
 * Outputs — `ControlsSettingsPane.vue` is the first caller, passing its own
 * curated `outputIconTokens`, but nothing here names Outputs or a Klipper
 * pin.
 */

const props = defineProps<{
  open: boolean
  /** Names the decision, composed by the caller — e.g. "Choose an icon — Interior Light". */
  title: string
  options: { name: AppIconName; label: string }[]
  selected: AppIconName | null
  /** Adds a leading "None" tile — Outputs' pins want this, its fans never do. */
  allowNone?: boolean
}>()

const emit = defineEmits<{ select: [value: AppIconName | null]; cancel: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)
const noneTile = ref<HTMLButtonElement | null>(null)
const tiles = ref<(HTMLButtonElement | null)[]>([])
const titleId = useId()

function pick(name: AppIconName | null): void {
  emit('select', name)
}

/**
 * Focus lands on the currently-selected tile, not the first one — reopening
 * the picker for a row that already has an icon should let Tab/arrow keys
 * move on from where the user already is, not from an unrelated default.
 */
watch(
  () => props.open,
  async (isOpen) => {
    const element = dialog.value
    if (!element) return
    if (isOpen && !element.open) {
      element.showModal()
      await nextTick()
      if (props.selected === null) {
        noneTile.value?.focus()
      } else {
        const selectedIndex = props.options.findIndex((option) => option.name === props.selected)
        tiles.value[selectedIndex >= 0 ? selectedIndex : 0]?.focus()
      }
    }
    if (!isOpen && element.open) element.close()
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog icon-picker-dialog"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('cancel')"
  >
    <header class="icon-picker-dialog__header">
      <h2 :id="titleId" class="text-dialog-title">{{ title }}</h2>
      <button
        type="button"
        class="button button--icon"
        :aria-label="t('iconPicker.close')"
        @click="emit('cancel')"
      >
        <AppIcon name="close" class="size-5" aria-hidden="true" />
      </button>
    </header>

    <div class="icon-picker-dialog__grid">
      <button
        v-if="allowNone"
        ref="noneTile"
        type="button"
        class="button button--icon"
        :aria-pressed="selected === null"
        :title="t('iconPicker.none')"
        :aria-label="t('iconPicker.none')"
        @click="pick(null)"
      >
        <span class="icon-none-mark size-5" aria-hidden="true">–</span>
      </button>
      <button
        v-for="(option, index) in options"
        :key="option.name"
        :ref="(el) => (tiles[index] = el as HTMLButtonElement | null)"
        type="button"
        class="button button--icon"
        :aria-pressed="option.name === selected"
        :title="option.label"
        :aria-label="option.label"
        @click="pick(option.name)"
      >
        <AppIcon :name="option.name" class="size-5" aria-hidden="true" />
      </button>
    </div>
  </dialog>
</template>
