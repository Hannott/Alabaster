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
import { moonrakerThumbnailUrl } from '@/services/moonraker'
import { useAvailability } from '@/composables/useAvailability'
import { useDashboardViewport } from '@/composables/useDashboardViewport'
import { useExternalFileDrop } from '@/composables/useExternalFileDrop'
import { filamentChips } from '@/dashboard/filamentMetadata'
import { fileIcon } from '@/features/machine/fileIcons'
import { filamentFitStatus, filamentTemperatureMismatch } from '@/dashboard/printReadiness'
import { revealDashboardCard } from '@/dashboard/reveal'
import { createDateTimeFormatter } from '@/i18n/formats'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useGcodeFilesStore, type GcodeSortKey } from '@/stores/gcodeFiles'
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

onMounted(() => {
  gcodeFiles.start()
  // The printer store validates a start request against its own listing, so it
  // has to know about a file before this workspace can ask for it to be printed.
  void printer.refreshFiles()
})

onBeforeUnmount(() => {
  gcodeFiles.stop()
})

const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)
const weightFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)
const temperatureFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)
const dateFormatter = computed(() => createDateTimeFormatter(locale.value))

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

function formatModified(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return t('printFiles.unknownValue')
  return dateFormatter.value.format(seconds * 1000)
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return t('printFiles.unknownValue')
  const totalMinutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0
    ? t('dashboard.duration.hoursMinutes', { hours, minutes })
    : t('dashboard.duration.minutes', { minutes })
}

function formatFilament(millimetres: number | undefined): string {
  if (millimetres === undefined || !Number.isFinite(millimetres))
    return t('printFiles.unknownValue')
  return t('printFiles.metadata.filamentValue', {
    value: numberFormatter.value.format(millimetres / 1000),
  })
}

function formatHeight(millimetres: number | undefined): string {
  if (millimetres === undefined || !Number.isFinite(millimetres))
    return t('printFiles.unknownValue')
  return t('printFiles.metadata.millimetres', {
    value: numberFormatter.value.format(millimetres),
  })
}

function formatTemperature(celsius: number | undefined): string {
  if (celsius === undefined || !Number.isFinite(celsius)) return t('printFiles.unknownValue')
  return t('printFiles.metadata.celsius', { value: temperatureFormatter.value.format(celsius) })
}

/**
 * One chip per filament the selected file uses — see `filamentMetadata.ts`
 * for why a multi-material file's `filament_type` cannot be read as a plain
 * string.
 */
const selectedFilamentChips = computed(() => filamentChips(gcodeFiles.selectedMetadata))

/**
 * Whether the active Spoolman spool has enough left for the selected file —
 * the same check `printReadiness.ts` gives Spool, asked here about whichever
 * file is being looked at rather than whatever is queued or printing.
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
 * wrong material is loaded for the wrong slice, and the check that matters
 * more here than a bed-temperature mismatch would.
 */
const temperatureMismatch = computed(() =>
  filamentTemperatureMismatch(
    spool.activeSpool?.filament.settings_extruder_temp,
    gcodeFiles.selectedMetadata?.first_layer_extr_temp,
  ),
)

/**
 * The largest thumbnail the slicer embedded, because the detail pane has room for
 * it and a 32 px preview scaled up is worse than no preview. Null whenever the
 * file carries none, which is normal for a hand-written file.
 */
const thumbnailUrl = computed(() => {
  const file = gcodeFiles.selectedFile
  const thumbnails = gcodeFiles.selectedMetadata?.thumbnails
  if (!file || !thumbnails || thumbnails.length === 0) return null
  const largest = [...thumbnails].sort((left, right) => right.width - left.width)[0]
  if (!largest) return null
  try {
    return moonrakerThumbnailUrl(file.path, largest.relative_path, moonraker.endpoint)
  } catch {
    return null
  }
})

const canPrintSelected = computed(
  () =>
    gcodeFiles.selectedFile !== null &&
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
const canQueueSelected = computed(
  () =>
    gcodeFiles.selectedFile !== null &&
    moonrakerAvailability.value.isAvailable &&
    !jobQueue.pendingCommands.add,
)

const sortLabels: Record<GcodeSortKey, string> = {
  name: 'printFiles.columns.name',
  size: 'printFiles.columns.size',
  modified: 'printFiles.columns.modified',
}

function sortAriaSort(key: GcodeSortKey): 'ascending' | 'descending' | 'none' {
  if (gcodeFiles.sortKey !== key) return 'none'
  return gcodeFiles.sortDirection
}

const isMaintenanceReminderOpen = ref(false)
const overdueMaintenanceNames = computed(() =>
  maintenance.overdueRows.map((row) => row.interval.name),
)

async function startSelectedPrint(): Promise<void> {
  const file = gcodeFiles.selectedFile
  if (!file) return
  if (confirmations.shouldShowMaintenanceReminder() && maintenance.hasOverdue) {
    isMaintenanceReminderOpen.value = true
    return
  }
  await printer.startPrint(file.path)
}

/** Starting anyway quiets the reminder until tomorrow — see confirmations.ts. */
async function confirmStartAnyway(): Promise<void> {
  isMaintenanceReminderOpen.value = false
  confirmations.suppressMaintenanceReminderUntilTomorrow()
  const file = gcodeFiles.selectedFile
  if (file) await printer.startPrint(file.path)
}

function dismissMaintenanceReminder(): void {
  isMaintenanceReminderOpen.value = false
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

async function queueSelectedPrint(): Promise<void> {
  const file = gcodeFiles.selectedFile
  if (!file) return
  await jobQueue.addJob(file.path)
}

function openUploadPicker(): void {
  uploadInput.value?.click()
}

/** Shared by the picker and the drag-and-drop zone below; the last file uploaded is selected. */
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
  <section class="workspace-page print-files-view">
    <PageHeading :title="t('printFiles.title')" />

    <AvailabilityRegion requires="moonraker" class="print-files-availability">
      <div
        class="print-files-workspace relative"
        :class="{ 'print-files-workspace--detail-open': gcodeFiles.selectedFile !== null }"
        :data-pending="gcodeFiles.isLoading || gcodeFiles.isUploading ? 'true' : undefined"
        @dragenter="onFileDragEnter"
        @dragover="onFileDragOver"
        @dragleave="onFileDragLeave"
        @drop="onFileDrop"
      >
        <aside class="print-files-browser" :aria-label="t('printFiles.title')">
          <header class="print-files-pane-header">
            <!--
              No visible title: the page-heading above already names the route,
              so a pane title here would repeat "Print files" rather than say
              anything new. The aside's own `aria-label` below carries the
              accessible name instead.
            -->
            <div>
              <p class="print-files-storage">
                {{ t('units.storageFree', { value: formatSize(gcodeFiles.diskUsage.free) }) }}
              </p>
            </div>
            <div class="print-files-pane-actions">
              <AppButton
                size="xs"
                icon-only
                icon="refresh"
                :disabled="!moonrakerAvailability.isAvailable"
                :aria-label="t('printFiles.actions.refresh')"
                :title="t('printFiles.actions.refresh')"
                @click="gcodeFiles.refreshDirectory"
              />
              <AppButton
                size="xs"
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

          <nav class="print-files-breadcrumbs" :aria-label="t('printFiles.breadcrumbs')">
            <AppButton
              variant="quiet"
              size="xs"
              icon="folder"
              :label="t('printFiles.root')"
              :disabled="gcodeFiles.currentPath === ''"
              @click="gcodeFiles.navigateTo('')"
            />
            <template v-for="crumb in gcodeFiles.breadcrumbs" :key="crumb.path">
              <span class="print-files-breadcrumbs__separator" aria-hidden="true">/</span>
              <AppButton
                variant="quiet"
                size="xs"
                :label="crumb.name"
                :disabled="crumb.path === gcodeFiles.currentPath"
                @click="gcodeFiles.navigateTo(crumb.path)"
              />
            </template>
          </nav>

          <div class="print-files-columns" role="row">
            <button
              v-for="key in ['name', 'size', 'modified'] as GcodeSortKey[]"
              :key="key"
              type="button"
              class="print-files-column text-action"
              :class="`print-files-column--${key}`"
              :aria-sort="sortAriaSort(key)"
              @click="gcodeFiles.sortBy(key)"
            >
              {{ t(sortLabels[key]) }}
              <AppIcon
                v-if="gcodeFiles.sortKey === key"
                :name="gcodeFiles.sortDirection === 'ascending' ? 'up' : 'down'"
                class="size-3"
                aria-hidden="true"
              />
            </button>
          </div>

          <ul class="print-files-rows">
            <li v-if="gcodeFiles.parentPath !== null">
              <button
                type="button"
                class="file-select print-files-row"
                @click="gcodeFiles.navigateUp()"
              >
                <AppIcon name="folderUp" class="size-4 shrink-0 text-muted" aria-hidden="true" />
                <span class="print-files-row__name">{{ t('printFiles.parentFolder') }}</span>
              </button>
            </li>
            <li v-for="folder in gcodeFiles.sortedFolders" :key="folder.path">
              <button
                type="button"
                class="file-select print-files-row"
                @click="gcodeFiles.navigateTo(folder.path)"
              >
                <AppIcon name="folder" class="size-4 shrink-0 text-accent" aria-hidden="true" />
                <span class="print-files-row__name">{{ folder.name }}</span>
                <span class="print-files-row__size" aria-hidden="true"></span>
                <span class="print-files-row__modified">{{ formatModified(folder.modified) }}</span>
              </button>
            </li>
            <li v-for="file in gcodeFiles.sortedFiles" :key="file.path">
              <button
                type="button"
                class="file-select print-files-row"
                :class="{ 'print-files-row--selected': file.path === gcodeFiles.selectedPath }"
                :aria-current="file.path === gcodeFiles.selectedPath ? 'true' : undefined"
                @click="gcodeFiles.select(file.path)"
              >
                <AppIcon
                  :name="fileIcon(file.name)"
                  class="size-4 shrink-0 text-muted"
                  aria-hidden="true"
                />
                <span class="print-files-row__name">{{ file.name }}</span>
                <span class="print-files-row__size">{{ formatSize(file.size) }}</span>
                <span class="print-files-row__modified">{{ formatModified(file.modified) }}</span>
              </button>
            </li>
          </ul>

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
        </aside>

        <section
          v-if="gcodeFiles.selectedFile"
          class="print-files-detail"
          :aria-label="gcodeFiles.selectedFile.name"
        >
          <header class="print-files-detail__header">
            <h2 class="min-w-0 break-words text-dialog-title">
              {{ gcodeFiles.selectedFile.name }}
            </h2>
            <AppButton
              variant="quiet"
              size="xs"
              icon-only
              icon="close"
              :aria-label="t('printFiles.actions.closeDetail')"
              :title="t('printFiles.actions.closeDetail')"
              @click="gcodeFiles.clearSelection()"
            />
          </header>

          <img
            v-if="thumbnailUrl"
            :src="thumbnailUrl"
            :alt="t('printFiles.metadata.thumbnailAlt', { name: gcodeFiles.selectedFile.name })"
            class="print-files-thumbnail"
          />

          <!--
            One chip per filament, matching how established Klipper web
            interfaces show a multi-material plate at a glance. A
            single-material file still gets one chip, built from the plain
            totals, so the shape never depends on how many filaments a file
            happens to use.
          -->
          <ul v-if="selectedFilamentChips.length > 0" class="print-files-filament-chips">
            <li v-for="(chip, index) in selectedFilamentChips" :key="index" class="filament-chip">
              <span
                v-if="chip.color"
                class="filament-chip__swatch"
                :style="{ backgroundColor: chip.color }"
                aria-hidden="true"
              ></span>
              <span v-if="chip.weightGrams !== null" class="filament-chip__weight">
                {{
                  t('printFiles.metadata.gramsValue', {
                    value: weightFormatter.format(chip.weightGrams),
                  })
                }}
              </span>
              <span v-if="chip.type" class="filament-chip__type">{{ chip.type }}</span>
            </li>
          </ul>

          <dl class="print-files-metadata">
            <div class="print-files-metadata__row">
              <dt>{{ t('printFiles.metadata.estimatedTime') }}</dt>
              <dd>{{ formatDuration(gcodeFiles.selectedMetadata?.estimated_time) }}</dd>
            </div>
            <div class="print-files-metadata__row">
              <dt>{{ t('printFiles.metadata.filament') }}</dt>
              <dd>{{ formatFilament(gcodeFiles.selectedMetadata?.filament_total) }}</dd>
            </div>
            <div class="print-files-metadata__row">
              <dt>{{ t('printFiles.metadata.layerHeight') }}</dt>
              <dd>{{ formatHeight(gcodeFiles.selectedMetadata?.layer_height) }}</dd>
            </div>
            <div class="print-files-metadata__row">
              <dt>{{ t('printFiles.metadata.objectHeight') }}</dt>
              <dd>{{ formatHeight(gcodeFiles.selectedMetadata?.object_height) }}</dd>
            </div>
            <div
              v-if="gcodeFiles.selectedMetadata?.nozzle_diameter"
              class="print-files-metadata__row"
            >
              <dt>{{ t('printFiles.metadata.nozzleDiameter') }}</dt>
              <dd>{{ formatHeight(gcodeFiles.selectedMetadata?.nozzle_diameter) }}</dd>
            </div>
            <div
              v-if="gcodeFiles.selectedMetadata?.first_layer_extr_temp"
              class="print-files-metadata__row"
            >
              <dt>{{ t('printFiles.metadata.extruderTemp') }}</dt>
              <dd>{{ formatTemperature(gcodeFiles.selectedMetadata?.first_layer_extr_temp) }}</dd>
            </div>
            <div
              v-if="gcodeFiles.selectedMetadata?.first_layer_bed_temp"
              class="print-files-metadata__row"
            >
              <dt>{{ t('printFiles.metadata.bedTemp') }}</dt>
              <dd>{{ formatTemperature(gcodeFiles.selectedMetadata?.first_layer_bed_temp) }}</dd>
            </div>
            <!--
              Chamber temp is absent on almost every printer this connects
              to — no enclosure heater to report one — so the row only
              appears for the minority that actually sliced with one.
            -->
            <div v-if="gcodeFiles.selectedMetadata?.chamber_temp" class="print-files-metadata__row">
              <dt>{{ t('printFiles.metadata.chamberTemp') }}</dt>
              <dd>{{ formatTemperature(gcodeFiles.selectedMetadata?.chamber_temp) }}</dd>
            </div>
            <div class="print-files-metadata__row">
              <dt>{{ t('printFiles.metadata.slicer') }}</dt>
              <dd>{{ gcodeFiles.selectedMetadata?.slicer ?? t('printFiles.unknownValue') }}</dd>
            </div>
            <div class="print-files-metadata__row">
              <dt>{{ t('printFiles.columns.size') }}</dt>
              <dd>{{ formatSize(gcodeFiles.selectedFile.size) }}</dd>
            </div>
            <div class="print-files-metadata__row">
              <dt>{{ t('printFiles.columns.modified') }}</dt>
              <dd>{{ formatModified(gcodeFiles.selectedFile.modified) }}</dd>
            </div>
          </dl>

          <p
            v-if="gcodeFiles.isMetadataLoading"
            class="print-files-note"
            role="status"
            aria-live="polite"
          >
            {{ t('printFiles.metadata.loading') }}
          </p>
          <p
            v-else-if="gcodeFiles.selectedMetadata === null"
            class="print-files-note"
            role="status"
          >
            {{ t('printFiles.metadata.none') }}
          </p>

          <!--
            Quiet unless something is actually wrong — a spool that fits, or
            a filament whose recommended temperature agrees with the file,
            says nothing at all. `printReadiness.ts` is the same check
            Spool's own card asks about whatever is queued or printing, so
            this can never disagree with it about the same file.
          -->
          <p v-if="fitStatus === 'short'" class="flex items-center gap-1.5 text-alert-inline">
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
          <p v-if="temperatureMismatch" class="flex items-center gap-1.5 text-alert-inline">
            <AppIcon name="warning" class="size-3.5 shrink-0" aria-hidden="true" />
            {{
              t('printFiles.metadata.temperatureMismatch', {
                filament: formatTemperature(temperatureMismatch.filamentExtruderTemp),
                file: formatTemperature(temperatureMismatch.fileExtruderTemp),
              })
            }}
          </p>

          <!--
            `[analysis]` is optional and, unlike auto-analyzed uploads,
            re-running it here is never destructive: Moonraker reports
            `bypassed: true` and changes nothing on a file already processed.
            Offered whenever the estimator binary itself is ready, regardless
            of whether this file carries slicer metadata at all — a
            hand-written file has none to correct until this runs once.
          -->
          <div v-if="gcodeFiles.isAnalysisReady" class="print-files-estimate">
            <AppButton
              size="sm"
              block
              :pending="gcodeFiles.isProcessingEstimate"
              icon="refresh"
              :label="t('printFiles.actions.getAccurateEstimate')"
              :disabled="gcodeFiles.isProcessingEstimate"
              @click="gcodeFiles.processEstimate(gcodeFiles.selectedFile.path)"
            />
            <p v-if="gcodeFiles.processEstimateFailed" class="print-files-note" role="alert">
              {{ t('dashboard.commandFailed') }}
            </p>
          </div>

          <div class="print-files-detail__actions">
            <AppButton
              variant="primary"
              block
              :pending="printer.pendingCommands.startPrint"
              icon="print"
              :label="t('printFiles.actions.print')"
              :disabled="!canPrintSelected"
              @click="startSelectedPrint"
            />
            <AppButton
              block
              :pending="jobQueue.pendingCommands.add"
              icon="jobs"
              :label="t('printFiles.actions.addToQueue')"
              :disabled="!canQueueSelected"
              @click="queueSelectedPrint"
            />
            <p v-if="printer.hasActivePrint" class="print-files-note">
              {{ t('printFiles.printBusy') }}
            </p>
          </div>
        </section>

        <FileDropOverlay v-if="isFileDropActive" :message="t('printFiles.dropHint')" />
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
