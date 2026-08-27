<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import HistoryJobRow from '@/components/history/HistoryJobRow.vue'
import HistoryTrendChart from '@/components/history/HistoryTrendChart.vue'
import PageHeading from '@/components/PageHeading.vue'
import { useAvailability } from '@/composables/useAvailability'
import { formatHistoryDuration, formatHistoryFilament } from '@/features/history/format'
import { historyOutcomeIcon } from '@/features/history/outcome'
import {
  historyPeriods,
  historyTrend,
  lengthDistribution,
  outcomeBreakdown,
  outcomeMeasureValue,
  type HistoryPeriod,
  type HistoryStatsMeasure,
  type LengthDistributionBin,
  type OutcomeBreakdown,
} from '@/features/history/statistics'
import { createDateTimeFormatter } from '@/i18n/formats'
import { useActionGuard } from '@/composables/useActionGuard'
import {
  useHistoryStore,
  type HistoryAuxiliaryTotal,
  type HistoryJob,
  type HistoryJobAuxiliaryValue,
} from '@/stores/history'
import { useJobQueueStore } from '@/stores/jobQueue'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'

const { locale, t } = useI18n({ useScope: 'global' })
const history = useHistoryStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
/*
 * Reprinting commits the machine to a job; deleting a record destroys one. Same
 * tier, different emphasis, and the escalation is one step from each.
 */
const reprintGuard = useActionGuard({ tier: 'terminal', emphasis: 'primary', key: 'reprintJob' })
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

const pageRoot = useTemplateRef<HTMLElement>('pageRoot')

// Optional-called, so an environment without matchMedia still animates
// rather than silently losing the motion — as `dashboard/reveal.ts` does.
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * `.standard-page` is the scroll container, not the window — its own
 * `overflow: auto` is what makes the job list's length scrollable at all —
 * so this scrolls that element rather than `window.scrollTo`, which would be
 * a no-op here.
 */
function scrollToTop(): void {
  pageRoot.value?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)
const percentFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }),
)
const dateFormatter = computed(() => createDateTimeFormatter(locale.value))

function formatDuration(seconds: number): string {
  return formatHistoryDuration(seconds, t)
}

function formatFilament(millimetres: number): string {
  return formatHistoryFilament(millimetres, t, locale.value)
}

function formatWhen(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return t('history.noValue')
  return dateFormatter.value.format(seconds * 1000)
}

function shortName(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator < 0 ? path : path.slice(separator + 1)
}

/**
 * Computed over the statistics window, never over the job list's own
 * paginated cursor: the rate has to be honest about the population it was
 * drawn from, and a scroll position cannot state one — see the History
 * contract in `docs/design/interface-standards.md`.
 */
const windowSuccessRateLabel = computed(() =>
  history.windowSuccessRate === null
    ? t('history.noValue')
    : percentFormatter.value.format(history.windowSuccessRate),
)

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

async function queueJob(job: HistoryJob): Promise<void> {
  await jobQueue.addJob(job.filename)
}

const deletingJob = ref<HistoryJob | null>(null)
const reprintingJob = ref<HistoryJob | null>(null)

/**
 * Which job the row list has opened into the detail pane — mirroring Print
 * Files' own `selectedFile`, kept here rather than in the store since it is
 * this page's own view state, not data any other surface reads.
 */
const selectedJob = ref<HistoryJob | null>(null)

function selectJob(job: HistoryJob): void {
  selectedJob.value = job
}

function closeJobDetail(): void {
  selectedJob.value = null
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
      the region at least as tall as the job list. With `min-h-0` the region
      stayed capped at the viewport leftover and the list overflowed its box —
      and overflowing content slides past `.standard-page`'s `padding-bottom`,
      which pads only in-flow boxes, so a fully-scrolled page ended flush
      against its bottom edge with no air.
    -->
    <AvailabilityRegion requires="moonraker" class="flex-1">
      <div class="page-column">
        <section class="page-card history-totals" :aria-label="t('history.totals.title')">
          <h2 class="calibration-panel__title">{{ t('history.totals.title') }}</h2>
          <dl class="history-totals__grid">
            <div class="history-total">
              <dt>{{ t('history.totals.jobs') }}</dt>
              <dd>{{ numberFormatter.format(history.totals.jobs) }}</dd>
            </div>
            <div class="history-total">
              <dt>{{ t('history.totals.printTime') }}</dt>
              <dd>{{ formatDuration(history.totals.printTime) }}</dd>
            </div>
            <!--
              Beside print time on purpose: the gap between the two is heat-up
              and pauses, and it is only visible when both are on the card
              together.
            -->
            <div class="history-total">
              <dt>{{ t('history.totals.occupiedTime') }}</dt>
              <dd>{{ formatDuration(history.totals.totalTime) }}</dd>
            </div>
            <div class="history-total">
              <dt>{{ t('history.totals.filament') }}</dt>
              <dd>{{ formatFilament(history.totals.filamentUsed) }}</dd>
            </div>
            <div class="history-total">
              <dt>{{ t('history.totals.longestPrint') }}</dt>
              <dd>{{ formatDuration(history.totals.longestPrint) }}</dd>
            </div>
            <!--
              Only ever what a `[sensor ...]` section actually declared — a
              printer with none renders no extra rows at all.
            -->
            <div v-for="total in auxiliaryTotalRows" :key="total.key" class="history-total">
              <dt>{{ total.description }}</dt>
              <dd>{{ total.value }}</dd>
            </div>
          </dl>
        </section>

        <section class="page-card history-stats" :aria-label="t('history.stats.title')">
          <header class="calibration-panel__header">
            <h2 class="calibration-panel__title">{{ t('history.stats.title') }}</h2>
          </header>

          <div class="history-stats__control">
            <span class="history-stats__control-label">{{ t('history.stats.period.label') }}</span>
            <div class="segmented" role="group" :aria-label="t('history.stats.period.label')">
              <button
                v-for="option in periodOptions"
                :key="option"
                type="button"
                class="button button--sm button--value"
                :aria-pressed="history.period === option"
                @click="history.setPeriod(option)"
              >
                {{ t(`history.stats.period.option.${option}`) }}
              </button>
            </div>
            <span class="history-stats__population">{{ periodJobCountLabel }}</span>
          </div>

          <p v-if="history.windowFailed" class="calibration-notice" role="status">
            <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ t('history.stats.failed') }}</span>
          </p>

          <template v-else-if="history.windowJobs.length > 0">
            <dl class="history-stats__row">
              <dt>{{ t('history.stats.successRate', { count: history.windowJobs.length }) }}</dt>
              <dd>{{ windowSuccessRateLabel }}</dd>
            </dl>

            <div class="history-stats__control">
              <span class="history-stats__control-label">{{
                t('history.stats.measure.label')
              }}</span>
              <div class="segmented" role="group" :aria-label="t('history.stats.measure.label')">
                <button
                  v-for="option in measureOptions"
                  :key="option"
                  type="button"
                  class="button button--sm"
                  :aria-pressed="measure === option"
                  @click="measure = option"
                >
                  {{ t(`history.stats.measure.${option}`) }}
                </button>
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

            <div class="history-stats__trend">
              <h3 class="text-section-title">{{ t('history.stats.trend.title') }}</h3>
              <HistoryTrendChart :buckets="trendBuckets" :measure="measure" />
            </div>

            <div v-if="distributionBins.length > 0" class="history-stats__distribution">
              <h3 class="text-section-title">
                {{ t('history.stats.distribution.title') }}
              </h3>
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
          <p v-else-if="!history.windowLoading" class="calibration-panel__hint">
            {{ t('history.stats.outcomes.empty') }}
          </p>
        </section>

        <section class="page-card history-panel" :aria-label="t('history.jobs.title')">
          <header class="calibration-panel__header">
            <h2 class="calibration-panel__title">{{ t('history.jobs.title') }}</h2>
            <button
              type="button"
              class="button button--xs"
              :disabled="!moonrakerAvailability.isAvailable"
              :data-pending="history.isLoading ? 'true' : undefined"
              @click="history.refresh()"
            >
              <AppIcon name="refresh" class="size-4" aria-hidden="true" />
              {{ t('history.jobs.refresh') }}
            </button>
          </header>

          <p v-if="history.failed" class="calibration-notice" role="status">
            <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ t('history.jobs.failed') }}</span>
          </p>

          <div
            v-if="history.hasJobs"
            class="history-jobs-workspace"
            :class="{ 'history-jobs-workspace--detail-open': selectedJob !== null }"
          >
            <div class="history-jobs-browser">
              <ul class="history-jobs">
                <li v-for="job in history.jobs" :key="job.id">
                  <HistoryJobRow
                    :job="job"
                    :selected="job.id === selectedJob?.id"
                    @select="selectJob(job)"
                  />
                </li>
              </ul>

              <div v-if="history.hasMore" class="history-jobs__load-row">
                <button
                  type="button"
                  class="button button--sm"
                  :disabled="history.isLoading"
                  :data-pending="history.isLoading ? 'true' : undefined"
                  @click="history.loadMore()"
                >
                  {{ t('history.jobs.loadMore') }}
                </button>
                <button
                  type="button"
                  class="button button--quiet button--sm button--icon"
                  :aria-label="t('history.jobs.scrollToTop')"
                  :title="t('history.jobs.scrollToTop')"
                  @click="scrollToTop"
                >
                  <AppIcon name="up" class="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <section
              v-if="selectedJob"
              class="history-job-detail"
              :aria-label="shortName(selectedJob.filename)"
            >
              <header class="history-job-detail__header">
                <h3 class="min-w-0 break-words text-dialog-title">
                  {{ shortName(selectedJob.filename) }}
                </h3>
                <button
                  type="button"
                  class="button button--quiet button--xs button--icon"
                  :aria-label="t('history.jobs.detail.close')"
                  :title="t('history.jobs.detail.close')"
                  @click="closeJobDetail"
                >
                  <AppIcon name="close" class="size-4" aria-hidden="true" />
                </button>
              </header>

              <span
                class="history-job__outcome"
                :class="`history-job__outcome--${selectedJob.outcome}`"
              >
                <AppIcon
                  :name="historyOutcomeIcon(selectedJob.outcome)"
                  class="size-3.5"
                  aria-hidden="true"
                />
                {{ t(`history.outcome.${selectedJob.outcome}`) }}
              </span>

              <dl class="history-job-detail__metadata">
                <div class="history-job-detail__row">
                  <dt>{{ t('history.jobs.detail.started') }}</dt>
                  <dd>{{ formatWhen(selectedJob.startedAt) }}</dd>
                </div>
                <div class="history-job-detail__row">
                  <dt>{{ t('history.jobs.detail.ended') }}</dt>
                  <dd>{{ formatWhen(selectedJob.endedAt) }}</dd>
                </div>
                <div class="history-job-detail__row">
                  <dt>{{ t('history.jobs.detail.printDuration') }}</dt>
                  <dd>{{ formatDuration(selectedJob.printDuration) }}</dd>
                </div>
                <div class="history-job-detail__row">
                  <dt>{{ t('history.jobs.detail.occupiedTime') }}</dt>
                  <dd>{{ formatDuration(selectedJob.totalDuration) }}</dd>
                </div>
                <div class="history-job-detail__row">
                  <dt>{{ t('history.jobs.detail.filament') }}</dt>
                  <dd>{{ formatFilament(selectedJob.filamentUsed) }}</dd>
                </div>
              </dl>

              <ul v-if="selectedJob.auxiliaryData.length > 0" class="history-job-detail__auxiliary">
                <li
                  v-for="entry in selectedJob.auxiliaryData"
                  :key="`${entry.provider}-${entry.field}`"
                >
                  {{ formatJobAuxiliary(entry) }}
                </li>
              </ul>

              <div class="history-job-detail__actions">
                <button
                  type="button"
                  class="button button--block"
                  :class="reprintGuard.variant.value"
                  v-bind="reprintGuard.bind.value"
                  :disabled="!canReprint || !selectedJob.fileExists"
                  :title="selectedJob.fileExists ? undefined : t('history.jobs.fileGone')"
                  @click="requestReprint(selectedJob)"
                >
                  <AppIcon name="print" class="size-5" aria-hidden="true" />
                  {{ t('history.jobs.reprint') }}
                </button>
                <button
                  type="button"
                  class="button button--block"
                  :disabled="!canQueueJob || !selectedJob.fileExists"
                  :title="selectedJob.fileExists ? undefined : t('history.jobs.fileGone')"
                  :data-pending="jobQueue.pendingCommands.add ? 'true' : undefined"
                  @click="queueJob(selectedJob)"
                >
                  <AppIcon name="jobs" class="size-5" aria-hidden="true" />
                  {{ t('history.jobs.detail.addToQueue') }}
                </button>
                <button
                  type="button"
                  class="button button--block"
                  :class="deleteJobGuard.variant.value"
                  v-bind="deleteJobGuard.bind.value"
                  :disabled="!moonrakerAvailability.isAvailable"
                  @click="requestDelete(selectedJob)"
                >
                  <AppIcon name="trash" class="size-5" aria-hidden="true" />
                  {{ t('history.jobs.delete') }}
                </button>
              </div>
            </section>
          </div>
          <p v-else-if="!history.isLoading" class="calibration-panel__hint">
            {{ t('history.jobs.empty') }}
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
      @confirm="confirmDelete"
      @cancel="deletingJob = null"
    />
    <ConfirmDialog
      :open="reprintingJob !== null"
      :title="t('history.jobs.reprintTitle')"
      :description="
        t('history.jobs.reprintConfirm', { name: shortName(reprintingJob?.filename ?? '') })
      "
      :confirm-label="t('history.jobs.reprint')"
      @confirm="confirmReprint"
      @cancel="reprintingJob = null"
    />
  </section>
</template>
