<script setup lang="ts">
/**
 * One printer's printable files and its queue, without leaving the wall.
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
 *
 * **The second tab is where the queue's job list lives.** The farm card reduced
 * the queue to a count, because a scrolling list of filenames inside a card is
 * the one thing on a camera-first wall that cannot justify its height — but
 * seeing what a machine prints next, and dropping it, is exactly what somebody
 * standing at a wall of printers does. It is here rather than on the Job queue
 * destination for the same reason the files are: going there would switch the
 * live connection and lose the wall. The tab appears only where Moonraker has a
 * `job_queue` answer for this printer, so capability removes it and preference
 * never does.
 */
import { computed, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import type { FarmQueue } from '@/farm/types'
import { createDateTimeFormatter } from '@/i18n/formats'
import type { MoonrakerFileInfo } from '@/services/moonraker'
import { useFarmStore } from '@/stores/farm'

const props = defineProps<{
  open: boolean
  printerId: string
  printerLabel: string
  /** Printing or paused: a machine with a job loaded cannot start another. */
  busy: boolean
  /** Null where Moonraker has no `job_queue` answer for this printer. */
  queue: FarmQueue | null
}>()

const emit = defineEmits<{ close: [] }>()

const { locale, t } = useI18n({ useScope: 'global' })
const farm = useFarmStore()

const dialog = ref<HTMLDialogElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const titleId = useId()

const tab = ref<'files' | 'queue'>('files')
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
  tab.value = 'files'
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

/**
 * Named for the act rather than for the noun: `queue` is this component's
 * *prop* — the printer's queue — and a function of the same name shadowed it in
 * the template, where every `queue ?` test then read a function that is always
 * defined and so always true. The queue tab rendered for a machine that has no
 * queue at all.
 */
async function addToQueue(path: string): Promise<void> {
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

const queueJobs = computed(() => props.queue?.jobs ?? [])
/**
 * An empty queue that Moonraker reports as `paused` is not a held line — an
 * idle printer answers exactly that with nothing wrong — so the held state is
 * only stated where something is actually being held back.
 */
const queueHeld = computed(() => props.queue?.state === 'paused' && queueJobs.value.length > 0)
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
        {{
          queue
            ? t('farm.files.titleQueue', { printer: printerLabel })
            : t('farm.files.title', { printer: printerLabel })
        }}
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

    <!--
      A `tab-select` pair, not buttons: `button-system.md` lists it as one of
      the four patterns that are deliberately not `AppButton`, and this is the
      same shape Configuration's file roots use.
    -->
    <div v-if="queue" class="farm-files__tabs" role="group" :aria-label="t('farm.files.tabs')">
      <button
        type="button"
        class="tab-select"
        :aria-pressed="tab === 'files'"
        @click="tab = 'files'"
      >
        {{ t('farm.files.filesTab') }}
      </button>
      <button
        type="button"
        class="tab-select"
        :aria-pressed="tab === 'queue'"
        @click="tab = 'queue'"
      >
        {{ t('farm.queueJobs', { count: queueJobs.length }) }}
      </button>
    </div>

    <template v-if="tab === 'queue' && queue">
      <p class="farm-files__note" role="status">
        {{ queueHeld ? t('farm.files.queueHeldNote') : t('farm.files.queueRunningNote') }}
      </p>

      <ol v-if="queueJobs.length > 0" class="farm-files__list farm-files__queue">
        <li v-for="(job, index) in queueJobs" :key="job.jobId">
          <span class="farm-files__position" aria-hidden="true">{{ index + 1 }}</span>
          <span class="farm-files__name" :title="job.filename">{{ job.filename }}</span>
        </li>
      </ol>
      <p v-else class="farm-files__note">{{ t('farm.queueEmpty') }}</p>

      <div class="farm-files__queue-actions">
        <AppButton
          size="sm"
          :label="queueHeld ? t('farm.startQueue') : t('farm.holdQueue')"
          :disabled="farm.isPending(printerId, 'queue')"
          :pending="farm.isPending(printerId, 'queue')"
          @click="queueHeld ? farm.startQueue(printerId) : farm.holdQueue(printerId)"
        />
        <AppButton
          size="sm"
          variant="danger-quiet"
          :label="t('farm.removeNext')"
          :disabled="queueJobs.length === 0 || farm.isPending(printerId, 'removeNext')"
          :pending="farm.isPending(printerId, 'removeNext')"
          @click="farm.removeNextJob(printerId)"
        />
      </div>
    </template>

    <template v-else>
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
              @click="addToQueue(file.path)"
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
    </template>
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
