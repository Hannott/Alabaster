<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppProgressBar from '@/components/AppProgressBar.vue'

/*
 * A documented multi-choice dialog per docs/design/dialog-system.md: a file
 * that has just finished uploading has two useful destinations, not one, and
 * "print it" versus "queue it" are separate outcomes rather than a yes and a
 * no. Hand-built markup on the shared `<dialog>` shell, like the three
 * multi-choice dialogs before it.
 *
 * It replaces the ordinary "Start this print?" confirmation for an upload
 * rather than stacking on top of it — the affirmative button here is already
 * the deliberate second act that confirmation exists to require, and asking
 * twice for one decision is what `PrintModule`'s upload handler has avoided
 * since it was written.
 *
 * Two phases, one dialog. It opens the moment the transfer starts, because
 * the transfer is the part with a duration: a sliced file is tens of
 * megabytes, and a card that showed nothing until it landed left the reader
 * with a Upload button that had apparently done nothing. The choice is the
 * second phase, and it is the same box — the file being asked about does not
 * change, so neither does the frame around it.
 *
 * Cancel is present in both phases and means something different in each,
 * which is why it is never disabled: during the transfer it aborts it, and
 * after it leaves the file on the printer. The second one is the accurate
 * outcome rather than a gap — the upload has already happened by then, and
 * this dialog asks what the file is for, not whether to keep it.
 */
const props = defineProps<{
  open: boolean
  fileName: string
  /** True while the bytes are still going out and there is nothing to act on. */
  uploading: boolean
  /** 0-100, or null for a transfer the browser will not size. */
  progress: number | null
  /** The formatted percentage beside the bar, or null alongside a null `progress`. */
  progressLabel: string | null
  /** False while a job is loaded: the queue accepts the file, Klipper will not. */
  canStart: boolean
  startPending: boolean
  queuePending: boolean
}>()

const emit = defineEmits<{ start: []; queue: []; cancel: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    const element = dialog.value
    if (!element) return
    if (isOpen && !element.open) element.showModal()
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
    class="confirm-dialog uploaded-file-dialog"
    aria-labelledby="uploaded-file-title"
    @cancel.prevent="emit('cancel')"
  >
    <h2 id="uploaded-file-title" class="text-dialog-title">
      {{ uploading ? t('dashboard.print.uploadingTitle') : t('dashboard.print.uploadedTitle') }}
    </h2>

    <div class="uploaded-file-dialog__body">
      <p class="uploaded-file-dialog__name">{{ fileName }}</p>
      <!--
        The bar only appears once there is a measurement to draw. A transfer
        whose total the browser will not commit to says so in words instead of
        rendering a bar stuck at zero, which reads as a stall.
      -->
      <div v-if="uploading" class="uploaded-file-dialog__progress">
        <template v-if="progress !== null">
          <AppProgressBar :value="progress" :label="t('dashboard.print.uploadProgress')" />
          <p class="uploaded-file-dialog__percent">{{ progressLabel }}</p>
        </template>
        <p v-else class="uploaded-file-dialog__percent">
          {{ t('dashboard.print.uploadProgress') }}
        </p>
      </div>
    </div>

    <div class="uploaded-file-dialog__actions">
      <AppButton
        variant="primary"
        block
        icon="play"
        :label="t('dashboard.print.start')"
        :disabled="uploading || !canStart"
        :pending="startPending"
        @click="emit('start')"
      />
      <AppButton
        block
        icon="jobs"
        :label="t('printFiles.actions.addToQueue')"
        :disabled="uploading"
        :pending="queuePending"
        @click="emit('queue')"
      />
      <AppButton variant="quiet" block :label="t('dashboard.cancel')" @click="emit('cancel')" />
    </div>
  </dialog>
</template>
