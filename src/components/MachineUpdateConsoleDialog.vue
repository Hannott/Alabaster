<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppStatusField, { type AppStatusFieldTone } from '@/components/AppStatusField.vue'
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
  /** Whether the run this transcript reports on ended in `updateFailed`/`updateInterrupted`. */
  failed: boolean
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

/**
 * Drives both the header text and its colour, per the "not by color alone"
 * rule: `running` is always reachable mid-run, `failed` only once the run
 * that just ended reported `updateFailed`/`updateInterrupted`, and
 * `finished` otherwise — the dialog is only ever reachable with `running`
 * false after a run has actually completed, per `openConsole`'s own
 * `outputLines.length > 0 || isUpdating` gate, so "finished" here always
 * means a real completed run rather than an idle default.
 */
const state = computed<'running' | 'failed' | 'finished'>(() => {
  if (props.running) return 'running'
  return props.failed ? 'failed' : 'finished'
})

/** `AppStatusField`'s closed tone set, not this dialog's own state vocabulary. */
const stateTones: Record<'running' | 'failed' | 'finished', AppStatusFieldTone> = {
  running: 'accent',
  finished: 'positive',
  failed: 'danger',
}

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
      <AppStatusField
        class="update-console-state"
        :text="
          state === 'running'
            ? t('machine.output.running')
            : state === 'failed'
              ? t('machine.output.failed')
              : t('machine.output.finished')
        "
        :tone="stateTones[state]"
      />
      <div class="update-console-dialog__actions">
        <AppButton
          variant="quiet"
          size="sm"
          icon="trash"
          :label="t('machine.output.clear')"
          :disabled="running || lines.length === 0"
          @click="emit('clear')"
        />
        <AppButton
          icon-only
          icon="close"
          :aria-label="t('machine.output.close')"
          :disabled="running"
          @click="requestClose"
        />
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
