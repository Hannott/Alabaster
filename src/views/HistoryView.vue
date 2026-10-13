<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import HistoryJobRow from '@/components/history/HistoryJobRow.vue'
import HistoryTrendChart from '@/components/history/HistoryTrendChart.vue'
import PageHeading from '@/components/PageHeading.vue'
import { useAvailability } from '@/composables/useAvailability'
import { formatHistoryDuration, formatHistoryFilament } from '@/features/history/format'
import { historyOutcomeIcon } from '@/features/history/outcome'
import { createTimeFormatter } from '@/i18n/formats'
import {
  estimateDeviation,
  historyPeriods,
  historyTrend,
  lengthDistribution,
  outcomeBreakdown,
  outcomeMeasureValue,
  typicalPrintDuration,
  type HistoryPeriod,
  type HistoryStatsMeasure,
  type LengthDistributionBin,
  type OutcomeBreakdown,
} from '@/features/history/statistics'
import { useActionGuard } from '@/composables/useActionGuard'
import { moonrakerThumbnailUrl } from '@/services/moonraker'
import { useConfirmationsStore } from '@/stores/confirmations'
import {
  useHistoryStore,
  type HistoryAuxiliaryTotal,
  type HistoryJob,
  type HistoryJobAuxiliaryValue,
} from '@/stores/history'
import { useJobQueueStore } from '@/stores/jobQueue'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'

const { locale, t } = useI18n({ useScope: 'global' })
const history = useHistoryStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const confirmations = useConfirmationsStore()
const moonraker = useMoonrakerStore()
/*
 * Reprinting commits the machine to a job; deleting a record destroys one. Same
 * tier, different emphasis, and the escalation is one step from each.
 */
const reprintGuard = useActionGuard({ tier: 'terminal', emphasis: 'primary', key: 'reprintJob' })
/**
 * The same decision as `reprintGuard`, at `quiet` emphasis for the row menu,
 * where a filled item would outshout every other entry in the list.
 */
const menuReprintGuard = useActionGuard({ tier: 'terminal', emphasis: 'quiet', key: 'reprintJob' })
const deleteJobGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'deleteHistoryJob',
})
const jobQueue = useJobQueueStore()
const { availability: moonrakerAvailability } = useAvailability('moonraker')

onMounted(() => {
  // Reprint checks the file still exists against the printer's own listing.
  void printer.refreshFiles()
})

const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)
const percentFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }),
)
function formatDuration(seconds: number): string {
  return formatHistoryDuration(seconds, t)
}

function formatFilament(millimetres: number): string {
  return formatHistoryFilament(millimetres, t, locale.value)
}

function shortName(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator < 0 ? path : path.slice(separator + 1)
}

const periodOptions: readonly HistoryPeriod[] = historyPeriods
const measureOptions: readonly HistoryStatsMeasure[] = ['jobs', 'filament', 'time']
const measure = ref<HistoryStatsMeasure>('jobs')

const outcomeRows = computed(() => outcomeBreakdown(history.windowJobs))

const outcomeMeasureTotal = computed(() =>
  outcomeRows.value.reduce((sum, entry) => sum + outcomeMeasureValue(entry, measure.value), 0),
)

/**
 * Share is always computed against whichever measure is selected, so the bar
 * and this column can never disagree the way two independently-toggled
 * reference charts can — there is only one toggle for the whole block.
 */
function outcomeShareLabel(entry: OutcomeBreakdown): string {
  const total = outcomeMeasureTotal.value
  if (total === 0) return percentFormatter.value.format(0)
  return percentFormatter.value.format(outcomeMeasureValue(entry, measure.value) / total)
}

/**
 * States its own population rather than letting a bare number imply one: "90
 * days" and "all time" both need to say what they cover, since neither is
 * guessable from a job count alone.
 */
const periodJobCountLabel = computed(() => {
  const count = history.windowJobs.length
  return history.period === 'all'
    ? t('history.stats.period.jobCountAll', { count })
    : t('history.stats.period.jobCount', { count })
})

/**
 * `server.history.totals`'s own `auxiliary_totals` carries a field name and a
 * number, nothing else — the description and unit live only in the `[sensor
 * ...]` section that declared it, which may no longer exist. A total whose
 * declaration is gone still degrades to its own field name rather than
 * disappearing or rendering `undefined`.
 *
 * Resolved once per total in a computed rather than per read in the template:
 * matching a declaration is a scan of every declared field, and the template
 * needed the description and the formatted value separately, so a function
 * called from the markup ran that scan twice for every row on every render of
 * the page.
 */
const auxiliaryTotalRows = computed(() =>
  history.totals.auxiliaryTotals.map((total: HistoryAuxiliaryTotal) => {
    const declaration = printerConfig.historyFields.find(
      (field) => field.provider === total.provider && field.field === total.field,
    )
    const units = declaration?.units ?? ''
    const value = numberFormatter.value.format(total.total)
    return {
      key: `${total.provider}-${total.field}`,
      description: declaration?.description ?? total.field,
      value: units ? `${value} ${units}` : value,
    }
  }),
)

/**
 * Spool ids are the one auxiliary shape every printer with Alabaster's own
 * Spoolman integration already records, whether or not it declares a single
 * `history_field_*` of its own — so it gets a readable phrase rather than the
 * generic "field: value" fallback everything else uses.
 */
function formatJobAuxiliary(entry: HistoryJobAuxiliaryValue): string {
  if (entry.provider === 'spoolman' && entry.field === 'spool_ids' && Array.isArray(entry.value)) {
    const ids = entry.value
    if (ids.length === 0) return ''
    return ids.length === 1
      ? t('history.jobs.auxiliary.spool', { id: ids[0] })
      : t('history.jobs.auxiliary.spools', { ids: ids.join(', ') })
  }
  const value = Array.isArray(entry.value)
    ? entry.value.map((item) => numberFormatter.value.format(item)).join(', ')
    : numberFormatter.value.format(entry.value)
  return entry.units
    ? `${entry.description}: ${value} ${entry.units}`
    : `${entry.description}: ${value}`
}

/**
 * Recomputed when the window, period or measure changes — not on a live
 * clock tick. A calendar bucket's boundary only moves at the next day, week
 * or month, so this page has no reason to re-derive it every second the way
 * a live telemetry chart does.
 */
const trendBuckets = computed(() =>
  historyTrend(history.windowJobs, {
    period: history.period,
    now: Math.floor(Date.now() / 1000),
  }),
)

const distributionBins = computed(() => lengthDistribution(history.windowJobs))

function formatDistributionRange(bin: LengthDistributionBin): string {
  const lower = formatDuration(bin.lowerBound)
  if (bin.upperBound === null) return t('history.stats.distribution.rangeOpen', { lower })
  return t('history.stats.distribution.range', { lower, upper: formatDuration(bin.upperBound) })
}

/**
 * The one shape every figure on this page renders in: a number set large and
 * its unit beside it, small. Kept as parts rather than a formatted string so
 * the unit can be styled without parsing a translation back apart.
 */
interface ValuePart {
  value: string
  unit: string
}

function durationParts(seconds: number): ValuePart[] {
  if (!Number.isFinite(seconds) || seconds <= 0) return [{ value: t('history.noValue'), unit: '' }]
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const minutePart = { value: String(minutes), unit: t('history.unit.minutes') }
  return hours > 0
    ? [{ value: numberFormatter.value.format(hours), unit: t('history.unit.hours') }, minutePart]
    : [minutePart]
}

function filamentParts(millimetres: number): ValuePart[] {
  if (!Number.isFinite(millimetres) || millimetres <= 0) {
    return [{ value: t('history.noValue'), unit: '' }]
  }
  return [
    { value: numberFormatter.value.format(millimetres / 1000), unit: t('history.unit.metres') },
  ]
}

/** Heat-up and pauses: the gap between occupied and printing time, only visible with both. */
const overheadSeconds = computed(() =>
  Math.max(0, history.totals.totalTime - history.totals.printTime),
)
const overheadShare = computed(() =>
  history.totals.totalTime > 0
    ? percentFormatter.value.format(overheadSeconds.value / history.totals.totalTime)
    : t('history.noValue'),
)

const windowCompletedCount = computed(
  () => history.windowJobs.filter((job) => job.outcome === 'completed').length,
)

const successRateValue = computed(() =>
  history.windowSuccessRate === null
    ? t('history.noValue')
    : String(Math.round(history.windowSuccessRate * 100)),
)

const typicalPrint = computed(() => typicalPrintDuration(history.windowJobs))
const estimateReading = computed(() => estimateDeviation(history.windowJobs))
const signedPercentFormatter = computed(
  () =>
    new Intl.NumberFormat(locale.value, {
      style: 'percent',
      maximumFractionDigits: 0,
      signDisplay: 'exceptZero',
    }),
)
const signedNumberFormatter = computed(
  () =>
    new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0, signDisplay: 'exceptZero' }),
)

/*
 * "Today" and "Yesterday" move at midnight, so the day labels read a clock
 * that ticks once a minute rather than the time the page happened to render.
 */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 60_000)
})
onBeforeUnmount(() => clearInterval(clock))

const dayFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }),
)
/** Follows the 12- or 24-hour choice in Settings, which a bare `Intl` formatter would not. */
const timeFormatter = computed(() => createTimeFormatter(locale.value))
const shortDateTimeFormatter = computed(() => {
  const hourCycle = timeFormatter.value.resolvedOptions().hourCycle
  return new Intl.DateTimeFormat(locale.value, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...(hourCycle ? { hourCycle } : {}),
  })
})

function jobMoment(job: HistoryJob): number | null {
  const seconds = job.endedAt ?? job.startedAt
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
}

function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * Jobs grouped under the day they ended, newest first as the store already
 * keeps them. A row then needs only its time of day, which is what made the
 * old list's "Monday, October 12 2026 12:26 AM" on every row redundant.
 */
const jobGroups = computed(() => {
  const today = startOfDay(now.value)
  const yesterday = today - 86_400_000
  const groups: { key: string; label: string; jobs: { job: HistoryJob; time: string }[] }[] = []
  for (const job of history.jobs) {
    const moment = jobMoment(job)
    const day = moment === null ? null : startOfDay(moment)
    const key = day === null ? 'unknown' : String(day)
    let group = groups.at(-1)
    if (!group || group.key !== key) {
      const label =
        day === null
          ? t('history.noValue')
          : day === today
            ? t('history.jobs.today')
            : day === yesterday
              ? t('history.jobs.yesterday')
              : dayFormatter.value.format(day)
      group = { key, label, jobs: [] }
      groups.push(group)
    }
    group.jobs.push({
      job,
      time: moment === null ? t('history.noValue') : timeFormatter.value.format(moment),
    })
  }
  return groups
})

/*
 * The next page loads as the end of the list comes within reach, so reading
 * back through a long history is one continuous scroll. The marker is the
 * list's last 30rem rather than its final pixel: at wide widths the list is its
 * own scroll region, and an observer's `rootMargin` stretches only the
 * viewport, never a scroll container between it and the target, so the lead
 * has to be part of what is observed. The button at the end stays, as the
 * pending state while a page loads and as the retry after one failed — a
 * failure stops the automatic loading rather than repeating it.
 */
const listEnd = ref<HTMLElement | null>(null)
const listEndInView = ref(false)
const listEndObserver =
  typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1]
        if (entry) listEndInView.value = entry.isIntersecting
      })

watch(
  listEnd,
  (element, previous) => {
    if (previous) listEndObserver?.unobserve(previous)
    if (element) listEndObserver?.observe(element)
    else listEndInView.value = false
  },
  { flush: 'post' },
)

onBeforeUnmount(() => listEndObserver?.disconnect())

/**
 * One page, then a fresh look at the marker. The sighting that asked for the
 * page is spent before the request goes out, and the marker is observed anew
 * once the page has landed, so only a measurement taken after the new rows were
 * laid out can ask for the next one. Re-arming on the loading flag instead
 * acted on the sighting from before the rows arrived — one page too many every
 * time, and in a hidden tab, where the observer reports nothing at all, every
 * page Moonraker holds, one after another.
 */
async function loadNextPage(): Promise<void> {
  listEndInView.value = false
  await history.loadMore()
  const element = listEnd.value
  if (!element || !listEndObserver) return
  listEndObserver.unobserve(element)
  listEndObserver.observe(element)
}

watch(
  () =>
    listEndInView.value &&
    history.hasMore &&
    !history.isLoading &&
    !history.failed &&
    moonrakerAvailability.value.isAvailable,
  (ready) => {
    if (ready) void loadNextPage()
  },
)

function formatMoment(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return t('history.noValue')
  return shortDateTimeFormatter.value.format(seconds * 1000)
}

function thumbnailUrl(job: HistoryJob, path: string | null): string | null {
  if (!path) return null
  try {
    return moonrakerThumbnailUrl(job.filename, path, moonraker.endpoint)
  } catch {
    return null
  }
}

/** "slicer said 1h 0m, +12%": how far this print ran past its own estimate. */
function estimateNote(job: HistoryJob): string | null {
  const estimate = job.details.estimatedTime
  if (!estimate || job.printDuration <= 0) return null
  return t('history.jobs.detail.estimate', {
    estimate: formatDuration(estimate),
    deviation: signedPercentFormatter.value.format((job.printDuration - estimate) / estimate),
  })
}

const measurementFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }),
)

const canReprint = computed(
  () => moonrakerAvailability.value.isAvailable && !printer.hasActivePrint,
)

/**
 * Queuing behind a running job is the entire point of the queue, so — unlike
 * reprinting — this stays enabled while a print is active, the same
 * distinction Print Files' own `canQueueSelected` draws.
 */
const canQueueJob = computed(
  () => moonrakerAvailability.value.isAvailable && !jobQueue.pendingCommands.add,
)

/**
 * The same silence Print files' own enqueue answers: the queue is a card on
 * another page, this detail pane does not move, and a successful post looks
 * exactly like a failed one from here — so the control confirms on itself for
 * a second. Raised from what `addJob` answered rather than from having called
 * it, since a refusal comes back as `false` rather than as a throw.
 */
const queueConfirmed = ref(false)

async function queueJob(job: HistoryJob): Promise<void> {
  queueConfirmed.value = await jobQueue.addJob(job.filename)
}

const deletingJob = ref<HistoryJob | null>(null)
const reprintingJob = ref<HistoryJob | null>(null)

/**
 * Which job the list has opened beneath its row, kept here rather than in the
 * store since it is this page's own view state, not data any other surface
 * reads. Choosing the open job again closes it.
 */
const selectedJob = ref<HistoryJob | null>(null)

function toggleJob(job: HistoryJob): void {
  selectedJob.value = selectedJob.value?.id === job.id ? null : job
  // A confirmation names the job that was on screen when it was earned. Moving
  // to another one mid-cooldown would leave "Added to queue" sitting over a
  // file nobody enqueued.
  queueConfirmed.value = false
}

async function confirmDelete(): Promise<void> {
  const job = deletingJob.value
  deletingJob.value = null
  if (!job) return
  await history.deleteJob(job.id)
  if (selectedJob.value?.id === job.id) selectedJob.value = null
}

function requestDelete(job: HistoryJob): void {
  if (deleteJobGuard.guarded.value) deletingJob.value = job
  else void history.deleteJob(job.id)
}

async function confirmReprint(): Promise<void> {
  const job = reprintingJob.value
  reprintingJob.value = null
  if (job) await printer.startPrint(job.filename)
}

function requestReprint(job: HistoryJob): void {
  if (reprintGuard.guarded.value) reprintingJob.value = job
  else void printer.startPrint(job.filename)
}
</script>

<template>
  <section ref="pageRoot" class="standard-page history-view">
    <PageHeading :title="t('history.title')" />

    <!--
      `flex-1` without `min-h-0`, deliberately: the grow keeps the unavailable
      placeholder filling the page, while the default `min-height: auto` keeps
      the region at least as tall as its content: the whole job list where the
      cards stack, the statistics card where they sit side by side and the job
      list scrolls on its own. With `min-h-0` the region
      stayed capped at the viewport leftover and the list overflowed its box —
      and overflowing content slides past `.standard-page`'s `padding-bottom`,
      which pads only in-flow boxes, so a fully-scrolled page ended flush
      against its bottom edge with no air.
    -->
    <AvailabilityRegion requires="moonraker" class="flex-1">
      <section
        class="machine-status-panel history-lifetime selectable"
        :aria-label="t('history.totals.title')"
      >
        <div class="machine-host__layout">
          <div class="machine-host__identity">
            <AppIcon name="history" aria-hidden="true" />
            <div class="min-w-0">
              <h2 class="machine-host__name">
                {{ t('history.totals.headline', { count: history.totals.jobs }) }}
              </h2>
              <p class="machine-host__meta">{{ t('history.totals.meta') }}</p>
            </div>
          </div>
          <dl class="machine-host__stats">
            <div class="machine-stat">
              <dt>
                <AppIcon name="history" aria-hidden="true" />{{ t('history.totals.printing') }}
              </dt>
              <dd class="machine-stat__value">
                <template v-for="part in durationParts(history.totals.printTime)" :key="part.unit">
                  <strong>{{ part.value }}</strong
                  ><span>{{ part.unit }}</span>
                </template>
              </dd>
              <dd class="machine-stat__detail">{{ t('history.totals.printingDetail') }}</dd>
            </div>
            <!--
              Beside print time on purpose: the gap between the two is heat-up
              and pauses, and it is only visible when both are on the strip
              together — which is why the gap is the third cell.
            -->
            <div class="machine-stat">
              <dt>
                <AppIcon name="history" aria-hidden="true" />{{ t('history.totals.occupied') }}
              </dt>
              <dd class="machine-stat__value">
                <template v-for="part in durationParts(history.totals.totalTime)" :key="part.unit">
                  <strong>{{ part.value }}</strong
                  ><span>{{ part.unit }}</span>
                </template>
              </dd>
              <dd class="machine-stat__detail">{{ t('history.totals.occupiedDetail') }}</dd>
            </div>
            <div class="machine-stat">
              <dt><AppIcon name="pause" aria-hidden="true" />{{ t('history.totals.overhead') }}</dt>
              <dd class="machine-stat__value">
                <template v-for="part in durationParts(overheadSeconds)" :key="part.unit">
                  <strong>{{ part.value }}</strong
                  ><span>{{ part.unit }}</span>
                </template>
              </dd>
              <dd class="machine-stat__detail">
                {{ t('history.totals.overheadDetail', { share: overheadShare }) }}
              </dd>
            </div>
            <div class="machine-stat">
              <dt><AppIcon name="spool" aria-hidden="true" />{{ t('history.totals.filament') }}</dt>
              <dd class="machine-stat__value">
                <template
                  v-for="part in filamentParts(history.totals.filamentUsed)"
                  :key="part.unit"
                >
                  <strong>{{ part.value }}</strong
                  ><span>{{ part.unit }}</span>
                </template>
              </dd>
              <dd class="machine-stat__detail">{{ t('history.totals.filamentDetail') }}</dd>
            </div>
            <div class="machine-stat">
              <dt>
                <AppIcon name="layerNext" aria-hidden="true" />{{
                  t('history.totals.longestPrint')
                }}
              </dt>
              <dd class="machine-stat__value">
                <template
                  v-for="part in durationParts(history.totals.longestPrint)"
                  :key="part.unit"
                >
                  <strong>{{ part.value }}</strong
                  ><span>{{ part.unit }}</span>
                </template>
              </dd>
              <dd class="machine-stat__detail">{{ t('history.totals.longestDetail') }}</dd>
            </div>
            <!--
              Only ever what a `[sensor ...]` section actually declared — a
              printer with none renders no extra cells at all.
            -->
            <div v-for="total in auxiliaryTotalRows" :key="total.key" class="machine-stat">
              <dt>{{ total.description }}</dt>
              <dd class="machine-stat__value">
                <strong>{{ total.value }}</strong>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <div class="history-grid">
        <section
          class="machine-status-panel machine-list-panel history-jobs-panel"
          aria-labelledby="history-jobs-title"
        >
          <header class="machine-panel-heading">
            <AppIcon name="history" class="size-5 text-action" aria-hidden="true" />
            <h2 id="history-jobs-title">{{ t('history.jobs.title') }}</h2>
            <div class="machine-panel-heading__actions">
              <AppButton
                size="sm"
                icon-only
                :pending="history.isLoading"
                :icon="history.isLoading ? 'spinner' : 'refresh'"
                :disabled="!moonrakerAvailability.isAvailable"
                :aria-label="t('history.jobs.refresh')"
                :title="t('history.jobs.refresh')"
                @click="history.refresh()"
              />
            </div>
          </header>

          <p v-if="history.hasJobs" class="machine-panel-summary">
            {{
              t('history.jobs.summary', {
                loaded: history.jobs.length,
                total: numberFormatter.format(history.totals.jobs),
              })
            }}
          </p>

          <p v-if="history.failed" class="calibration-notice" role="status">
            <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ t('history.jobs.failed') }}</span>
          </p>

          <div v-if="history.hasJobs" class="machine-list machine-list--media history-jobs-list">
            <template v-for="group in jobGroups" :key="group.key">
              <p class="machine-list__label">{{ group.label }}</p>
              <template v-for="entry in group.jobs" :key="entry.job.id">
                <HistoryJobRow
                  :job="entry.job"
                  :time="entry.time"
                  :selected="entry.job.id === selectedJob?.id"
                  :thumbnail-url="thumbnailUrl(entry.job, entry.job.details.thumbnailSmall)"
                  :can-reprint="canReprint"
                  :can-queue="canQueueJob"
                  :can-delete="moonrakerAvailability.isAvailable"
                  :reprint-guard="menuReprintGuard"
                  :delete-guard="deleteJobGuard"
                  @select="toggleJob(entry.job)"
                  @reprint="requestReprint(entry.job)"
                  @queue="queueJob(entry.job)"
                  @remove="requestDelete(entry.job)"
                />
                <!--
                  The open job's details, under its own row rather than in a
                  pane beside the list: the pane had to be pinned and capped to
                  stay reachable beside a list fifty rows long, and on a phone
                  it replaced the list outright. Under the row, it is where the
                  reader is already looking at every width.
                -->
                <div
                  v-if="entry.job.id === selectedJob?.id"
                  :id="`history-job-${entry.job.id}`"
                  class="machine-row-expansion"
                >
                  <img
                    v-if="thumbnailUrl(entry.job, entry.job.details.thumbnailLarge)"
                    :src="thumbnailUrl(entry.job, entry.job.details.thumbnailLarge) ?? undefined"
                    alt=""
                  />
                  <span v-else class="machine-row-expansion__placeholder" aria-hidden="true"></span>
                  <dl class="machine-row-facts selectable">
                    <div>
                      <dt>{{ t('history.jobs.detail.started') }}</dt>
                      <dd>{{ formatMoment(entry.job.startedAt) }}</dd>
                    </div>
                    <div>
                      <dt>{{ t('history.jobs.detail.ended') }}</dt>
                      <dd>{{ formatMoment(entry.job.endedAt) }}</dd>
                    </div>
                    <div>
                      <dt>{{ t('history.jobs.detail.printDuration') }}</dt>
                      <dd>
                        {{ formatDuration(entry.job.printDuration) }}
                        <span v-if="estimateNote(entry.job)">{{
                          t('machine.updates.detailJoin', {
                            first: '',
                            second: estimateNote(entry.job),
                          })
                        }}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>{{ t('history.jobs.detail.occupiedTime') }}</dt>
                      <dd>
                        {{ formatDuration(entry.job.totalDuration) }}
                        <span v-if="entry.job.totalDuration > entry.job.printDuration">{{
                          t('machine.updates.detailJoin', {
                            first: '',
                            second: t('history.jobs.detail.heatUp', {
                              value: formatDuration(
                                entry.job.totalDuration - entry.job.printDuration,
                              ),
                            }),
                          })
                        }}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>{{ t('history.jobs.detail.filament') }}</dt>
                      <dd>
                        {{ formatFilament(entry.job.filamentUsed) }}
                        <span v-if="entry.job.details.filamentWeight">{{
                          t('machine.updates.detailJoin', {
                            first: '',
                            second: t('history.jobs.detail.weight', {
                              value: numberFormatter.format(entry.job.details.filamentWeight),
                            }),
                          })
                        }}</span>
                      </dd>
                    </div>
                    <div v-if="entry.job.details.filamentType">
                      <dt>{{ t('history.jobs.detail.material') }}</dt>
                      <dd>
                        {{ entry.job.details.filamentType }}
                        <span v-if="entry.job.details.filamentName">{{
                          t('machine.updates.detailJoin', {
                            first: '',
                            second: entry.job.details.filamentName,
                          })
                        }}</span>
                      </dd>
                    </div>
                    <div v-if="entry.job.details.layerHeight">
                      <dt>{{ t('history.jobs.detail.layers') }}</dt>
                      <dd>
                        {{
                          t('history.jobs.detail.layerHeight', {
                            value: measurementFormatter.format(entry.job.details.layerHeight),
                          })
                        }}
                        <span v-if="entry.job.details.objectHeight">{{
                          t('machine.updates.detailJoin', {
                            first: '',
                            second: t('history.jobs.detail.objectHeight', {
                              value: measurementFormatter.format(entry.job.details.objectHeight),
                            }),
                          })
                        }}</span>
                      </dd>
                    </div>
                    <div v-if="entry.job.details.slicer">
                      <dt>{{ t('history.jobs.detail.slicer') }}</dt>
                      <dd>{{ entry.job.details.slicer }}</dd>
                    </div>
                    <template
                      v-for="aux in entry.job.auxiliaryData"
                      :key="`${aux.provider}-${aux.field}`"
                    >
                      <div v-if="formatJobAuxiliary(aux)">
                        <dt>{{ aux.description || aux.field }}</dt>
                        <dd>{{ formatJobAuxiliary(aux) }}</dd>
                      </div>
                    </template>
                  </dl>
                  <div class="machine-row-actions">
                    <AppButton
                      size="sm"
                      :guard="reprintGuard"
                      icon="print"
                      :label="t('history.jobs.reprint')"
                      :disabled="!canReprint || !entry.job.fileExists"
                      :title="entry.job.fileExists ? undefined : t('history.jobs.fileGone')"
                      @click="requestReprint(entry.job)"
                    />
                    <AppButton
                      size="sm"
                      :pending="jobQueue.pendingCommands.add"
                      icon="jobs"
                      :label="t('history.jobs.detail.addToQueue')"
                      :disabled="!canQueueJob || !entry.job.fileExists"
                      :title="entry.job.fileExists ? undefined : t('history.jobs.fileGone')"
                      :cooldown="queueConfirmed"
                      :cooldown-ms="1000"
                      :cooldown-label="t('history.jobs.detail.addedToQueue')"
                      cooldown-icon="check"
                      @cooldown-end="queueConfirmed = false"
                      @click="queueJob(entry.job)"
                    />
                    <AppButton
                      size="sm"
                      :guard="deleteJobGuard"
                      icon="trash"
                      :label="t('history.jobs.delete')"
                      :disabled="!moonrakerAvailability.isAvailable"
                      @click="requestDelete(entry.job)"
                    />
                  </div>
                </div>
              </template>
            </template>
            <div
              v-if="history.hasMore"
              ref="listEnd"
              class="history-jobs__end"
              aria-hidden="true"
            ></div>
            <div v-if="history.hasMore" class="machine-list__fold">
              <AppButton
                variant="quiet"
                size="sm"
                block
                :pending="history.isLoading"
                :label="t('history.jobs.loadMore')"
                :disabled="history.isLoading"
                @click="loadNextPage()"
              />
            </div>
          </div>
          <p v-else-if="!history.isLoading" class="machine-panel-empty">
            {{ t('history.jobs.empty') }}
          </p>
        </section>

        <section
          class="machine-status-panel history-stats-panel"
          aria-labelledby="history-stats-title"
        >
          <header class="machine-panel-heading">
            <AppIcon name="chartBars" class="size-5 text-action" aria-hidden="true" />
            <h2 id="history-stats-title">{{ t('history.stats.title') }}</h2>
            <div class="machine-panel-heading__actions">
              <div class="segmented" role="group" :aria-label="t('history.stats.period.label')">
                <AppButton
                  v-for="option in periodOptions"
                  :key="option"
                  size="sm"
                  mono
                  :aria-pressed="history.period === option"
                  @click="history.setPeriod(option)"
                >
                  {{ t(`history.stats.period.option.${option}`) }}
                </AppButton>
              </div>
            </div>
          </header>
          <p class="machine-panel-summary">{{ periodJobCountLabel }}</p>

          <p v-if="history.windowFailed" class="calibration-notice" role="status">
            <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ t('history.stats.failed') }}</span>
          </p>

          <template v-else-if="history.windowJobs.length > 0">
            <!--
              Each figure names its population in its own line, per the History
              contract: the success rate over every job in the window, the two
              medians over the completed jobs they could be measured on.
            -->
            <dl class="machine-host__stats">
              <div class="machine-stat">
                <dt>{{ t('history.stats.successRateLabel') }}</dt>
                <dd class="machine-stat__value">
                  <strong>{{ successRateValue }}</strong
                  ><span v-if="history.windowSuccessRate !== null">{{
                    t('history.unit.percent')
                  }}</span>
                </dd>
                <dd class="machine-stat__detail">
                  {{
                    t('history.stats.successRateDetail', {
                      completed: windowCompletedCount,
                      count: history.windowJobs.length,
                    })
                  }}
                </dd>
              </div>
              <div class="machine-stat">
                <dt>{{ t('history.stats.typical') }}</dt>
                <dd class="machine-stat__value">
                  <template
                    v-for="part in durationParts(typicalPrint?.value ?? 0)"
                    :key="part.unit"
                  >
                    <strong>{{ part.value }}</strong
                    ><span>{{ part.unit }}</span>
                  </template>
                </dd>
                <dd v-if="typicalPrint" class="machine-stat__detail">
                  {{ t('history.stats.typicalDetail', { count: typicalPrint.jobs }) }}
                </dd>
              </div>
              <div class="machine-stat">
                <dt>{{ t('history.stats.estimate') }}</dt>
                <dd class="machine-stat__value">
                  <strong>{{
                    estimateReading
                      ? signedNumberFormatter.format(Math.round(estimateReading.value * 100))
                      : t('history.noValue')
                  }}</strong
                  ><span v-if="estimateReading">{{ t('history.unit.percent') }}</span>
                </dd>
                <dd v-if="estimateReading" class="machine-stat__detail">
                  {{ t('history.stats.estimateDetail', { count: estimateReading.jobs }) }}
                </dd>
              </div>
            </dl>

            <div class="history-stats-section">
              <div class="history-stats-section__head">
                <h3 class="text-section-title">{{ t('history.stats.outcomesTitle') }}</h3>
                <div class="segmented" role="group" :aria-label="t('history.stats.measure.label')">
                  <AppButton
                    v-for="option in measureOptions"
                    :key="option"
                    size="sm"
                    :aria-pressed="measure === option"
                    @click="measure = option"
                  >
                    {{ t(`history.stats.measure.${option}`) }}
                  </AppButton>
                </div>
              </div>
              <div class="module-table history-outcome-table">
                <div class="module-table__head">
                  <span>{{ t('history.stats.outcomes.columnOutcome') }}</span>
                  <span class="text-end">{{ t('history.stats.outcomes.columnJobs') }}</span>
                  <span class="text-end">{{ t('history.stats.outcomes.columnShare') }}</span>
                  <span class="text-end">{{ t('history.stats.outcomes.columnFilament') }}</span>
                  <span class="text-end">{{ t('history.stats.outcomes.columnTime') }}</span>
                </div>
                <div v-for="entry in outcomeRows" :key="entry.outcome" class="module-table__row">
                  <span class="module-table__name">
                    <span
                      class="history-job__outcome"
                      :class="`history-job__outcome--${entry.outcome}`"
                    >
                      <AppIcon
                        :name="historyOutcomeIcon(entry.outcome)"
                        class="size-3.5"
                        aria-hidden="true"
                      />
                      {{ t(`history.outcome.${entry.outcome}`) }}
                    </span>
                  </span>
                  <span class="module-table__value">{{ numberFormatter.format(entry.jobs) }}</span>
                  <span class="module-table__value">{{ outcomeShareLabel(entry) }}</span>
                  <span class="module-table__value">{{ formatFilament(entry.filamentUsed) }}</span>
                  <span class="module-table__value">{{ formatDuration(entry.printTime) }}</span>
                </div>
              </div>
            </div>

            <div class="history-stats-section">
              <h3 class="text-section-title">{{ t('history.stats.trend.title') }}</h3>
              <HistoryTrendChart :buckets="trendBuckets" :measure="measure" />
            </div>

            <div v-if="distributionBins.length > 0" class="history-stats-section">
              <h3 class="text-section-title">{{ t('history.stats.distribution.title') }}</h3>
              <ul class="history-distribution">
                <li
                  v-for="bin in distributionBins"
                  :key="bin.lowerBound"
                  class="history-distribution__row"
                >
                  <span class="history-distribution__range">{{
                    formatDistributionRange(bin)
                  }}</span>
                  <span class="history-distribution__count">{{
                    t('history.stats.distribution.jobCount', { count: bin.jobs })
                  }}</span>
                </li>
              </ul>
            </div>
          </template>
          <p v-else-if="!history.windowLoading" class="machine-panel-empty">
            {{ t('history.stats.outcomes.empty') }}
          </p>
        </section>
      </div>
    </AvailabilityRegion>

    <ConfirmDialog
      :open="deletingJob !== null"
      :title="t('history.jobs.deleteTitle')"
      :description="
        t('history.jobs.deleteConfirm', { name: shortName(deletingJob?.filename ?? '') })
      "
      :confirm-label="t('history.jobs.delete')"
      tone="danger"
      show-skip-option
      @confirm="confirmDelete"
      @cancel="deletingJob = null"
      @skip="confirmations.setSkip('deleteHistoryJob', true)"
    />
    <ConfirmDialog
      :open="reprintingJob !== null"
      :title="t('history.jobs.reprintTitle')"
      :description="
        t('history.jobs.reprintConfirm', { name: shortName(reprintingJob?.filename ?? '') })
      "
      :confirm-label="t('history.jobs.reprint')"
      show-skip-option
      @confirm="confirmReprint"
      @cancel="reprintingJob = null"
      @skip="confirmations.setSkip('reprintJob', true)"
    />
  </section>
</template>
