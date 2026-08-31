<script setup lang="ts">
/**
 * One printer's printable files, without leaving the rail.
 *
 * `dialog-system.md`'s Shape 4 — a searchable picker over a result set — with
 * the one deviation that shape allows for and this case needs: picking a row is
 * not the whole decision here, because there are two things to do with a file.
 * Queueing it is the ordinary one and is the row's own action; printing it now
 * is offered only on a machine with nothing loaded, and says which printer it
 * is about to start.
 *
 * The filter is client-side, unlike the filament catalogue's debounced search:
 * one printer's gcodes root is tens or hundreds of entries, already in hand
 * after a single request, so a round trip per keystroke would buy nothing.
 */
import { computed, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { createDateTimeFormatter } from '@/i18n/formats'
import type { MoonrakerFileInfo } from '@/services/moonraker'
import { useFarmStore } from '@/stores/farm'

const props = defineProps<{
  open: boolean
  printerId: string
  printerLabel: string
  /** Printing or paused: a machine with a job loaded cannot start another. */
  busy: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const { locale, t } = useI18n({ useScope: 'global' })
const farm = useFarmStore()

const dialog = ref<HTMLDialogElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const titleId = useId()

const query = ref('')
const files = ref<MoonrakerFileInfo[]>([])
const isLoading = ref(false)
/** The printer could not answer at all — a different state from "no files". */
const failed = ref(false)
const startingPath = ref<string | null>(null)

const startGuard = useActionGuard({ tier: 'terminal', emphasis: 'primary', key: 'farmStartPrint' })

const dateFormatter = computed(() => createDateTimeFormatter(locale.value))

const matches = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (needle === '') return files.value
  return files.value.filter((file) => file.path.toLowerCase().includes(needle))
})

async function load(): Promise<void> {
  isLoading.value = true
  failed.value = false
  const result = await farm.listFiles(props.printerId)
  isLoading.value = false
  if (result === null) {
    failed.value = true
    files.value = []
    return
  }
  files.value = result
}

/**
 * Opened from both a prop change and from mounting already-open.
 *
 * The column renders this behind a `v-if`, so a rail of twenty printers holds
 * no dialogs rather than twenty closed ones — which means the first `open` a
 * watcher could see has already happened by the time the element exists. A
 * watcher alone left the element in the document, titled and empty, never
 * calling `showModal`.
 */
function sync(open: boolean): void {
  if (!open) {
    dialog.value?.close()
    return
  }
  query.value = ''
  startingPath.value = null
  void load()
  if (!dialog.value?.open) dialog.value?.showModal()
  // After the browser has given the dialog focus, so this does not fight it.
  requestAnimationFrame(() => input.value?.focus())
}

onMounted(() => sync(props.open))
watch(() => props.open, sync)

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const megabytes = bytes / (1024 * 1024)
  if (megabytes >= 1) return t('farm.files.megabytes', { value: megabytes.toFixed(1) })
  return t('farm.files.kilobytes', { value: Math.max(1, Math.round(bytes / 1024)) })
}

async function queue(path: string): Promise<void> {
  const queued = await farm.queueFile(props.printerId, path)
  // Closing on success is the answer to "did that work"; a failure keeps the
  // dialog open behind its own toast so the file is still there to retry.
  if (queued) emit('close')
}

function requestStart(path: string): void {
  startGuard.request(
    () => void start(path),
    () => (startingPath.value = path),
  )
}

async function start(path: string): Promise<void> {
  startingPath.value = null
  const started = await farm.startPrint(props.printerId, path)
  if (started) emit('close')
}
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog farm-files"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('close')"
    @close="emit('close')"
  >
    <header class="farm-files__head">
      <h2 :id="titleId" class="text-dialog-title">
        {{ t('farm.files.title', { printer: printerLabel }) }}
      </h2>
      <!--
        The close control is the same one every dialog header carries: square,
        neutral, glyph only. Passing `label` as well as `icon-only` put the word
        *and* the glyph inside a forced-square button — `icon-only` sets the
        shape, it does not suppress a label — so the name goes on `aria-label`,
        where the two Shape 4 dialogs before it put theirs.
      -->
      <AppButton
        icon-only
        icon="close"
        :aria-label="t('farm.files.close')"
        @click="emit('close')"
      />
    </header>

    <label class="sr-only" :for="`${titleId}-search`">{{ t('farm.files.search') }}</label>
    <div class="farm-files__search">
      <AppIcon name="fileSearch" class="size-4 shrink-0" aria-hidden="true" />
      <input
        :id="`${titleId}-search`"
        ref="input"
        v-model="query"
        class="field field--sm field--block"
        type="search"
        autocomplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        :placeholder="t('farm.files.search')"
      />
    </div>

    <p v-if="isLoading" class="farm-files__note" role="status">{{ t('farm.files.loading') }}</p>
    <p v-else-if="failed" class="farm-files__note" role="status">
      {{ t('farm.files.unreachable', { printer: printerLabel }) }}
    </p>
    <p v-else-if="files.length === 0" class="farm-files__note" role="status">
      {{ t('farm.files.empty') }}
    </p>
    <p v-else-if="matches.length === 0" class="farm-files__note" role="status">
      {{ t('farm.files.noMatch') }}
    </p>

    <ul v-else class="farm-files__list">
      <li v-for="file in matches" :key="file.path">
        <span class="farm-files__name" :title="file.path">{{ file.path }}</span>
        <span class="farm-files__meta">
          {{ formatSize(file.size) }} · {{ dateFormatter.format(file.modified * 1000) }}
        </span>
        <span class="farm-files__actions">
          <AppButton
            size="xs"
            :label="t('farm.files.queue')"
            :disabled="farm.isPending(printerId, 'queueFile')"
            @click="queue(file.path)"
          />
          <AppButton
            v-if="!busy"
            size="xs"
            :guard="startGuard"
            :label="t('farm.files.printNow')"
            :disabled="farm.isPending(printerId, 'startPrint')"
            @click="requestStart(file.path)"
          />
        </span>
      </li>
    </ul>
  </dialog>

  <ConfirmDialog
    :open="startingPath !== null"
    :title="t('farm.files.confirmStart.title', { printer: printerLabel })"
    :description="t('farm.files.confirmStart.description', { file: startingPath ?? '' })"
    :confirm-label="t('farm.files.confirmStart.confirm')"
    @confirm="start(startingPath ?? '')"
    @cancel="startingPath = null"
  />
</template>
