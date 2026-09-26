<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppSelect from '@/components/AppSelect.vue'
import type { OptionCatalogueSection, QuickConfigPin } from '@/features/config/quickConfigFields'

/**
 * Chooses and orders the options on one Quick config card — `dialog-system.md`'s
 * Shape 8. First the section, then every option it has as a tile: a
 * highlighted tile is on the card, and the order of the highlighted tiles is
 * the order of the card's fields.
 *
 * Reordering is native HTML5 drag, the mechanism Configuration and Macros'
 * settings pane already use, with the DOM left still for the whole drag and
 * the order computed once on drop — see `MacrosSettingsPane`'s note on why a
 * live-reordering list breaks a native drag. A tile is only draggable while
 * its grip is held, so clicking the tile itself stays a toggle and the grab
 * cursor is only on the part that drags. Alt+Up and Alt+Down move the focused
 * tile, matching the column the tiles sit in, which is the keyboard path a
 * `draggable` element does not reliably offer.
 */

const props = defineProps<{
  open: boolean
  catalogue: readonly OptionCatalogueSection[]
  pins: readonly QuickConfigPin[]
  /** The section to start on, when opened from a card. */
  initialSection: string | null
}>()
const emit = defineEmits<{ save: [section: string, options: string[]]; cancel: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()

const section = ref('')
const tiles = ref<string[]>([])
const selected = ref(new Set<string>())
const draggingTile = ref<string | null>(null)
const dropTargetTile = ref<string | null>(null)
const armedTile = ref<string | null>(null)
const tileElements = new Map<string, HTMLElement>()

const sectionOptions = computed(() => [
  { value: '', label: t('configuration.quickConfig.picker.chooseSection') },
  ...props.catalogue.map((entry) => ({ value: entry.key, label: `[${entry.section}]` })),
])

const current = computed(() => props.catalogue.find((entry) => entry.key === section.value))

const values = computed(() => {
  const map = new Map<string, string>()
  for (const option of current.value?.options ?? []) {
    if (option.value === null) continue
    map.set(
      option.option,
      option.isDefault
        ? t('configuration.quickConfig.picker.defaultValue', { value: option.value })
        : option.value,
    )
  }
  return map
})

/*
 * The card's current options first, in their order, then the rest by name. A
 * pinned option the catalogue leaves out — one spanning lines, or one this
 * firmware does not read — still gets a tile, so saving never drops a pin
 * the user did not touch.
 */
function loadSection(key: string): void {
  const pinned = props.pins.filter((pin) => pin.section === key).map((pin) => pin.option)
  const rest = (props.catalogue.find((entry) => entry.key === key)?.options ?? [])
    .map((option) => option.option)
    .filter((option) => !pinned.includes(option))
  tiles.value = [...pinned, ...rest]
  selected.value = new Set(pinned)
}

watch(section, loadSection)

function toggle(option: string): void {
  const next = new Set(selected.value)
  if (next.has(option)) next.delete(option)
  else next.add(option)
  selected.value = next
}

function move(option: string, to: number): void {
  const order = [...tiles.value]
  const from = order.indexOf(option)
  if (from < 0 || to < 0 || to >= order.length || from === to) return
  order.splice(from, 1)
  order.splice(to, 0, option)
  tiles.value = order
}

function onKeydown(option: string, event: KeyboardEvent): void {
  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
  event.preventDefault()
  move(option, tiles.value.indexOf(option) + (event.key === 'ArrowUp' ? -1 : 1))
  requestAnimationFrame(() => tileElements.get(option)?.focus())
}

function onDragStart(option: string, event: DragEvent): void {
  draggingTile.value = option
  dropTargetTile.value = null
  event.dataTransfer?.setData('text/plain', option)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(option: string, event: DragEvent): void {
  if (!draggingTile.value || draggingTile.value === option) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTargetTile.value = option
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  const dragged = draggingTile.value
  const target = dropTargetTile.value
  if (dragged && target) move(dragged, tiles.value.indexOf(target))
  onDragEnd()
}

function onDragEnd(): void {
  draggingTile.value = null
  dropTargetTile.value = null
  armedTile.value = null
}

function arm(option: string): void {
  armedTile.value = option
  window.addEventListener('pointerup', disarm, { once: true })
}

/* Released without dragging: the tile goes back to being a plain toggle. */
function disarm(): void {
  if (!draggingTile.value) armedTile.value = null
}

function setTileElement(option: string, element: unknown): void {
  const node = (element as { $el?: unknown } | null)?.$el ?? element
  if (node instanceof HTMLElement) tileElements.set(option, node)
  else tileElements.delete(option)
}

function save(): void {
  if (section.value === '') return
  emit(
    'save',
    section.value,
    tiles.value.filter((option) => selected.value.has(option)),
  )
}

watch(
  () => props.open,
  (isOpen) => {
    const element = dialog.value
    if (!element) return
    if (isOpen && !element.open) {
      section.value = props.initialSection ?? ''
      loadSection(section.value)
      element.showModal()
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
    class="confirm-dialog quick-config-picker"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('cancel')"
  >
    <header class="quick-config-picker__header">
      <h2 :id="titleId" class="text-dialog-title">
        {{ t('configuration.quickConfig.picker.title') }}
      </h2>
      <div class="quick-config-picker__section">
        <AppSelect
          v-model="section"
          :options="sectionOptions"
          :label="t('configuration.quickConfig.picker.section')"
        />
      </div>
    </header>

    <!-- The list holds its height with or without a section, so choosing one does not resize the dialog. -->
    <p class="quick-config-picker__note">
      {{
        catalogue.length === 0
          ? t('configuration.quickConfig.picker.unavailable')
          : t('configuration.quickConfig.picker.hint')
      }}
    </p>
    <ul class="quick-config-picker__tiles">
      <li v-for="option in tiles" :key="option">
        <AppButton
          :ref="(element) => setTileElement(option, element)"
          size="sm"
          start
          block
          class="quick-config-tile"
          :class="{
            'quick-config-tile--dragging': draggingTile === option,
            'quick-config-tile--drop-target': dropTargetTile === option,
          }"
          :aria-pressed="selected.has(option)"
          :draggable="armedTile === option ? 'true' : 'false'"
          @click="toggle(option)"
          @keydown="onKeydown(option, $event)"
          @dragstart="onDragStart(option, $event)"
          @dragover="onDragOver(option, $event)"
          @drop="onDrop($event)"
          @dragend="onDragEnd"
        >
          <span
            class="quick-config-tile__grip"
            aria-hidden="true"
            @pointerdown="arm(option)"
            @click.stop
          >
            <AppIcon name="drag" class="size-4" />
          </span>
          <span class="quick-config-tile__name">{{ option }}</span>
          <span v-if="values.get(option)" class="quick-config-tile__value">{{
            values.get(option)
          }}</span>
        </AppButton>
      </li>
    </ul>

    <div class="confirm-dialog__actions">
      <AppButton
        variant="primary"
        :label="t('configuration.quickConfig.picker.save')"
        :disabled="section === ''"
        @click="save"
      />
      <AppButton size="sm" :label="t('dashboard.cancel')" @click="emit('cancel')" />
    </div>
  </dialog>
</template>
