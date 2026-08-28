<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DisclosureReveal from '@/components/DisclosureReveal.vue'
import ExcludeObjectDialog from '@/components/ExcludeObjectDialog.vue'
import FileDropOverlay from '@/components/FileDropOverlay.vue'
import MaintenanceReminderDialog from '@/components/MaintenanceReminderDialog.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import FilePreview from '@/components/dashboard/modules/FilePreview.vue'
import PrintQuickSettings from '@/components/dashboard/modules/PrintQuickSettings.vue'
import {
  printProgressFraction,
  readPrintCardSetting,
  readPrintDriftThreshold,
  readPrintEstimateSource,
} from '@/components/dashboard/modules/printCardSettings'
import {
  configBoolean,
  useDashboardModule,
  useDashboardModuleHeaderAction,
} from '@/dashboard/context'
import {
  filamentFitStatus,
  filamentTemperatureMismatch,
  remainingFilamentNeeded,
} from '@/dashboard/printReadiness'
import { revealDashboardCard } from '@/dashboard/reveal'
import { useDashboardViewport } from '@/composables/useDashboardViewport'
import { useExternalFileDrop } from '@/composables/useExternalFileDrop'
import { createTimeFormatter } from '@/i18n/formats'
import type { MoonrakerGcodeMetadata } from '@/services/moonraker'
import { useActionGuard } from '@/composables/useActionGuard'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useExcludeObjectStore } from '@/stores/excludeObject'
import { useJobQueueStore } from '@/stores/jobQueue'
import { useMacrosStore } from '@/stores/macros'
import { useMaintenanceStore } from '@/stores/maintenance'
import { usePrinterStore } from '@/stores/printer'
import { useSpoolStore } from '@/stores/spool'

const { locale, t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const confirmations = useConfirmationsStore()
const excludeObject = useExcludeObjectStore()
const macros = useMacrosStore()
const jobQueue = useJobQueueStore()
const spool = useSpoolStore()
const maintenance = useMaintenanceStore()
const dashboardLayout = useDashboardLayoutStore()
const { viewport } = useDashboardViewport()
const { config, isSettingsOpen } = useDashboardModule('print')

/**
 * Present only while something is overdue, and only while a Maintenance card
 * is actually on this dashboard to reveal — a button that opened nothing
 * would be worse than no button. This is the module-card instance of
 * `interface-standards.md`'s "a header control that appears only when it has
 * work", first written for the global header's save-config gate: the
 * reasoning generalizes, and this is where it generalizes to.
 *
 * Quiet rather than a status-hued fill, matching that same rule — the
 * warning icon's shape is what distinguishes it from Settings beside it, not
 * colour. If Print ever wants a second, frequent header action of its own,
 * this conditional one wins the single slot while it has something to say;
 * see the header-action contract's own doc comment in `dashboard/context.ts`.
 */
const maintenanceInstance = computed(() => {
  const item = dashboardLayout
    .itemsFor(viewport.value)
    .find((candidate) => candidate.instance.moduleId === 'maintenance')
  return item && item.placement.visible ? item : null
})

/** Expands the Maintenance card if it is collapsed, then scrolls it into view. */
function revealMaintenanceCard(): void {
  const instance = maintenanceInstance.value
  if (!instance) return
  const instanceId = instance.instance.instanceId
  dashboardLayout.setCollapsed(viewport.value, instanceId, false)
  void nextTick().then(() => revealDashboardCard(instanceId))
}

useDashboardModuleHeaderAction(
  computed(() => {
    if (!maintenanceInstance.value || !maintenance.hasOverdue) return null
    return {
      icon: 'warning',
      label: t('dashboard.print.maintenanceOverdue'),
      onClick: revealMaintenanceCard,
    }
  }),
)

const showRecentFiles = ref(false)
const recentFilesFailed = ref(false)
const pendingStart = ref<string | null>(null)
/**
 * A recent file's own estimated-time/filament/thumbnail, fetched lazily on
 * first expand rather than for all eight rows up front — most never get
 * opened, and `loadMetadata` is a real Moonraker round trip per file. Keyed
 * by path, the same identity `recentFiles` and the queue already key on.
 */
const expandedRecentFile = ref<string | null>(null)
const recentFileMetadata = ref<Record<string, MoonrakerGcodeMetadata | null>>({})
/** The path waiting on an answer to the overdue-maintenance question, if any. */
const maintenanceReminderFor = ref<string | null>(null)
const confirmingCancel = ref(false)
const confirmingPause = ref(false)
const isExcludeObjectOpen = ref(false)
const isPauseAtLayerOpen = ref(false)
const uploadInput = ref<HTMLInputElement | null>(null)
const isThumbnailExpanded = ref(false)

/*
 * A view of the current file, not a saved preference — dashboard `config`
 * would carry it across every future print, including ones with no thumbnail
 * to expand at all. Collapses on the next filename, so a print never opens
 * already-expanded because the previous one was.
 */
watch(
  () => printer.printStats.filename,
  () => {
    isThumbnailExpanded.value = false
  },
)

/**
 * Meaningless without a running print — Klipper only tracks objects for the
 * file that is loaded — and meaningless a second time when that file defined
 * none: a plate sliced without `EXCLUDE_OBJECT_DEFINE` headers has nothing to
 * open the dialog onto.
 */
const canExcludeObjects = computed(() => printer.hasActivePrint && excludeObject.hasObjects)

const overdueMaintenanceNames = computed(() =>
  maintenance.overdueRows.map((row) => row.interval.name),
)

/*
 * Klipper has no idea what a layer is — this exists only because a printer's
 * own macro config can act on the slicer's own layer-change announcements.
 * `SET_PAUSE_AT_LAYER` and `SET_PAUSE_NEXT_LAYER` are community macros, not
 * Klipper core, so the row offers either control only where the printer's
 * own config actually defines it: a printer without the macro pack shows
 * neither, at no cost to the common case. `macros.ts` already excluded both
 * names from the generic macro picker for exactly this reason.
 */
const canPauseAtLayer = computed(
  () => printer.hasActivePrint && macros.hasMacro('SET_PAUSE_AT_LAYER'),
)
const canPauseNextLayer = computed(
  () => printer.hasActivePrint && macros.hasMacro('SET_PAUSE_NEXT_LAYER'),
)

/**
 * Seeded to the next layer, matching the one thing a reference
 * implementation's own dialog does the same way: arming a layer already
 * passed pauses nothing, so the default is the first layer that still can be.
 */
const pauseAtLayerDefault = computed(() => String((printer.layer.current ?? 0) + 1))

function validatePauseAtLayer(value: string): string | undefined {
  const trimmed = value.trim()
  const parsed = Number(trimmed)
  const current = printer.layer.current ?? 0
  if (!/^\d+$/.test(trimmed) || !Number.isInteger(parsed) || parsed <= current) {
    return t('dashboard.print.pauseAtLayerInvalid')
  }
  return undefined
}

async function confirmPauseAtLayer(value: string): Promise<void> {
  isPauseAtLayerOpen.value = false
  await macros.run('SET_PAUSE_AT_LAYER', { ENABLE: '1', LAYER: value, MACRO: 'PAUSE' })
}

async function requestPauseNextLayer(): Promise<void> {
  await macros.run('SET_PAUSE_NEXT_LAYER', { ENABLE: '1', MACRO: 'PAUSE' })
}

const skipStartWarning = computed(() => configBoolean(config.value, 'skipStartWarning', false))
const skipCancelWarning = computed(() => configBoolean(config.value, 'skipCancelWarning', false))
const skipPauseWarning = computed(() => configBoolean(config.value, 'skipPauseWarning', false))
// Keys, defaults, and the estimate source's allow-list live in
// `printCardSettings.ts`, shared with the settings fields and pane so the
// three read every one of these the same way.
const showThumbnail = computed(() => readPrintCardSetting(config.value, 'showThumbnail'))
const showFilament = computed(() => readPrintCardSetting(config.value, 'showFilament'))
const showDrift = computed(() => readPrintCardSetting(config.value, 'showDrift'))
const driftThreshold = computed(() => readPrintDriftThreshold(config.value))
const preferredSource = computed(() => readPrintEstimateSource(config.value))

const percentFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)
/*
 * Every number this card renders goes through the active locale, never
 * `toFixed`, which writes an English decimal point into every other language.
 * The height cell and the filament cell sit side by side in one grid, so a
 * card that formatted one of them by hand read "1,2 / 24,0 mm" beside
 * "13.1 of 47.9 m" — two separators in the same row. Named for the numeric
 * shape rather than the quantity, since both cells want exactly one decimal;
 * `weightFormatter` matches `SpoolModule`'s own, because the two cards render
 * the same `dashboard.spool.short` sentence and must render it identically.
 */
const oneDecimalFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)
const weightFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)
const clockFormatter = computed(() => createTimeFormatter(locale.value))

/*
 * The one fraction the percentage, the bar and the drift figure all read from
 * — see `printProgressFraction`, which the collapsed card's header summary
 * calls with this same instance's configuration so the two readings of the
 * same card cannot disagree. The `useSlicerProgress` setting is deliberately
 * not read here either: it is one of the inputs that function weighs, and a
 * second reading of it in this file is how the two would come apart.
 */
const progressFraction = computed(() =>
  printProgressFraction(config.value, {
    file: printer.progress,
    slicer: printer.slicerProgress,
    filament: printer.filamentProgress,
  }),
)
const progressPercent = computed(() => percentFormatter.value.format(progressFraction.value * 100))
const recentFiles = computed(() => printer.files.slice(0, 8))
const stateLabel = computed(() => t(`dashboard.print.state.${printer.printStats.state}`))

/**
 * Klipper keeps the filename after a print ends, so an idle card can offer the
 * job it just ran. Empty after a fresh host start, where there is nothing to
 * reprint.
 */
const lastPrintedFile = computed(() =>
  printer.hasActivePrint ? null : printer.printStats.filename || null,
)

/**
 * Why the job is not running, in Klipper's own words — `print_stats.message`,
 * which the firmware writes when it aborts a print (a heater that would not
 * hold, an MCU that stopped answering) and when a `CANCEL_PRINT` macro states
 * its own reason.
 *
 * The card used to read "Print needs attention" and stop there, leaving the
 * one sentence that says what happened reachable only through `klippy.log` in
 * another interface. This is the same judgement `PrinterFaultNotice` makes for
 * a failed Klipper boot, applied to the failure that ends a job rather than
 * the one that ends the session: a state that will not clear on its own and
 * cannot be acted on without being read first earns the quote. `.selectable`
 * for the same reason it is there — the reader pastes it into a search.
 *
 * Only for the two states that carry a reason. A completed print may keep a
 * stale message from an earlier job, and repeating it under "Print complete"
 * would report a failure that did not happen.
 */
const failureMessage = computed(() => {
  const state = printer.printStats.state
  if (state !== 'error' && state !== 'cancelled') return null
  return printer.printStats.message.trim() || null
})

/**
 * The queue's own front job, previewed here rather than only on Print files —
 * `server.job_queue` is already the mechanism Alabaster uses to say "print
 * this next, not right now" (Print files' "Add to queue"), so surfacing it
 * where the reader is already looking at the printer's own state answers
 * "will this actually work" before a click commits any filament, instead of
 * only once the queue has already started it.
 */
const upNextJob = computed(() => (printer.hasActivePrint ? null : (jobQueue.jobs[0] ?? null)))
const upNextMetadata = ref<MoonrakerGcodeMetadata | null>(null)

watch(
  () => upNextJob.value?.filename ?? null,
  async (nextFilename) => {
    upNextMetadata.value = nextFilename ? await printer.loadMetadata(nextFilename) : null
  },
  { immediate: true },
)

const upNextThumbnailUrl = computed(() =>
  printer.thumbnailUrlFor(upNextJob.value?.filename ?? null, upNextMetadata.value),
)

/**
 * Shared with each expanded Recent files row's `FilePreview`, so "Up next"
 * and a browsed file never format the same fields two different ways.
 */
function estimatedTimeLabelFor(metadata: MoonrakerGcodeMetadata | null | undefined): string | null {
  return metadata?.estimated_time ? formatDuration(metadata.estimated_time) : null
}

function filamentLabelFor(metadata: MoonrakerGcodeMetadata | null | undefined): string | null {
  if (!metadata?.filament_weight_total) return null
  return t('printFiles.metadata.gramsValue', {
    value: weightFormatter.value.format(metadata.filament_weight_total),
  })
}

const upNextEstimatedTimeLabel = computed(() => estimatedTimeLabelFor(upNextMetadata.value))
const upNextFilamentLabel = computed(() => filamentLabelFor(upNextMetadata.value))

const upNextFitStatus = computed(() =>
  filamentFitStatus(
    upNextMetadata.value?.filament_weight_total,
    spool.activeSpool?.remaining_weight,
  ),
)

const upNextTemperatureMismatch = computed(() =>
  filamentTemperatureMismatch(
    spool.activeSpool?.filament.settings_extruder_temp,
    upNextMetadata.value?.first_layer_extr_temp,
  ),
)

async function removeUpNext(): Promise<void> {
  const job = upNextJob.value
  if (job) await jobQueue.removeJob(job.job_id)
}

/**
 * The same two checks as "up next" and Spool, asked here about the job
 * actually running rather than the one queued behind it — Print is where the
 * reader is already watching, so a spool running short mid-job warns here
 * too, not only on Spool's own card. Never a positive counterpart: a print
 * already underway needs no reassurance repeated at it, only word the moment
 * something is actually wrong — see `printReadiness.ts`.
 */
const currentNeededWeight = computed(() => {
  if (!printer.hasActivePrint) return null
  return remainingFilamentNeeded(
    printer.currentMetadata?.filament_weight_total,
    printer.filamentProgress,
  )
})

const currentFitStatus = computed(() =>
  filamentFitStatus(currentNeededWeight.value, spool.activeSpool?.remaining_weight),
)

const currentTemperatureMismatch = computed(() => {
  if (!printer.hasActivePrint) return null
  return filamentTemperatureMismatch(
    spool.activeSpool?.filament.settings_extruder_temp,
    printer.currentMetadata?.first_layer_extr_temp,
  )
})

/** The chosen source when the user picked one and it can answer, else the default. */
const remainingSeconds = computed(() => {
  const source = preferredSource.value
  if (source === 'auto') return printer.remainingSeconds
  return printer.timeEstimates[source] ?? printer.remainingSeconds
})

const finishLabel = computed(() => {
  const remaining = remainingSeconds.value
  if (remaining === null || !printer.isPrinting) return null
  return clockFormatter.value.format(new Date(Date.now() + remaining * 1000))
})

/*
 * Drift stays hidden while the print tracks its estimate. A label that is always
 * present would report "on time" over and over, which is noise; showing up only
 * once the print has genuinely diverged is what makes it worth reading. Measured
 * against the same fraction the percentage and bar show, so switching the
 * remaining-time source moves this figure along with them.
 */
const driftLabel = computed(() => {
  const drift = printer.driftFor(progressFraction.value)
  if (drift === null) return null
  const percent = drift * 100
  if (Math.abs(percent) < driftThreshold.value) return null
  const amount = percentFormatter.value.format(Math.abs(percent))
  return percent > 0
    ? t('dashboard.print.driftBehind', { percent: amount })
    : t('dashboard.print.driftAhead', { percent: amount })
})

const layerLabel = computed(() => {
  const { current, total } = printer.layer
  if (current === null) return null
  return total === null ? String(current) : t('dashboard.print.layerOf', { current, total })
})

/** Shown when the slicer reported no layer counter; exact and assumption-free. */
const heightLabel = computed(() => {
  const height = printer.heightProgress
  if (!height || layerLabel.value !== null) return null
  return t('dashboard.print.heightOf', {
    current: oneDecimalFormatter.value.format(height.current),
    total: oneDecimalFormatter.value.format(height.total),
  })
})

/** Metres of filament the finished job consumed, as a bare figure for its own cell. */
const finishedFilamentLabel = computed(() => {
  const used = printer.printStats.filamentUsed
  if (!used) return null
  return t('dashboard.print.metres', { value: oneDecimalFormatter.value.format(used / 1000) })
})

const filamentLabel = computed(() => {
  const used = printer.printStats.filamentUsed
  const total = printer.currentMetadata?.filament_total
  if (!used) return null
  const usedMetres = oneDecimalFormatter.value.format(used / 1000)
  if (!total) return t('dashboard.print.filamentUsed', { used: usedMetres })
  return t('dashboard.print.filamentOf', {
    used: usedMetres,
    total: oneDecimalFormatter.value.format(total / 1000),
  })
})

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return t('dashboard.unavailableValue')
  const totalMinutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0
    ? t('dashboard.duration.hoursMinutes', { hours, minutes })
    : t('dashboard.duration.minutes', { minutes })
}

function filename(path: string): string {
  const separatorIndex = path.lastIndexOf('/')
  return separatorIndex < 0 ? path : path.slice(separatorIndex + 1)
}

/**
 * A file picked here goes straight to the same "Start this print?" dialog a
 * recent file would, rather than a second confirmation flow for the same
 * decision — uploading is not itself the risky action, starting the print is.
 */
async function handleUploadSelected(event: Event): Promise<void> {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0] ?? null
  input.value = ''
  if (!file) return
  const path = await printer.uploadPrintFile(file)
  if (path) requestStart(path)
}

/**
 * A file dropped onto the card goes through the same picker path as
 * `handleUploadSelected` — upload, then the same "Start this print?" request
 * a chosen file gets. Only the first file matters: this card starts one
 * print, not a batch, so a drag carrying several files is not a way to queue
 * the rest of them.
 */
const {
  isActive: isFileDropActive,
  onDragEnter: onFileDragEnter,
  onDragOver: onFileDragOver,
  onDragLeave: onFileDragLeave,
  onDrop: onFileDrop,
} = useExternalFileDrop({
  canDrop: () =>
    !printer.hasActivePrint &&
    !printer.pendingCommands.uploadFile &&
    !printer.pendingCommands.files,
  onDrop: async (files) => {
    const file = files[0]
    if (!file) return
    const path = await printer.uploadPrintFile(file)
    if (path) requestStart(path)
  },
})

/*
 * A refusal is kept apart from an empty list: "No G-code files were returned
 * by Moonraker" is a fact about the printer, and printing it after a call that
 * never answered reports the wrong thing about a printer that may well be full
 * of files.
 */
async function openRecentFiles(): Promise<void> {
  showRecentFiles.value = true
  recentFilesFailed.value = !(await printer.refreshFiles())
}

function toggleRecentFiles(): void {
  if (showRecentFiles.value) {
    showRecentFiles.value = false
    expandedRecentFile.value = null
  } else {
    void openRecentFiles()
  }
}

function toggleRecentFileDetails(path: string): void {
  if (expandedRecentFile.value === path) {
    expandedRecentFile.value = null
    return
  }
  expandedRecentFile.value = path
  if (!(path in recentFileMetadata.value)) {
    void printer.loadMetadata(path).then((metadata) => {
      recentFileMetadata.value[path] = metadata
    })
  }
}

async function startPrintAt(path: string): Promise<void> {
  /*
   * The store only starts a path Moonraker has listed, and the list is loaded
   * lazily — so reprinting the last file can be the first thing that needs it.
   * Fetching it here keeps the idle card off the wire until the user acts.
   */
  if (!printer.files.some((file) => file.path === path)) await printer.refreshFiles()
  if (await printer.startPrint(path)) showRecentFiles.value = false
}

async function confirmStart(): Promise<void> {
  const path = pendingStart.value
  pendingStart.value = null
  if (path) await startPrintAt(path)
}

/**
 * Every way this card starts a print goes through here — "Print again", a
 * recent file, a chosen upload, a dropped file — so the overdue-maintenance
 * question is asked once, in front of all four.
 *
 * It used to be asked only by Print files' own Start button, which made the
 * same decision answer differently depending on which surface the reader
 * happened to be standing on: this card would show the overdue warning in its
 * header and then start the print without a word. The reminder leads because
 * it is the question about whether to print at all; the ordinary "Start this
 * print?" confirmation is the question about this file, and "Start anyway" has
 * already answered both, so it starts rather than opening a second dialog on
 * top of the first — the same thing Print files does with it.
 */
function requestStart(path: string): void {
  if (confirmations.shouldShowMaintenanceReminder() && maintenance.hasOverdue) {
    maintenanceReminderFor.value = path
    return
  }
  startGuard.request(
    () => void startPrintAt(path),
    () => (pendingStart.value = path),
  )
}

/** Starting anyway quiets the reminder until tomorrow — see confirmations.ts. */
async function confirmStartDespiteMaintenance(): Promise<void> {
  const path = maintenanceReminderFor.value
  maintenanceReminderFor.value = null
  confirmations.suppressMaintenanceReminderUntilTomorrow()
  if (path) await startPrintAt(path)
}

function dismissMaintenanceReminder(): void {
  maintenanceReminderFor.value = null
  confirmations.snoozeMaintenanceReminder()
}

/** Does not start the print: the card being asked about is already on this page. */
function openMaintenanceFromReminder(): void {
  maintenanceReminderFor.value = null
  revealMaintenanceCard()
}

/*
 * Cancel and Start are both terminal, both module-local, and both used to
 * compute their own escalation inline -- once as a ternary on `printAgain` and
 * once as an object literal on a recent file's Start, for the same decision.
 * Cancel computed none at all, so with its confirmation switched off it looked
 * exactly as it had when something was still going to catch a misclick.
 *
 * `cancelGuard`'s tier is a literal rather than a getter: Cancel is only
 * reachable while a job is loaded, so there is no idle state for it to resolve
 * to. Start's is the opposite case and is also literal, for the opposite
 * reason -- it ends nothing that is running, it commits the machine to a job,
 * and it is only offered when no job is loaded.
 */
const cancelGuard = useActionGuard({ tier: 'terminal', moduleFlag: skipCancelWarning })
/*
 * `primary`, not the terminal default. Start's consequence is commitment, not
 * destruction -- there is no print for it to end and nothing for the machine to
 * forget -- so it keeps the emphasis it has always had while the dialog is
 * still there to ask, and escalates one step when the dialog is gone.
 */
const startGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'primary',
  moduleFlag: skipStartWarning,
})

/*
 * Pause interrupts the print's outcome without ending it, but the machine
 * cannot resume it on its own — a misclick pauses a job unattended, sometimes
 * for as long as it takes someone to notice. `neutral`, not the terminal
 * default, because pausing costs nothing structurally: unlike Cancel, there is
 * nothing here to escalate to danger livery over, only a control that either
 * asks first or does not.
 */
const pauseGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'neutral',
  moduleFlag: skipPauseWarning,
})

async function confirmCancel(): Promise<void> {
  confirmingCancel.value = false
  await printer.cancelPrint()
}

function requestCancel(): void {
  cancelGuard.request(
    () => void printer.cancelPrint(),
    () => (confirmingCancel.value = true),
  )
}

async function confirmPause(): Promise<void> {
  confirmingPause.value = false
  await printer.pausePrint()
}

function requestPause(): void {
  pauseGuard.request(
    () => void printer.pausePrint(),
    () => (confirmingPause.value = true),
  )
}
</script>

<template>
  <!--
    inset: this card's sections carry their padding individually rather than
    sharing one wrapper's — see AppDashboardModule's own doc comment for why
    that specifically matters for the panel. Shared with Console, which is in
    the same situation.
  -->
  <AppDashboardModule inset :open="isSettingsOpen">
    <template #quick-settings>
      <PrintQuickSettings />
    </template>

    <!--
    The job stays one reading column at every card width. Its controls follow
    the status as a footer toolbar instead of competing with the filename and
    stats for a side column; expanding the thumbnail therefore leaves no empty
    action rail beside the image. The card remains the query container because
    the stat grid still answers the card's own width, not the viewport's.
  -->
    <div
      class="print-card relative p-4"
      @dragenter="onFileDragEnter"
      @dragover="onFileDragOver"
      @dragleave="onFileDragLeave"
      @drop="onFileDrop"
    >
      <FileDropOverlay v-if="isFileDropActive" :message="t('dashboard.print.dropHint')" />
      <div class="grid gap-4">
        <!--
        Stacks instead of sitting side by side once expanded — an instant
        swap, per AGENTS.md's rule against animating responsive geometry.
        What does animate is the box itself, once this row has already
        reflowed around it: the expanding-preview exception in ADR 0004.
      -->
        <div class="flex min-w-0 items-start gap-4" :class="{ 'flex-col': isThumbnailExpanded }">
          <!--
          A second `brand-trigger` instance (button-system.md): the thumbnail's
          own size is the slicer's image, not a button-scale height, so it opts
          out of button chrome the same way the Alabaster mark does. The image
          stays presentational — its alt was already generic ("a preview
          exists"), never a description of the model — and the button's own
          label carries both what it is and what clicking it does. No `title`:
          a hover tooltip on a control this size sits directly over the image
          it names, which is the one thing clicking it is for.
        -->
          <button
            v-if="printer.hasActivePrint && showThumbnail && printer.thumbnailUrl"
            type="button"
            class="brand-trigger print-thumbnail-toggle"
            :class="{ 'print-thumbnail-toggle--expanded': isThumbnailExpanded }"
            :aria-label="
              isThumbnailExpanded
                ? t('dashboard.print.collapseThumbnail')
                : t('dashboard.print.expandThumbnail')
            "
            @click="isThumbnailExpanded = !isThumbnailExpanded"
          >
            <img :src="printer.thumbnailUrl" alt="" class="print-thumbnail" />
          </button>
          <div class="min-w-0 flex-1">
            <p class="text-eyebrow text-data-sky">
              {{ stateLabel }}
            </p>
            <template v-if="printer.hasActivePrint">
              <!--
                The name, not the path Klipper reports — the finished-job
                headline below has always shown the base name, so a job in a
                subfolder used to be renamed in front of the reader the moment
                it ended. The full path stays reachable as the tooltip, the
                same way a recent-file row carries its own.
              -->
              <p
                class="mt-2 truncate text-xl font-black tracking-[-0.035em]"
                :title="printer.printStats.filename || undefined"
              >
                {{
                  printer.printStats.filename
                    ? filename(printer.printStats.filename)
                    : t('dashboard.print.unnamedFile')
                }}
              </p>
              <p v-if="printer.displayMessage" class="mt-1 truncate text-xs text-muted">
                {{ printer.displayMessage }}
              </p>
              <div
                class="mt-4 h-2 overflow-hidden rounded-full bg-soft"
                role="progressbar"
                :aria-label="t('dashboard.print.progress')"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="Math.round(progressFraction * 100)"
              >
                <span
                  class="block h-full rounded-full bg-data-sky transition-[width]"
                  :style="{ width: `${progressFraction * 100}%` }"
                ></span>
              </div>
              <dl class="print-stats print-stats--four mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt class="text-muted">{{ t('dashboard.print.progress') }}</dt>
                  <dd class="mt-1 font-mono font-black tabular-nums">
                    {{ progressPercent }}{{ t('dashboard.percentUnit') }}
                  </dd>
                </div>
                <div v-if="layerLabel || heightLabel">
                  <dt class="text-muted">
                    {{ layerLabel ? t('dashboard.print.layer') : t('dashboard.print.height') }}
                  </dt>
                  <dd class="mt-1 font-mono font-black tabular-nums">
                    {{ layerLabel ?? heightLabel }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">{{ t('dashboard.print.elapsed') }}</dt>
                  <dd class="mt-1 font-mono font-black tabular-nums">
                    {{ formatDuration(printer.printStats.printDuration) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">
                    {{
                      finishLabel ? t('dashboard.print.finishesAt') : t('dashboard.print.remaining')
                    }}
                  </dt>
                  <dd class="mt-1 font-mono font-black tabular-nums">
                    {{ finishLabel ?? formatDuration(remainingSeconds) }}
                  </dd>
                </div>
                <!--
                A fifth cell, not a sentence beside the other four: "13.1 of
                47.9 m" reads as the same kind of fact `layerOf` already is,
                where the old prose ("13.1 m of filament used") did not. The
                grid wraps a fifth child onto its own row for free, so this
                needs no template restructuring beyond moving the value in.
              -->
                <div v-if="showFilament && filamentLabel">
                  <dt class="text-muted">{{ t('dashboard.print.filament') }}</dt>
                  <dd class="mt-1 font-mono font-black tabular-nums">{{ filamentLabel }}</dd>
                </div>
              </dl>
              <!--
            Always rendered while a print is active and the setting is on,
            whether or not the drift has crossed the threshold: reserving the
            row up front is what keeps it from shifting the card's height the
            moment it does.
          -->
              <p
                v-if="showDrift"
                class="mt-1 text-xs font-bold text-caution-text"
                :class="{ invisible: !driftLabel }"
              >
                {{ driftLabel ?? '\u00A0' }}
              </p>
              <p
                v-if="currentFitStatus === 'short'"
                class="mt-2 flex items-center gap-1.5 text-alert-inline"
              >
                <AppIcon name="warning" class="size-3.5 shrink-0" aria-hidden="true" />
                {{
                  t('dashboard.spool.short', {
                    needed: weightFormatter.format(currentNeededWeight ?? 0),
                    remaining: weightFormatter.format(spool.activeSpool?.remaining_weight ?? 0),
                    unit: t('dashboard.weightUnit'),
                  })
                }}
              </p>
              <p
                v-if="currentTemperatureMismatch"
                class="mt-2 flex items-center gap-1.5 text-alert-inline"
              >
                <AppIcon name="warning" class="size-3.5 shrink-0" aria-hidden="true" />
                {{
                  t('dashboard.spool.temperatureMismatch', {
                    filament: currentTemperatureMismatch.filamentExtruderTemp,
                    file: currentTemperatureMismatch.fileExtruderTemp,
                  })
                }}
              </p>
            </template>
            <!--
          A finished job keeps its own view: the file it ran, what it cost, and
          the two things worth doing next. Reprinting is the likeliest, and
          clearing is what returns the card to ready. With nothing to reprint
          there is no data to show, so the headline says what to do instead.
        -->
            <template v-else>
              <p
                class="mt-2 truncate text-xl font-black tracking-[-0.035em]"
                :title="lastPrintedFile ?? undefined"
              >
                {{ lastPrintedFile ? filename(lastPrintedFile) : t('dashboard.print.readyTitle') }}
              </p>
              <p v-if="failureMessage" class="mt-2 flex items-start gap-1.5 text-alert-inline">
                <AppIcon name="warning" class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span class="selectable">{{ failureMessage }}</span>
              </p>
              <dl
                v-if="lastPrintedFile"
                class="print-stats print-stats--three mt-3 grid grid-cols-2 gap-3 text-xs"
              >
                <div>
                  <dt class="text-muted">{{ t('dashboard.print.totalTime') }}</dt>
                  <dd class="mt-1 font-mono font-black tabular-nums">
                    {{ formatDuration(printer.printStats.totalDuration) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted">{{ t('dashboard.print.printingTime') }}</dt>
                  <dd class="mt-1 font-mono font-black tabular-nums">
                    {{ formatDuration(printer.printStats.printDuration) }}
                  </dd>
                </div>
                <div v-if="finishedFilamentLabel">
                  <dt class="text-muted">{{ t('dashboard.print.filament') }}</dt>
                  <dd class="mt-1 font-mono font-black tabular-nums">
                    {{ finishedFilamentLabel }}
                  </dd>
                </div>
              </dl>
            </template>
          </div>
        </div>

        <!--
        Two stable groups, ordered by consequence. Pause/resume and Cancel are
        the job controls and stay labelled; optional print tools are quiet
        icon controls because this footer is the context that explains them.
        The groups wrap as units, so a narrow card never leaves one advanced
        action orphaned beside a full-width Pause button.
      -->
        <div class="print-actions">
          <template v-if="printer.hasActivePrint">
            <div class="print-actions__primary">
              <AppButton
                v-if="printer.isPrinting"
                :guard="pauseGuard"
                icon="pause"
                :label="t('dashboard.print.pause')"
                :disabled="printer.pendingCommands.pause"
                @click="requestPause"
              />
              <AppButton
                v-else
                variant="primary"
                icon="play"
                :label="t('dashboard.print.resume')"
                :disabled="printer.pendingCommands.resume"
                @click="printer.resumePrint"
              />
              <AppButton
                size="sm"
                :guard="cancelGuard"
                :disabled="printer.pendingCommands.cancel"
                icon="stop"
                :label="t('dashboard.print.cancel')"
                @click="requestCancel"
              />
            </div>
            <div
              v-if="canExcludeObjects || canPauseAtLayer || canPauseNextLayer"
              class="print-actions__secondary"
            >
              <AppButton
                v-if="canExcludeObjects"
                variant="quiet"
                icon-only
                icon="excludeObject"
                :aria-label="t('dashboard.print.excludeObject')"
                :title="t('dashboard.print.excludeObject')"
                @click="isExcludeObjectOpen = true"
              />
              <AppButton
                v-if="canPauseAtLayer"
                variant="quiet"
                icon-only
                icon="layers"
                :aria-label="t('dashboard.print.pauseAtLayer')"
                :title="t('dashboard.print.pauseAtLayer')"
                @click="isPauseAtLayerOpen = true"
              />
              <AppButton
                v-if="canPauseNextLayer"
                variant="quiet"
                icon-only
                icon="layerNext"
                :disabled="macros.isRunning('SET_PAUSE_NEXT_LAYER')"
                :aria-label="t('dashboard.print.pauseNextLayer')"
                :title="t('dashboard.print.pauseNextLayer')"
                @click="requestPauseNextLayer"
              />
            </div>
          </template>
          <div v-else class="print-actions__idle">
            <AppButton
              v-if="lastPrintedFile"
              size="sm"
              :guard="startGuard"
              :disabled="printer.pendingCommands.startPrint || printer.pendingCommands.files"
              icon="play"
              :label="t('dashboard.print.printAgain')"
              @click="requestStart(lastPrintedFile)"
            />
            <!--
          Print files, not the File Explorer: choosing what to print is a
          different workspace from editing what the machine loads, and this link
          pointed at the config root only because the gcodes browser did not
          exist yet.
        -->
            <RouterLink
              :to="{ name: 'printFiles' }"
              :class="lastPrintedFile ? 'button button--sm' : 'button button--sm button--primary'"
            >
              <AppIcon name="folder" class="size-5" aria-hidden="true" />
              {{ t('dashboard.print.chooseFile') }}
            </RouterLink>
            <AppButton
              size="sm"
              :pending="printer.pendingCommands.uploadFile"
              :disabled="printer.pendingCommands.uploadFile"
              icon="fileUpload"
              :label="t('dashboard.print.upload')"
              @click="uploadInput?.click()"
            />
            <input
              ref="uploadInput"
              class="sr-only"
              type="file"
              accept=".gcode,.g,.gco,.ufp,.nc"
              tabindex="-1"
              aria-hidden="true"
              @change="handleUploadSelected"
            />
            <AppButton
              v-if="lastPrintedFile"
              size="sm"
              :disabled="printer.pendingCommands.clearPrint"
              :title="t('dashboard.print.clearTitle')"
              icon="refresh"
              :label="t('dashboard.print.clear')"
              @click="() => printer.clearPrintStats()"
            />
            <!--
          Offered whether or not there is a job to reprint. It used to be
          hidden as soon as the printer had printed anything, which left the
          one-click path to the *previous* files reachable only on a printer
          that had not printed since its host booted — precisely backwards, and
          the opposite of what the documentation promises. Five controls wrap
          onto a second row on a narrow card, which this footer already does.
        -->
            <AppButton
              size="sm"
              :disabled="printer.pendingCommands.files"
              :aria-expanded="showRecentFiles"
              aria-controls="print-recent-files"
              icon="activity"
              :label="t('dashboard.print.recent')"
              @click="toggleRecentFiles"
            />
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="showRecentFiles && !printer.hasActivePrint"
      id="print-recent-files"
      class="border-t border-subtle bg-soft p-4"
    >
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs font-black">{{ t('dashboard.print.recent') }}</p>
        <AppButton
          icon-only
          icon="close"
          :aria-label="t('dashboard.print.closeRecent')"
          :title="t('dashboard.print.closeRecent')"
          @click="showRecentFiles = false"
        />
      </div>
      <ul class="mt-3 grid gap-1">
        <li v-for="(file, index) in recentFiles" :key="file.path" class="min-w-0">
          <div class="recent-file-row">
            <button
              type="button"
              class="file-select min-w-0 flex-1"
              :aria-expanded="expandedRecentFile === file.path"
              :aria-controls="`print-recent-file-details-${index}`"
              :title="file.path"
              @click="toggleRecentFileDetails(file.path)"
            >
              <span class="min-w-0 truncate text-row-name">{{ filename(file.path) }}</span>
            </button>
            <AppButton
              size="sm"
              :guard="startGuard"
              icon="play"
              :label="t('dashboard.print.start')"
              :disabled="printer.pendingCommands.startPrint"
              :aria-label="t('dashboard.print.startFile', { filename: filename(file.path) })"
              @click="requestStart(file.path)"
            />
          </div>
          <DisclosureReveal :open="expandedRecentFile === file.path">
            <div :id="`print-recent-file-details-${index}`" class="pt-2">
              <FilePreview
                v-if="recentFileMetadata[file.path]"
                :estimated-time-label="estimatedTimeLabelFor(recentFileMetadata[file.path])"
                :filament-label="filamentLabelFor(recentFileMetadata[file.path])"
                :thumbnail-url="printer.thumbnailUrlFor(file.path, recentFileMetadata[file.path])"
              />
            </div>
          </DisclosureReveal>
        </li>
      </ul>
      <p v-if="recentFilesFailed" class="mt-2 text-xs text-caution-text">
        {{ t('dashboard.print.recentFailed') }}
      </p>
      <p v-else-if="recentFiles.length === 0" class="mt-2 text-xs text-muted">
        {{ t('dashboard.print.noFiles') }}
      </p>
    </div>

    <!--
    The queue's front job, not toggled like Recent files: whether something
    is coming up next is worth knowing at a glance, not behind a click.
  -->
    <div v-if="upNextJob" class="border-t border-subtle bg-soft p-4">
      <FilePreview
        :estimated-time-label="upNextEstimatedTimeLabel"
        :filament-label="upNextFilamentLabel"
        :thumbnail-url="upNextThumbnailUrl"
      >
        <div class="flex items-center justify-between gap-3">
          <p class="text-eyebrow text-data-sky">{{ t('dashboard.print.upNext') }}</p>
          <span v-if="jobQueue.jobs.length > 1" class="text-xs text-muted">
            {{ t('dashboard.print.upNextMore', { count: jobQueue.jobs.length - 1 }) }}
          </span>
        </div>
        <p class="mt-1 truncate text-sm font-black">{{ filename(upNextJob.filename) }}</p>
      </FilePreview>

      <!--
      Quiet unless something is actually wrong, matching Spool and Print
      files: the same shared checks, asked here about whatever the queue
      would run next.
    -->
      <p
        v-if="upNextFitStatus === 'short'"
        class="mt-2 flex items-center gap-1.5 text-alert-inline"
      >
        <AppIcon name="warning" class="size-3.5 shrink-0" aria-hidden="true" />
        {{
          t('dashboard.spool.short', {
            needed: weightFormatter.format(upNextMetadata?.filament_weight_total ?? 0),
            remaining: weightFormatter.format(spool.activeSpool?.remaining_weight ?? 0),
            unit: t('dashboard.weightUnit'),
          })
        }}
      </p>
      <p v-if="upNextTemperatureMismatch" class="mt-2 flex items-center gap-1.5 text-alert-inline">
        <AppIcon name="warning" class="size-3.5 shrink-0" aria-hidden="true" />
        {{
          t('dashboard.spool.temperatureMismatch', {
            filament: upNextTemperatureMismatch.filamentExtruderTemp,
            file: upNextTemperatureMismatch.fileExtruderTemp,
          })
        }}
      </p>

      <!--
      "Up next" says what the queue will start when this job ends, which is
      true only while the queue is running. A paused queue starts nothing on
      its own, so the preview without this line promised something that would
      never happen and left "Start now" looking like a shortcut rather than
      the only way the job moves. The Job queue card reports the same state
      from the same store; this says it where the promise is made.
    -->
      <p v-if="jobQueue.isPaused" class="mt-2 flex items-center gap-1.5 text-xs text-caution-text">
        <AppIcon name="pause" class="size-3.5 shrink-0" aria-hidden="true" />
        {{ t('dashboard.jobQueue.state.paused') }}
      </p>

      <div class="mt-3 flex flex-wrap gap-2">
        <AppButton
          variant="primary"
          size="sm"
          icon="play"
          :label="t('dashboard.print.startNow')"
          :disabled="jobQueue.pendingCommands.start"
          @click="jobQueue.startQueue()"
        />
        <AppButton
          variant="danger-quiet"
          size="sm"
          icon="close"
          :label="t('dashboard.print.removeFromQueue')"
          :disabled="jobQueue.pendingCommands.remove"
          @click="removeUpNext"
        />
      </div>
    </div>

    <ConfirmDialog
      :open="pendingStart !== null"
      :title="t('dashboard.print.confirmStartTitle')"
      :description="
        t('dashboard.print.confirmStart', { filename: pendingStart ? filename(pendingStart) : '' })
      "
      :confirm-label="t('dashboard.print.start')"
      @confirm="confirmStart"
      @cancel="pendingStart = null"
    />
    <!--
    The only dialog that overrides the dismissive label, and the case
    `dialog-system.md` names for why `cancelLabel` exists at all: the
    affirmative action leads, so a bare "Cancel" beside the shared "Cancel"
    would offer two buttons that both read as cancelling — and in a language
    whose word for the dismissive button *is* the word for this command, both
    buttons say the same thing. Each label therefore names its own action:
    "Cancel print" against "Keep printing". The footer button keeps the short
    `cancel` label, where Pause and Resume beside it supply the context this
    dialog has to state outright.
  -->
    <ConfirmDialog
      :open="confirmingPause"
      :title="t('dashboard.print.confirmPauseTitle')"
      :description="t('dashboard.print.confirmPause')"
      :confirm-label="t('dashboard.print.pause')"
      @confirm="confirmPause"
      @cancel="confirmingPause = false"
    />
    <ConfirmDialog
      :open="confirmingCancel"
      :title="t('dashboard.print.confirmCancelTitle')"
      :description="t('dashboard.print.confirmCancel')"
      :confirm-label="t('dashboard.print.cancelPrint')"
      :cancel-label="t('dashboard.print.keepPrinting')"
      tone="danger"
      @confirm="confirmCancel"
      @cancel="confirmingCancel = false"
    />
    <MaintenanceReminderDialog
      :open="maintenanceReminderFor !== null"
      :overdue-names="overdueMaintenanceNames"
      @start-anyway="confirmStartDespiteMaintenance"
      @not-now="dismissMaintenanceReminder"
      @open-maintenance="openMaintenanceFromReminder"
    />
    <ExcludeObjectDialog :open="isExcludeObjectOpen" @close="isExcludeObjectOpen = false" />
    <PromptDialog
      :open="isPauseAtLayerOpen"
      :title="t('dashboard.print.pauseAtLayerTitle')"
      :description="t('dashboard.print.pauseAtLayerDescription')"
      :label="t('dashboard.print.pauseAtLayerLabel')"
      :initial-value="pauseAtLayerDefault"
      :confirm-label="t('dashboard.print.pauseAtLayerConfirm')"
      :validate="validatePauseAtLayer"
      @confirm="confirmPauseAtLayer"
      @cancel="isPauseAtLayerOpen = false"
    />
  </AppDashboardModule>
</template>
