<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import type { MachineUpdateOutputLine } from '@/stores/machineSystem'

/*
 * The second content-preview instance of `dialog-system.md`'s Shape 3
 * (`ImageLightbox`'s pattern): there is nothing to decide here, only a
 * transcript to watch, so `[x]`, `Escape`, and a click on the backdrop all
 * close it, per the doc's own invitation to reuse this shape for "a log" —
 * except while `running` is true. A run in progress is not a passive preview
 * the reader can dismiss and lose track of: dismissing it is how a stalled
 * or failed update goes unnoticed, so all three close paths are gated on
 * `running` through `requestClose()` and the `[x]` disables itself to match,
 * the same way `Clear` already does.
 *
 * It replaces the Machine page's old inline transcript panel. That panel
 * animated each arriving line in and capped itself to ten rows, which read
 * as a dashboard widget rather than the plain, wide, scroll-to-the-bottom
 * window a `git`/`apt` transcript actually wants — this dialog drops the
 * per-line animation and gives the transcript the room a popout affords.
 */
const props = defineProps<{
  open: boolean
  lines: readonly MachineUpdateOutputLine[]
  running: boolean
}>()

const emit = defineEmits<{ close: []; clear: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)
const consoleBox = ref<HTMLElement | null>(null)

/** How close to the following edge still counts as "still reading the end." */
const followThresholdPx = 24
const isFollowing = ref(true)

function scrollToNewest(): void {
  const element = consoleBox.value
  if (element) element.scrollTop = element.scrollHeight
}

/*
 * Following is only what the reader is doing while already at the bottom;
 * scrolling back to read an earlier failure must not be undone by the next
 * line the update prints.
 */
function trackScroll(): void {
  const element = consoleBox.value
  if (!element) return
  const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
  isFollowing.value = distanceFromBottom <= followThresholdPx
}

watch(
  () => props.lines.length,
  async () => {
    if (!isFollowing.value) return
    await nextTick()
    scrollToNewest()
  },
)

watch(
  () => props.open,
  async (isOpen) => {
    const element = dialog.value
    if (element) {
      if (isOpen && !element.open) element.showModal()
      if (!isOpen && element.open) element.close()
    }
    // A freshly opened dialog always shows the newest line, regardless of
    // where a previous session of reading it left the scroll position.
    if (!isOpen) return
    isFollowing.value = true
    await nextTick()
    scrollToNewest()
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})

/** A run in progress must not be dismissed and lose track of — see above. */
function requestClose(): void {
  if (props.running) return
  emit('close')
}

/**
 * The header and console tile the dialog's box edge to edge, so a click's
 * target can equal the `<dialog>` element itself only when it lands on the
 * true backdrop — the same trick `ImageLightbox.vue` uses for its own
 * click-outside-to-close.
 */
function handleDialogClick(event: MouseEvent): void {
  if (event.target === dialog.value) requestClose()
}
</script>

<template>
  <dialog
    ref="dialog"
    class="update-console-dialog"
    :aria-busy="running || undefined"
    @cancel.prevent="requestClose"
    @click="handleDialogClick"
  >
    <header class="update-console-dialog__header">
      <AppIcon name="workUpdate" class="size-5 text-action" aria-hidden="true" />
      <span class="update-console-dialog__title truncate">{{ t('machine.output.title') }}</span>
      <span class="update-console-state" :data-running="running">
        {{ running ? t('machine.output.running') : t('machine.output.finished') }}
      </span>
      <div class="update-console-dialog__actions">
        <button
          type="button"
          class="button button--quiet button--sm"
          :disabled="running || lines.length === 0"
          @click="emit('clear')"
        >
          <AppIcon name="trash" class="size-4" aria-hidden="true" />
          {{ t('machine.output.clear') }}
        </button>
        <button
          type="button"
          class="button button--icon"
          :aria-label="t('machine.output.close')"
          :disabled="running"
          @click="requestClose"
        >
          <AppIcon name="close" class="size-5" aria-hidden="true" />
        </button>
      </div>
    </header>
    <!--
      A log, not a console: nothing is typed into it, so it takes `tabindex`
      for keyboard scrolling and `role="log"` for the live region rather than
      an input. Text stays selectable — a transcript is content to copy out
      of, not clickable chrome.
    -->
    <ol
      ref="consoleBox"
      class="update-console selectable"
      role="log"
      tabindex="0"
      :aria-label="t('machine.output.consoleLabel')"
      @scroll="trackScroll"
    >
      <li v-if="lines.length === 0" class="update-console__empty">
        {{ t('machine.output.empty') }}
      </li>
      <li v-for="line in lines" :key="line.id">{{ line.message }}</li>
    </ol>
  </dialog>
</template>
