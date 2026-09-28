<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'

/**
 * One document tab in the Configuration viewer. The tab itself is a
 * `file-select` composing `selection-row` — choosing which file is on screen is
 * picking content out of a list, the job both patterns already do. Its pin and
 * close controls sit in space the tab reserves at its end, the way Visual
 * Studio lays them out, positioned over that space rather than in flow because
 * a `<button>` cannot nest inside the tab's own `<button>`.
 */
const props = defineProps<{
  name: string
  path: string
  root: string
  active: boolean
  preview?: boolean | undefined
  dirty?: boolean | undefined
  pinned?: boolean | undefined
  /** Whether this tab holds the tab list's one stop in the Tab order. */
  focusable?: boolean | undefined
  disabled?: boolean | undefined
}>()

const emit = defineEmits<{
  activate: []
  keep: []
  close: []
  pin: []
  unpin: []
  menu: [event: MouseEvent]
}>()

const { t } = useI18n({ useScope: 'global' })

/*
 * Truncated in the middle rather than at the end, the way Visual Studio does
 * it: the end of a config file's name is its extension and usually the word
 * that tells two siblings apart (`KAMP_Settings.cfg`, `KAMP_Line_Purge.cfg`),
 * so that is the part worth keeping when the tab runs out of room.
 */
const TAIL_LENGTH = 8
const head = computed(() =>
  props.name.length > TAIL_LENGTH + 4 ? props.name.slice(0, -TAIL_LENGTH) : props.name,
)
const tail = computed(() =>
  props.name.length > TAIL_LENGTH + 4 ? props.name.slice(-TAIL_LENGTH) : '',
)
const pinLabel = computed(() =>
  t(props.pinned ? 'configuration.files.unpin' : 'configuration.tabs.pin', { name: props.name }),
)
const closeLabel = computed(() => t('configuration.tabs.close', { name: props.name }))

// Without this a middle press starts the browser's autoscroll on Windows.
function onMouseDown(event: MouseEvent): void {
  if (event.button === 1) event.preventDefault()
}

function onAuxClick(event: MouseEvent): void {
  if (event.button !== 1) return
  event.preventDefault()
  emit('close')
}

function onPin(): void {
  if (props.pinned) emit('unpin')
  else emit('pin')
}
</script>

<template>
  <div
    class="document-tab"
    :class="{
      'document-tab--dirty': dirty,
      'document-tab--active': active,
      'document-tab--pinned': pinned,
    }"
  >
    <button
      type="button"
      role="tab"
      class="file-select selection-row document-tab__select"
      :class="{
        'selection-row--selected': active,
        'document-tab__select--preview': preview,
      }"
      :aria-selected="active"
      :aria-current="active ? 'true' : undefined"
      :tabindex="focusable ? 0 : -1"
      :data-tab-path="path"
      :title="`/${root}/${path}`"
      :disabled="disabled"
      @click="emit('activate')"
      @dblclick="emit('keep')"
      @mousedown="onMouseDown"
      @auxclick="onAuxClick"
      @contextmenu.prevent="emit('menu', $event)"
    >
      <span class="document-tab__name"
        ><span class="document-tab__head">{{ head }}</span
        ><span v-if="tail" class="document-tab__tail">{{ tail }}</span></span
      >
      <span v-if="dirty" class="sr-only">{{ t('configuration.editor.unsaved') }}</span>
      <span v-if="preview" class="sr-only">{{ t('configuration.tabs.preview') }}</span>
      <span v-if="dirty" class="document-tab__dirty-dot" aria-hidden="true"></span>
    </button>
    <!--
      Out of the Tab order: the tab list is one stop, Delete closes the focused
      tab from the keyboard, and the context menu offers both actions.
    -->
    <span class="document-tab__controls">
      <AppButton
        variant="quiet"
        size="xs"
        icon-only
        :icon="pinned ? 'filePinSlash' : 'filePin'"
        class="document-tab__control document-tab__control--pin"
        tabindex="-1"
        :aria-label="pinLabel"
        :title="pinLabel"
        @click="onPin"
      />
      <AppButton
        variant="quiet"
        size="xs"
        icon-only
        icon="close"
        class="document-tab__control document-tab__control--close"
        tabindex="-1"
        :aria-label="closeLabel"
        :title="closeLabel"
        @click="emit('close')"
      />
    </span>
  </div>
</template>
