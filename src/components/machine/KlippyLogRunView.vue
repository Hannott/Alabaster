<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import {
  foldLines,
  runExcerpt,
  runKey,
  wasPrinting,
  type KlippyLogRow,
  type KlippyRun,
} from '@/features/machine/klippyLog'
import { createTimeFormatter } from '@/i18n/formats'
import { useToastsStore } from '@/stores/toasts'
import { copyToClipboard } from '@/utils/clipboard'
import { numberFormat } from '@/utils/intl'

type FoldRow = Extract<KlippyLogRow, { kind: 'fold' }>

const props = defineProps<{
  fileName: string
  lines: readonly string[]
  run: KlippyRun | null
  rows: readonly KlippyLogRow[]
  isLoading: boolean
  failed: boolean
}>()

const emit = defineEmits<{ retry: [] }>()

const { t, locale } = useI18n()
const toasts = useToastsStore()

const rowsList = ref<HTMLOListElement | null>(null)
/** Opened folds, keyed by run and by line within the run, so reading earlier lines keeps them open. */
const openFolds = ref(new Set<string>())

const timeFormatter = computed(() => createTimeFormatter(locale.value, { seconds: true }))

function formatTime(time: Date | null): string {
  return time ? timeFormatter.value.format(time) : ''
}

function foldKey(row: FoldRow): string {
  return props.run ? `${runKey(props.lines, props.run)}:${row.line - props.run.start}` : ''
}

function isOpen(row: FoldRow): boolean {
  return openFolds.value.has(foldKey(row))
}

function toggleFold(row: FoldRow): void {
  const key = foldKey(row)
  const next = new Set(openFolds.value)
  if (!next.delete(key)) next.add(key)
  openFolds.value = next
}

function foldLabel(row: FoldRow): string {
  if (row.fold === 'config') return t('configuration.klippyLog.folds.config')
  if (row.fold === 'rollover') return t('configuration.klippyLog.folds.rollover')
  return row.label
}

function foldCount(row: FoldRow): string {
  const count = numberFormat(locale.value).format(row.count)
  if (row.fold === 'traceback') return t('configuration.klippyLog.folds.traceback', { count })
  if (row.fold === 'similar') return t('configuration.klippyLog.folds.similar', { count })
  return t('configuration.klippyLog.folds.lines', { count }, row.count)
}

/** The reason a run ended, stated above its lines when it ended badly. */
const summary = computed(() => {
  const run = props.run
  if (!run || (run.outcome.type !== 'shutdown' && run.outcome.type !== 'error')) return null
  const at = run.outcome.line
  const endedRow = props.rows.find((row) => row.line >= at)
  const endedAt = endedRow?.time ?? null
  const seconds =
    run.startedAt && endedAt ? (endedAt.getTime() - run.startedAt.getTime()) / 1000 : null
  return {
    type: run.outcome.type,
    reason: run.outcome.reason,
    line: endedRow?.line ?? at,
    printing: run.outcome.type === 'shutdown' && wasPrinting(props.lines, run, at),
    startedAt: run.startedAt,
    endedAt,
    ranFor: seconds === null ? null : duration(seconds),
  }
})

function duration(seconds: number): string {
  if (seconds < 60)
    return t('dashboard.duration.seconds', { seconds: Math.max(0, Math.round(seconds)) })
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0
    ? t('dashboard.duration.hoursMinutes', { hours, minutes })
    : t('dashboard.duration.minutes', { minutes })
}

const copied = ref(false)
let copiedTimeout: ReturnType<typeof setTimeout> | undefined

/** Fenced, so a forum or chat keeps the lines as they are instead of reflowing them. */
async function copyExcerpt(): Promise<void> {
  if (!props.run) return
  const text = runExcerpt(props.lines, props.run).map((entry) =>
    entry.kind === 'line'
      ? entry.text
      : t(
          `configuration.klippyLog.copy.omitted.${entry.what}`,
          { count: entry.count },
          entry.count,
        ),
  )
  if (!(await copyToClipboard(['```', ...text, '```'].join('\n')))) {
    toasts.push(t('configuration.klippyLog.copy.failed'))
    return
  }
  copied.value = true
  clearTimeout(copiedTimeout)
  copiedTimeout = setTimeout(() => (copied.value = false), 1500)
}

onBeforeUnmount(() => clearTimeout(copiedTimeout))

function scrollToLine(line: number): void {
  const list = rowsList.value
  const row = list?.querySelector<HTMLElement>(`[data-line="${line}"]`)
  if (!list || !row) return
  list.scrollTop = row.offsetTop - list.offsetTop - list.clientHeight / 3
}

/*
 * A reader at the end of the newest run is following it, so rows Klipper adds
 * keep them there; one who scrolled back to read stays where they are. A run
 * appearing for the first time is not "added rows": it opens at its top, where
 * the reason it ended is stated, and so does every other run picked.
 */
const followThresholdPx = 24
const shownRun = computed(() => (props.run ? runKey(props.lines, props.run) : null))
let wasAtEnd = false
watch(
  () => [shownRun.value, props.rows.length] as const,
  ([key, length], [previousKey, previousLength]) => {
    const list = rowsList.value
    wasAtEnd =
      key === previousKey &&
      previousLength > 0 &&
      length > previousLength &&
      Boolean(list && list.scrollHeight - list.scrollTop - list.clientHeight <= followThresholdPx)
  },
  { flush: 'pre' },
)
watch(
  () => [shownRun.value, props.rows.length] as const,
  async ([key], [previousKey]) => {
    await nextTick()
    const list = rowsList.value
    if (!list) return
    if (wasAtEnd) list.scrollTop = list.scrollHeight
    else if (key !== previousKey) list.scrollTop = 0
  },
)

/*
 * Wide enough for this reader's own time format and no wider: `23:59:59` and
 * `11:59:59 PM` are not the same width, and a column sized for the longer one
 * wastes the difference on every row of a 24-hour reader.
 */
const timeColumnChars = computed(
  () => timeFormatter.value.format(new Date(2000, 0, 1, 23, 59, 59)).length,
)
</script>

<template>
  <div
    class="log-run"
    role="region"
    :aria-label="t('configuration.klippyLog.region', { name: fileName })"
    :aria-busy="isLoading || undefined"
    :style="{ '--log-time-chars': timeColumnChars }"
  >
    <section v-if="summary" class="log-run__summary" aria-labelledby="log-run-reason">
      <AppIcon
        name="alertOctagon"
        class="log-run__summary-icon size-6 shrink-0"
        aria-hidden="true"
      />
      <div class="log-run__summary-body">
        <p class="log-run__outcome">
          {{
            t(
              summary.type === 'error'
                ? 'configuration.klippyLog.summary.error'
                : summary.printing
                  ? 'configuration.klippyLog.summary.shutdownPrinting'
                  : 'configuration.klippyLog.summary.shutdown',
            )
          }}
        </p>
        <h3 id="log-run-reason" class="log-run__reason selectable">{{ summary.reason }}</h3>
        <dl class="log-run__facts">
          <div v-if="summary.startedAt">
            <dt>{{ t('configuration.klippyLog.summary.started') }}</dt>
            <dd>{{ formatTime(summary.startedAt) }}</dd>
          </div>
          <div v-if="summary.endedAt">
            <dt>
              {{
                t(
                  summary.type === 'error'
                    ? 'configuration.klippyLog.summary.failedAt'
                    : 'configuration.klippyLog.summary.shutDownAt',
                )
              }}
            </dt>
            <dd>{{ formatTime(summary.endedAt) }}</dd>
          </div>
          <div v-if="summary.ranFor">
            <dt>{{ t('configuration.klippyLog.summary.ranFor') }}</dt>
            <dd>{{ summary.ranFor }}</dd>
          </div>
        </dl>
      </div>
      <div class="log-run__summary-actions">
        <AppButton
          size="sm"
          :label="
            t(copied ? 'configuration.klippyLog.copy.copied' : 'configuration.klippyLog.copy.label')
          "
          @click="copyExcerpt()"
        />
        <AppButton
          size="sm"
          :label="
            t(
              summary.type === 'error'
                ? 'configuration.klippyLog.summary.goToError'
                : 'configuration.klippyLog.summary.goToShutdown',
            )
          "
          @click="scrollToLine(summary.line)"
        />
      </div>
    </section>

    <div v-if="failed" class="log-run__failed" role="status">
      <p>{{ t('configuration.klippyLog.failed', { name: fileName }) }}</p>
      <AppButton size="sm" :label="t('configuration.klippyLog.retry')" @click="emit('retry')" />
    </div>

    <ol
      ref="rowsList"
      class="log-run__rows selectable"
      :aria-label="t('configuration.klippyLog.rowsLabel')"
    >
      <template v-for="row in rows" :key="row.line">
        <li
          v-if="row.kind === 'line'"
          class="log-row"
          :class="row.mark ? `log-row--${row.mark}` : undefined"
          :data-line="row.line"
        >
          <time class="log-row__time" :datetime="row.time?.toISOString()">{{
            formatTime(row.time)
          }}</time>
          <span class="log-row__text"
            ><span v-if="row.mark" class="log-row__mark">{{
              t(`configuration.klippyLog.marks.${row.mark}`)
            }}</span
            >{{ row.text }}</span
          >
        </li>
        <template v-else>
          <li
            class="log-row log-fold"
            :class="{ 'log-fold--error': row.error }"
            :data-line="row.line"
          >
            <time class="log-row__time" :datetime="row.time?.toISOString()">{{
              formatTime(row.time)
            }}</time>
            <button
              type="button"
              class="file-select log-fold__toggle"
              :aria-expanded="isOpen(row)"
              @click="toggleFold(row)"
            >
              <AppIcon
                :name="isOpen(row) ? 'down' : 'right'"
                class="log-fold__chevron size-4 shrink-0"
                aria-hidden="true"
              />
              <span class="log-fold__label"
                ><span v-if="row.error" class="log-row__mark">{{
                  t('configuration.klippyLog.marks.error')
                }}</span
                >{{ foldLabel(row) }}</span
              >
              <span class="log-fold__count">{{ foldCount(row) }}</span>
            </button>
          </li>
          <template v-if="isOpen(row)">
            <li
              v-for="entry in foldLines(lines, row)"
              :key="`${row.line}:${entry.line}`"
              class="log-row"
            >
              <time class="log-row__time" :datetime="row.time?.toISOString()">{{
                formatTime(row.time)
              }}</time>
              <span class="log-row__text">{{ entry.text }}</span>
            </li>
          </template>
        </template>
      </template>
    </ol>
  </div>
</template>
