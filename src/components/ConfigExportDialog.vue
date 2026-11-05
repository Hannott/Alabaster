<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppProgressBar from '@/components/AppProgressBar.vue'
import type { ConfigExportProgress, ConfigExportScope } from '@/stores/machineFiles'

/*
 * A documented multi-choice dialog per docs/design/dialog-system.md, and the
 * reference instance of its progress phase (Shape 9). "Download as ZIP" has
 * two useful outcomes, not one: the whole config root, or only the `.cfg`
 * and `.conf` files Klipper and Moonraker read, which on a printer that keeps
 * resonance plots beside its configuration is the difference between many
 * megabytes and a few kilobytes.
 *
 * Two phases, one dialog, in the opposite order from `UploadedFileDialog`:
 * the choice first, then the work it starts. The export lists the root and
 * reads every file through the printer's HTTP, one request each, which is
 * long enough on a Pi that a click answered with nothing read as a dead
 * button. The frame does not move between the phases: the two download
 * actions stay where they are, disabled, with the chosen one carrying the
 * shared pending treatment, and the body keeps its rows whether or not the
 * current phase fills them.
 *
 * The bar draws only while there is a total to draw it from. The listing has
 * none yet, so that phase is words, per the rule `UploadedFileDialog` set:
 * progress is reported or it is not, and a bar pinned at zero reads as a
 * stall rather than as an absence of measurement.
 *
 * Cancel is enabled in both phases and means something different in each:
 * before a choice it closes the dialog, and during the export it stops the
 * export — the store abandons the read in flight and delivers nothing.
 */
const props = defineProps<{
  open: boolean
  /** Null while the choice is still open; the store's state once an export runs. */
  progress: ConfigExportProgress | null
}>()

const emit = defineEmits<{ export: [scope: ConfigExportScope]; cancel: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)

const exporting = computed(() => props.progress !== null)

const status = computed(() => {
  switch (props.progress?.phase) {
    case 'listing':
      return t('configuration.exportDialog.listing')
    case 'reading':
      return t('configuration.exportDialog.reading', {
        current: props.progress.read + 1,
        total: props.progress.total,
      })
    case 'packing':
      return t('configuration.exportDialog.packing')
    case 'handoff':
      return t('configuration.exportDialog.handoff')
    default:
      return ''
  }
})

const currentPath = computed(() => (props.progress?.phase === 'reading' ? props.progress.path : ''))

/** 0-100, or null before the listing has given the bar a total. */
const percent = computed(() => {
  const progress = props.progress
  if (!progress || progress.phase === 'listing') return null
  if (progress.phase !== 'reading') return 100
  return progress.total === 0 ? 100 : (progress.read / progress.total) * 100
})

function sync(isOpen: boolean): void {
  const element = dialog.value
  if (!element) return
  if (isOpen && !element.open) element.showModal()
  if (!isOpen && element.open) element.close()
}

// Mounting already open is a real calling convention — see ConfirmDialog.
onMounted(() => sync(props.open))
watch(() => props.open, sync, { flush: 'post' })

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog config-export-dialog"
    aria-labelledby="config-export-title"
    aria-describedby="config-export-description"
    @cancel.prevent="emit('cancel')"
  >
    <h2 id="config-export-title" class="text-dialog-title">
      {{ t('configuration.exportDialog.title') }}
    </h2>
    <p id="config-export-description" class="mt-2 text-sm leading-6 text-muted">
      {{ t('configuration.exportDialog.description') }}
    </p>

    <div class="config-export-dialog__body">
      <p class="config-export-dialog__status" aria-live="polite">{{ status }}</p>
      <p class="config-export-dialog__path">{{ currentPath }}</p>
      <div class="config-export-dialog__progress">
        <AppProgressBar
          v-if="percent !== null"
          :value="percent"
          :label="t('configuration.exportDialog.progress')"
        />
      </div>
    </div>

    <div class="config-export-dialog__actions">
      <AppButton
        variant="primary"
        block
        icon="download"
        :label="t('configuration.exportDialog.all')"
        :disabled="exporting"
        :pending="progress?.scope === 'all'"
        @click="emit('export', 'all')"
      />
      <AppButton
        block
        icon="download"
        :label="t('configuration.exportDialog.configOnly')"
        :disabled="exporting"
        :pending="progress?.scope === 'config'"
        @click="emit('export', 'config')"
      />
      <AppButton variant="quiet" block :label="t('dashboard.cancel')" @click="emit('cancel')" />
    </div>
  </dialog>
</template>
