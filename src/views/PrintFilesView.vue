<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import FileDropOverlay from '@/components/FileDropOverlay.vue'
import MaintenanceReminderDialog from '@/components/MaintenanceReminderDialog.vue'
import PageHeading from '@/components/PageHeading.vue'
import PrintFileRow from '@/components/printFiles/PrintFileRow.vue'
import PrintQueuePanel from '@/components/printFiles/PrintQueuePanel.vue'
import { gcodeDisplayName, largestThumbnailPath, moonrakerThumbnailUrl } from '@/services/moonraker'
import { useAvailability } from '@/composables/useAvailability'
import { useDashboardViewport } from '@/composables/useDashboardViewport'
import { useExternalFileDrop } from '@/composables/useExternalFileDrop'
import { filamentFitStatus, filamentTemperatureMismatch } from '@/dashboard/printReadiness'
import { revealDashboardCard } from '@/dashboard/reveal'
import { formatHistoryDuration, formatHistoryFilament } from '@/features/history/format'
import { createTimeFormatter } from '@/i18n/formats'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useGcodeFilesStore, type GcodeFileEntry, type GcodeSortKey } from '@/stores/gcodeFiles'
import { useJobQueueStore } from '@/stores/jobQueue'
import { useMaintenanceStore } from '@/stores/maintenance'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { useSpoolStore } from '@/stores/spool'

const { locale, t } = useI18n({ useScope: 'global' })
const gcodeFiles = useGcodeFilesStore()
const printer = usePrinterStore()
const jobQueue = useJobQueueStore()
const spool = useSpoolStore()
const moonraker = useMoonrakerStore()
const confirmations = useConfirmationsStore()
const maintenance = useMaintenanceStore()
const dashboardLayout = useDashboardLayoutStore()
const router = useRouter()
const { viewport: dashboardViewport } = useDashboardViewport()
const { availability: moonrakerAvailability } = useAvailability('moonraker')

const uploadInput = ref<HTMLInputElement | null>(null)

/*
 * "Today" and "Yesterday" move at midnight, so the group labels read a clock
 * that ticks once a minute rather than the time the page happened to render.
 */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  gcodeFiles.start()
  // The printer store validates a start request against its own listing, so it
  // has to know about a file before this page can ask for it to be printed.
  void printer.refreshFiles()
  clock = setInterval(() => (now.value = Date.now()), 60_000)
})

onBeforeUnmount(() => {
  gcodeFiles.stop()
  clearInterval(clock)
})

const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)
const oneDecimal = numberFormatter
const twoDecimals = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }),
)
const weightFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)
const temperatureFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)

/** Follows the 12- or 24-hour choice in Settings, which a bare `Intl` formatter would not. */
const timeFormatter = computed(() => createTimeFormatter(locale.value))
const hourCycle = computed(() => timeFormatter.value.resolvedOptions().hourCycle)
const dayFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { weekday: 'short', day: 'numeric', month: 'short' }),
)
const dayInYearFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', year: 'numeric' }),
)
const monthFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { month: 'long' }))
const monthInYearFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }),
)
const momentFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      ...(hourCycle.value ? { hourCycle: hourCycle.value } : {}),
    }),
)

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return t('units.emptySize')
  if (bytes < 1024) return t('units.size.bytes', { value: numberFormatter.value.format(bytes) })
  if (bytes < 1024 * 1024)
    return t('units.size.kilobytes', { value: numberFormatter.value.format(bytes / 1024) })
  if (bytes < 1024 * 1024 * 1024)
    return t('units.size.megabytes', {
      value: numberFormatter.value.format(bytes / (1024 * 1024)),
    })
  return t('units.size.gigabytes', {
    value: numberFormatter.value.format(bytes / (1024 * 1024 * 1024)),
  })
}

function formatTemperature(celsius: number): string {
  return t('printFiles.metadata.celsius', { value: temperatureFormatter.value.format(celsius) })
}

function millimetres(value: number): string {
  return t('printFiles.metadata.millimetres', { value: twoDecimals.value.format(value) })
}

function formatMoment(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return t('printFiles.unknownValue')
  return momentFormatter.value.format(seconds * 1000)
}

/** The secondary half of a fact, "· 8.8 g", in the muted span beside its value. */
function withSeparator(value: string): string {
  return t('printFiles.detail.aside', { value })
}

function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function shortDate(milliseconds: number): string {
  return new Date(milliseconds).getFullYear() === new Date(now.value).getFullYear()
    ? dayFormatter.value.format(milliseconds)
    : dayInYearFormatter.value.format(milliseconds)
}

function folderMeta(modified: number): string {
  return t('machine.updates.detailJoin', {
    first: t('printFiles.folder'),
    second: shortDate(modified * 1000),
  })
}

const sortKeys: GcodeSortKey[] = ['modified', 'name', 'size']

const sortLabels: Record<GcodeSortKey, string> = {
  name: 'printFiles.columns.name',
  size: 'printFiles.columns.size',
  modified: 'printFiles.columns.modified',
}

/**
 * Sorted by date, files sit under when they were sliced — today, yesterday,
 * earlier this month, then each month — so a row only needs its time or its
 * day. Sorted by name or size there are no groups, and the row's line leads
 * with whichever value the list is ordered by.
 */
const fileGroups = computed(() => {
  const files = gcodeFiles.visibleFiles
  if (gcodeFiles.sortKey !== 'modified') {
    return [
      {
        key: 'all',
        label: null,
        files: files.map((file) => ({
          file,
          lead:
            gcodeFiles.sortKey === 'size' ? formatSize(file.size) : shortDate(file.modified * 1000),
        })),
      },
    ]
  }

  const today = startOfDay(now.value)
  const yesterday = today - 86_400_000
  const current = new Date(now.value)
  const groups: {
    key: string
    label: string | null
    files: { file: GcodeFileEntry; lead: string }[]
  }[] = []
  for (const file of files) {
    const moment = file.modified * 1000
    const day = startOfDay(moment)
    const date = new Date(moment)
    const sameMonth =
      date.getFullYear() === current.getFullYear() && date.getMonth() === current.getMonth()
    const key =
      day === today
        ? 'today'
        : day === yesterday
          ? 'yesterday'
          : `${date.getFullYear()}-${date.getMonth()}`
    let group = groups.at(-1)
    if (!group || group.key !== key) {
      const label =
        key === 'today'
          ? t('history.jobs.today')
          : key === 'yesterday'
            ? t('history.jobs.yesterday')
            : sameMonth
              ? t('printFiles.groups.earlierThisMonth')
              : date.getFullYear() === current.getFullYear()
                ? monthFormatter.value.format(moment)
                : monthInYearFormatter.value.format(moment)
      group = { key, label, files: [] }
      groups.push(group)
    }
    group.files.push({
      file,
      lead:
        key === 'today' || key === 'yesterday'
          ? timeFormatter.value.format(moment)
          : dayFormatter.value.format(moment),
    })
  }
  return groups
})

const noMatches = computed(
  () =>
    gcodeFiles.query.trim() !== '' &&
    gcodeFiles.visibleFiles.length === 0 &&
    gcodeFiles.visibleFolders.length === 0,
)

/** "123 files · 93 GB free": the folder's size and the room left for more. */
const summary = computed(() =>
  t('machine.updates.detailJoin', {
    first: t('printFiles.fileCount', { count: gcodeFiles.files.length }),
    second: t('units.storageFree', { value: formatSize(gcodeFiles.diskUsage.free) }),
  }),
)

function thumbnailUrl(path: string, relativePath: string | null): string | null {
  if (!relativePath) return null
  try {
    return moonrakerThumbnailUrl(path, relativePath, moonraker.endpoint)
  } catch {
    return null
  }
}

/** The largest embedded preview, because the open row has room for it. */
const largeThumbnailUrl = computed(() => {
  const file = gcodeFiles.selectedFile
  if (!file) return null
  return thumbnailUrl(file.path, largestThumbnailPath(gcodeFiles.selectedMetadata?.thumbnails))
})

/**
 * The open file's facts: the full metadata once it has arrived, the listing's
 * own copy until then, so the row's figures never blank while it opens.
 */
const selectedDetails = computed(() => {
  const metadata = gcodeFiles.selectedMetadata
  const listed = gcodeFiles.selectedFile?.details
  const materialType = metadata?.filament_type ?? listed?.filamentType ?? null
  const bed = metadata?.first_layer_bed_temp
  const chamber = metadata?.chamber_temp
  const temperatureNote = [
    bed ? t('printFiles.detail.bed', { value: formatTemperature(bed) }) : null,
    chamber ? t('printFiles.detail.chamber', { value: formatTemperature(chamber) }) : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(t('printFiles.detail.listSeparator'))
  return {
    estimatedTime: metadata?.estimated_time ?? listed?.estimatedTime ?? null,
    filamentLength: metadata?.filament_total ?? null,
    filamentWeight: metadata?.filament_weight_total ?? listed?.filamentWeight ?? null,
    material: materialType,
    materialName: metadata?.filament_name ?? null,
    layerHeight: metadata?.layer_height ?? null,
    objectHeight: metadata?.object_height ?? null,
    extruderTemp: metadata?.first_layer_extr_temp ?? null,
    temperatureNote: temperatureNote || null,
    slicer: metadata?.slicer
      ? [metadata.slicer, metadata.slicer_version].filter(Boolean).join(' ')
      : null,
    nozzle: metadata?.nozzle_diameter ?? null,
  }
})

const lastPrintedAt = computed(
  () =>
    gcodeFiles.selectedLastPrint?.startedAt ??
    gcodeFiles.selectedFile?.details.lastPrintedAt ??
    null,
)

/**
 * Whether the active Spoolman spool has enough left for the open file — the
 * same check `printReadiness.ts` gives Spool, asked here about whichever file
 * is being looked at rather than whatever is queued or printing.
 */
const fitStatus = computed(() =>
  filamentFitStatus(
    gcodeFiles.selectedMetadata?.filament_weight_total,
    spool.activeSpool?.remaining_weight,
  ),
)

/**
 * Whether the loaded filament's own recommended temperature disagrees with
 * what this file's first layer asks Klipper to heat to — the surest sign the
 * wrong material is loaded for the wrong slice.
 */
const temperatureMismatch = computed(() =>
  filamentTemperatureMismatch(
    spool.activeSpool?.filament.settings_extruder_temp,
    gcodeFiles.selectedMetadata?.first_layer_extr_temp,
  ),
)

const canPrint = computed(
  () =>
    moonrakerAvailability.value.isAvailable &&
    !printer.hasActivePrint &&
    !printer.pendingCommands.startPrint,
)

/**
 * Queuing behind a running job is the entire point of the queue, so — unlike
 * printing — this stays enabled while a print is active. `server.job_queue`
 * is a Moonraker feature, not a Klipper one: it accepts jobs whether or not
 * anything is currently printing.
 */
const canQueue = computed(
  () => moonrakerAvailability.value.isAvailable && !jobQueue.pendingCommands.add,
)

const isMaintenanceReminderOpen = ref(false)
const pendingStartPath = ref<string | null>(null)
const overdueMaintenanceNames = computed(() =>
  maintenance.overdueRows.map((row) => row.interval.name),
)

async function startPrint(path: string): Promise<void> {
  if (confirmations.shouldShowMaintenanceReminder() && maintenance.hasOverdue) {
    pendingStartPath.value = path
    isMaintenanceReminderOpen.value = true
    return
  }
  await printer.startPrint(path)
}

/** Starting anyway quiets the reminder until tomorrow — see confirmations.ts. */
async function confirmStartAnyway(): Promise<void> {
  isMaintenanceReminderOpen.value = false
  confirmations.suppressMaintenanceReminderUntilTomorrow()
  const path = pendingStartPath.value
  pendingStartPath.value = null
  if (path) await printer.startPrint(path)
}

function dismissMaintenanceReminder(): void {
  isMaintenanceReminderOpen.value = false
  pendingStartPath.value = null
  confirmations.snoozeMaintenanceReminder()
}

/**
 * Does not start the print. Navigates to the dashboard and reveals the
 * Maintenance card the same way Print's own header action does — expanding
 * it if collapsed, then scrolling once its module has actually mounted.
 * `nextTick` alone is not enough here: unlike the header action, which
 * reveals a card already on screen, this is jumping to a page that has not
 * rendered yet, and its module loads through the same async boundary
 * `pages.ts` gives every route.
 */
async function openMaintenanceFromReminder(): Promise<void> {
  isMaintenanceReminderOpen.value = false
  pendingStartPath.value = null
  const viewport = dashboardViewport.value
  const instance = dashboardLayout
    .itemsFor(viewport)
    .find((item) => item.instance.moduleId === 'maintenance')
  if (instance) dashboardLayout.setCollapsed(viewport, instance.instance.instanceId, false)
  await router.push({ name: 'overview' })
  await nextTick()
  await nextTick()
  if (instance) revealDashboardCard(instance.instance.instanceId)
}

/**
 * The queue card beside the list shows the job arrive, but on a phone it is
 * above the list and out of view, so the control still confirms on itself for
 * a second — see `button-system.md`'s cooldown state.
 *
 * It is raised from `addJob`'s own answer rather than from having called it.
 * The command reports a refusal by returning `false` instead of throwing, so
 * `await`ing it and then assuming success is exactly how a control ends up
 * reading "Added to queue" over a request Moonraker declined.
 */
const queueConfirmed = ref(false)

async function queueFile(path: string): Promise<void> {
  queueConfirmed.value = await jobQueue.addJob(path)
}

function openUploadPicker(): void {
  uploadInput.value?.click()
}

/** Shared by the picker and the drag-and-drop zone below; the last file uploaded is opened. */
async function uploadFiles(files: File[]): Promise<void> {
  let uploadedPath: string | null = null
  for (const file of files) {
    uploadedPath = await gcodeFiles.upload(file)
  }
  // Keep the printer's own listing in step, or the file just uploaded cannot be
  // started until something else refreshes it.
  await printer.refreshFiles()
  if (uploadedPath) await gcodeFiles.select(uploadedPath.replace(/^gcodes\//i, ''))
}

async function onUploadChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await uploadFiles([file])
}

const {
  isActive: isFileDropActive,
  onDragEnter: onFileDragEnter,
  onDragOver: onFileDragOver,
  onDragLeave: onFileDragLeave,
  onDrop: onFileDrop,
} = useExternalFileDrop({
  canDrop: () => moonrakerAvailability.value.isAvailable && !gcodeFiles.isUploading,
  onDrop: uploadFiles,
})
</script>

<template>
  <section class="standard-page print-files-view">
    <PageHeading :title="t('printFiles.title')" />

    <AvailabilityRegion requires="moonraker">
      <div class="print-files-grid">
        <section
          class="machine-status-panel machine-list-panel print-files-panel relative"
          aria-labelledby="print-files-heading"
          :data-pending="gcodeFiles.isLoading || gcodeFiles.isUploading ? 'true' : undefined"
          @dragenter="onFileDragEnter"
          @dragover="onFileDragOver"
          @dragleave="onFileDragLeave"
          @drop="onFileDrop"
        >
          <header class="machine-panel-heading">
            <AppIcon name="folder" class="size-5 text-action" aria-hidden="true" />
            <!--
              The folder trail is the card's own title rather than a band of
              its own: a band that appears only inside a subfolder would move
              every row beneath it as the reader navigates.
            -->
            <h2 id="print-files-heading" class="print-files-trail">
              <template v-if="gcodeFiles.breadcrumbs.length > 0">
                <button type="button" class="text-action" @click="gcodeFiles.navigateTo('')">
                  {{ t('printFiles.root') }}
                </button>
                <template v-for="(crumb, index) in gcodeFiles.breadcrumbs" :key="crumb.path">
                  <span class="print-files-trail__separator" aria-hidden="true">/</span>
                  <button
                    v-if="index < gcodeFiles.breadcrumbs.length - 1"
                    type="button"
                    class="text-action"
                    @click="gcodeFiles.navigateTo(crumb.path)"
                  >
                    {{ crumb.name }}
                  </button>
                  <span v-else aria-current="location">{{ crumb.name }}</span>
                </template>
              </template>
              <template v-else>{{ t('printFiles.root') }}</template>
            </h2>
            <div class="machine-panel-heading__actions">
              <AppButton
                size="sm"
                icon-only
                icon="refresh"
                :disabled="!moonrakerAvailability.isAvailable"
                :aria-label="t('printFiles.actions.refresh')"
                :title="t('printFiles.actions.refresh')"
                @click="gcodeFiles.refreshDirectory"
              />
              <AppButton
                size="sm"
                :pending="gcodeFiles.isUploading"
                icon="fileUpload"
                :label="t('printFiles.actions.upload')"
                :disabled="!moonrakerAvailability.isAvailable"
                @click="openUploadPicker"
              />
              <input
                ref="uploadInput"
                type="file"
                class="sr-only"
                accept=".gcode,.g,.gco,.ufp,.nc"
                :aria-label="t('printFiles.actions.upload')"
                @change="onUploadChosen"
              />
            </div>
          </header>

          <div class="machine-panel-summary print-files-summary">
            <p>{{ summary }}</p>
            <label class="field field--sm field--on-soft machine-search">
              <AppIcon name="fileSearch" class="size-4" aria-hidden="true" />
              <span class="sr-only">{{ t('printFiles.search') }}</span>
              <input
                v-model="gcodeFiles.query"
                type="search"
                :placeholder="t('printFiles.search')"
                autocomplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
              />
            </label>
            <div class="segmented" role="group" :aria-label="t('printFiles.sortBy')">
              <AppButton
                v-for="key in sortKeys"
                :key="key"
                size="sm"
                :label="t(sortLabels[key])"
                :aria-pressed="gcodeFiles.sortKey === key"
                @click="gcodeFiles.sortBy(key)"
              >
                <AppIcon
                  v-if="gcodeFiles.sortKey === key"
                  :name="gcodeFiles.sortDirection === 'ascending' ? 'up' : 'down'"
                  class="size-4"
                  aria-hidden="true"
                />
              </AppButton>
            </div>
          </div>

          <div class="machine-list machine-list--media">
            <div
              v-for="folder in gcodeFiles.visibleFolders"
              :key="folder.path"
              class="print-folder machine-row"
            >
              <button
                type="button"
                class="file-select machine-row__toggle"
                @click="gcodeFiles.navigateTo(folder.path)"
              >
                <span class="machine-row__thumb machine-row__thumb--folder" aria-hidden="true">
                  <AppIcon name="folder" class="size-5" />
                </span>
                <span class="machine-row__detail">
                  <span class="machine-row__name machine-row__name--identifier">
                    {{ folder.name }}
                  </span>
                  <span class="machine-row__meta">{{ folderMeta(folder.modified) }}</span>
                </span>
              </button>
            </div>

            <template v-for="group in fileGroups" :key="group.key">
              <p v-if="group.label" class="machine-list__label">{{ group.label }}</p>
              <template v-for="entry in group.files" :key="entry.file.path">
                <PrintFileRow
                  :file="entry.file"
                  :open="entry.file.path === gcodeFiles.selectedPath"
                  :thumbnail-url="thumbnailUrl(entry.file.path, entry.file.details.thumbnail)"
                  :lead="entry.lead"
                  :can-print="canPrint"
                  :can-queue="canQueue"
                  @toggle="gcodeFiles.toggle(entry.file.path)"
                  @print="startPrint(entry.file.path)"
                  @queue="queueFile(entry.file.path)"
                />
                <div
                  v-if="entry.file.path === gcodeFiles.selectedPath"
                  id="print-file-details"
                  class="machine-row-expansion"
                >
                  <img
                    v-if="largeThumbnailUrl"
                    :src="largeThumbnailUrl"
                    :alt="
                      t('printFiles.metadata.thumbnailAlt', {
                        name: gcodeDisplayName(entry.file.name),
                      })
                    "
                  />
                  <span v-else class="machine-row-expansion__placeholder" aria-hidden="true"></span>
                  <dl class="machine-row-facts selectable">
                    <div v-if="selectedDetails.estimatedTime">
                      <dt>{{ t('printFiles.detail.printTime') }}</dt>
                      <dd>
                        {{ formatHistoryDuration(selectedDetails.estimatedTime, t) }}
                        <span>{{ withSeparator(t('printFiles.detail.slicerEstimate')) }}</span>
                      </dd>
                    </div>
                    <div v-if="selectedDetails.filamentLength">
                      <dt>{{ t('printFiles.metadata.filament') }}</dt>
                      <dd>
                        {{ formatHistoryFilament(selectedDetails.filamentLength, t, locale) }}
                        <span v-if="selectedDetails.filamentWeight">{{
                          withSeparator(
                            t('history.jobs.detail.weight', {
                              value: oneDecimal.format(selectedDetails.filamentWeight),
                            }),
                          )
                        }}</span>
                      </dd>
                    </div>
                    <div v-if="selectedDetails.material">
                      <dt>{{ t('history.jobs.detail.material') }}</dt>
                      <dd>
                        {{ selectedDetails.material }}
                        <span v-if="selectedDetails.materialName">{{
                          withSeparator(selectedDetails.materialName)
                        }}</span>
                      </dd>
                    </div>
                    <div v-if="selectedDetails.layerHeight">
                      <dt>{{ t('history.jobs.detail.layers') }}</dt>
                      <dd>
                        {{ millimetres(selectedDetails.layerHeight) }}
                        <span v-if="selectedDetails.objectHeight">{{
                          withSeparator(
                            t('history.jobs.detail.objectHeight', {
                              value: twoDecimals.format(selectedDetails.objectHeight),
                            }),
                          )
                        }}</span>
                      </dd>
                    </div>
                    <div v-if="selectedDetails.extruderTemp">
                      <dt>{{ t('printFiles.detail.temperatures') }}</dt>
                      <dd>
                        {{ formatTemperature(selectedDetails.extruderTemp) }}
                        <span v-if="selectedDetails.temperatureNote">{{
                          withSeparator(selectedDetails.temperatureNote)
                        }}</span>
                      </dd>
                    </div>
                    <div v-if="selectedDetails.slicer">
                      <dt>{{ t('printFiles.metadata.slicer') }}</dt>
                      <dd>
                        {{ selectedDetails.slicer }}
                        <span v-if="selectedDetails.nozzle">{{
                          withSeparator(
                            t('printFiles.detail.nozzle', {
                              value: twoDecimals.format(selectedDetails.nozzle),
                            }),
                          )
                        }}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>{{ t('printFiles.detail.file') }}</dt>
                      <dd>
                        {{ formatSize(entry.file.size) }}
                        <span>{{ withSeparator(formatMoment(entry.file.modified)) }}</span>
                      </dd>
                    </div>
                    <div v-if="lastPrintedAt">
                      <dt>{{ t('printFiles.detail.lastPrinted') }}</dt>
                      <dd>
                        {{ formatMoment(lastPrintedAt) }}
                        <span v-if="gcodeFiles.selectedLastPrint">{{
                          withSeparator(
                            t(`printFiles.detail.outcome.${gcodeFiles.selectedLastPrint.outcome}`),
                          )
                        }}</span>
                      </dd>
                    </div>
                  </dl>

                  <p
                    v-if="gcodeFiles.isMetadataLoading"
                    class="machine-row-expansion__note"
                    role="status"
                    aria-live="polite"
                  >
                    {{ t('printFiles.metadata.loading') }}
                  </p>
                  <p
                    v-else-if="gcodeFiles.selectedMetadata === null"
                    class="machine-row-expansion__note"
                    role="status"
                  >
                    {{ t('printFiles.metadata.none') }}
                  </p>
                  <!--
                    Quiet unless something is actually wrong — a spool that fits,
                    or a filament whose recommended temperature agrees with the
                    file, says nothing at all. `printReadiness.ts` is the same
                    check Spool's own card asks about whatever is queued or
                    printing, so the two can never disagree about one file.
                  -->
                  <p
                    v-if="fitStatus === 'short'"
                    class="machine-row-expansion__note flex items-center gap-1.5 text-alert-inline"
                  >
                    <AppIcon name="warning" class="size-3.5 shrink-0" aria-hidden="true" />
                    {{
                      t('dashboard.spool.short', {
                        needed: weightFormatter.format(
                          gcodeFiles.selectedMetadata?.filament_weight_total ?? 0,
                        ),
                        remaining: weightFormatter.format(spool.activeSpool?.remaining_weight ?? 0),
                        unit: t('dashboard.weightUnit'),
                      })
                    }}
                  </p>
                  <p
                    v-if="temperatureMismatch"
                    class="machine-row-expansion__note flex items-center gap-1.5 text-alert-inline"
                  >
                    <AppIcon name="warning" class="size-3.5 shrink-0" aria-hidden="true" />
                    {{
                      t('printFiles.metadata.temperatureMismatch', {
                        filament: formatTemperature(temperatureMismatch.filamentExtruderTemp),
                        file: formatTemperature(temperatureMismatch.fileExtruderTemp),
                      })
                    }}
                  </p>
                  <p v-if="printer.hasActivePrint" class="machine-row-expansion__note">
                    {{ t('printFiles.printBusy') }}
                  </p>
                  <p
                    v-if="gcodeFiles.processEstimateFailed"
                    class="machine-row-expansion__note"
                    role="alert"
                  >
                    {{ t('dashboard.commandFailed') }}
                  </p>

                  <div class="machine-row-actions">
                    <AppButton
                      variant="primary"
                      size="sm"
                      :pending="printer.pendingCommands.startPrint"
                      icon="print"
                      class="print-file__start"
                      :label="t('printFiles.actions.print')"
                      :disabled="!canPrint"
                      @click="startPrint(entry.file.path)"
                    />
                    <AppButton
                      size="sm"
                      :pending="jobQueue.pendingCommands.add"
                      icon="jobs"
                      class="print-file__enqueue"
                      :label="t('printFiles.actions.addToQueue')"
                      :disabled="!canQueue"
                      :cooldown="queueConfirmed"
                      :cooldown-ms="1000"
                      :cooldown-label="t('printFiles.actions.addedToQueue')"
                      cooldown-icon="check"
                      @cooldown-end="queueConfirmed = false"
                      @click="queueFile(entry.file.path)"
                    />
                    <!--
                      `[analysis]` is optional and re-running it is never
                      destructive: Moonraker reports `bypassed: true` and
                      changes nothing on a file already processed. Offered
                      whenever the estimator itself is ready, whether or not
                      this file carries slicer metadata — a hand-written file
                      has none to correct until this runs once.
                    -->
                    <AppButton
                      v-if="gcodeFiles.isAnalysisReady"
                      variant="quiet"
                      size="sm"
                      :pending="gcodeFiles.isProcessingEstimate"
                      icon="refresh"
                      :label="t('printFiles.actions.getAccurateEstimate')"
                      :disabled="gcodeFiles.isProcessingEstimate"
                      @click="gcodeFiles.processEstimate(entry.file.path)"
                    />
                  </div>
                </div>
              </template>
            </template>
          </div>

          <p v-if="gcodeFiles.failed" class="print-files-note" role="status">
            {{ t('printFiles.loadFailed') }}
          </p>
          <p
            v-else-if="gcodeFiles.isEmpty && !gcodeFiles.isLoading"
            class="print-files-note"
            role="status"
          >
            {{ t('printFiles.empty') }}
          </p>
          <p v-else-if="noMatches" class="print-files-note" role="status">
            {{ t('printFiles.noMatches') }}
          </p>

          <FileDropOverlay v-if="isFileDropActive" :message="t('printFiles.dropHint')" />
        </section>

        <PrintQueuePanel />
      </div>
    </AvailabilityRegion>

    <MaintenanceReminderDialog
      :open="isMaintenanceReminderOpen"
      :overdue-names="overdueMaintenanceNames"
      @start-anyway="confirmStartAnyway"
      @not-now="dismissMaintenanceReminder"
      @open-maintenance="openMaintenanceFromReminder"
    />
  </section>
</template>
