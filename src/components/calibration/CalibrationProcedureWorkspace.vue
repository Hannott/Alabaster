<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppSelect from '@/components/AppSelect.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import CalibrationScrewsGrid from '@/components/calibration/CalibrationScrewsGrid.vue'
import CalibrationSparkline from '@/components/calibration/CalibrationSparkline.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { useAvailability } from '@/composables/useAvailability'
import { useProcedureContext } from '@/composables/useProcedureContext'
import {
  useProcedureRequirements,
  type RequirementFixId,
} from '@/composables/useProcedureRequirements'
import { useProcedureText } from '@/composables/useProcedureText'
import {
  initialProcedureValues,
  missingProcedureValues,
  nextProcedure,
  procedureSubject,
  type CalibrationProcedure,
  type ProcedureAction,
  type ProcedureId,
  type ProcedureParameter,
} from '@/features/calibration/procedures'
import { trendSeries } from '@/features/calibration/trends'
import { useCalibrationStore, type PersistActionOutcome } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'

/**
 * One procedure's panel: what it does, what it needs, the few values worth
 * choosing, Run, and what it found set against what the printer had before.
 *
 * The command line the fields build is shown as a statement of what Run will
 * send, never as an input: a free-text parameter box is the command browser
 * the Console page already is.
 */
const props = defineProps<{
  procedure: CalibrationProcedure
  /** The stage's procedures, for the next step the workspace names under its result. */
  procedures: readonly CalibrationProcedure[]
  /** The heater model's confirmation is the Temperatures card's own switch; see HeatersStage. */
  skipConfirm?: boolean | undefined
}>()

/** `skip` is persisted by whichever host passes `skipConfirm`; `select` opens the next step. */
const emit = defineEmits<{ skip: []; select: [id: ProcedureId] }>()

const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const context = useProcedureContext()
const requirements = useProcedureRequirements()
const { lastRun, text, when } = useProcedureText()
const { availability: klipperAvailability } = useAvailability('klipper')

/*
 * Kept per procedure while the page is open, so stepping to another procedure
 * and back does not lose a profile name or a target just typed.
 */
const valuesById = ref<Record<string, Record<string, string>>>({})

function valuesFor(procedure: CalibrationProcedure): Record<string, string> {
  const existing = valuesById.value[procedure.id]
  if (existing) return existing
  const initial = initialProcedureValues(procedure, context.value)
  valuesById.value = { ...valuesById.value, [procedure.id]: initial }
  return initial
}

const values = computed(() => valuesFor(props.procedure))

function setValue(parameter: ProcedureParameter, value: string | number | null | undefined): void {
  const next = value === null || value === undefined ? '' : String(value)
  valuesById.value = {
    ...valuesById.value,
    [props.procedure.id]: { ...values.value, [parameter.key]: next },
  }
}

/*
 * A heater chosen changes the sensible target, so the target follows the
 * heater unless the reader has typed one of their own.
 */
watch(
  () => values.value.HEATER,
  (heater, previous) => {
    if (props.procedure.id !== 'heaterModel' || previous === undefined || heater === previous)
      return
    const typical = heater === 'heater_bed' ? '60' : heater?.startsWith('extruder') ? '200' : '50'
    valuesById.value = {
      ...valuesById.value,
      heaterModel: { ...values.value, TARGET: typical },
    }
  },
)

function numberOf(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/*
 * Only the attributes a parameter actually has: the field's props are
 * optional without `undefined`, so an absent unit has to be absent rather
 * than passed as undefined.
 */
function fieldAttributes(parameter: ProcedureParameter): Record<string, string | number> {
  const attributes: Record<string, string | number> = {}
  if (parameter.unit) attributes.unit = t(parameter.unit)
  const placeholder = parameter.placeholder?.(context.value)
  if (placeholder) attributes.placeholder = placeholder
  if (parameter.min !== undefined) attributes.min = parameter.min
  if (parameter.max !== undefined) attributes.max = parameter.max
  return attributes
}

/** Past this many choices a dropdown is shorter to scan than the rows would be. */
const choiceRowLimit = 8

function optionsFor(parameter: ProcedureParameter) {
  return (parameter.options?.(context.value) ?? []).map((option) => ({
    value: option.value,
    label: text(option.label),
  }))
}

const unmet = computed(() =>
  props.procedure.requires
    .map((requirement) => requirements.value[requirement])
    .filter((state) => !state.met),
)

/*
 * A fix moves or reads the machine, so it waits for the same things a run
 * does: Klipper there, no print, and no procedure under way — a fix pressed
 * mid-run would move the toolhead out from under a probe.
 */
const canFix = computed(
  () =>
    klipperAvailability.value.isAvailable &&
    !printer.hasActivePrint &&
    calibration.activeRun === null,
)

const fixIcons: Partial<Record<RequirementFixId, 'home' | 'move'>> = {
  home: 'home',
  moveOverBed: 'move',
}

const script = computed(() => props.procedure.build?.(values.value, context.value) ?? null)
const missing = computed(() => missingProcedureValues(props.procedure, values.value))

/*
 * What the chosen values are about — the stepper a buzz test moves. A run, its
 * answers and its history belong to it, so choosing another stepper shows what
 * that one found and not the last run's card.
 */
const subject = computed(() => procedureSubject(props.procedure, values.value))
const run = computed(() => calibration.runFor(props.procedure.id, subject.value))
const isRunning = computed(() => run.value?.running === true)
const otherRunning = computed(() => calibration.activeRun !== null && !isRunning.value)

const canRun = computed(
  () =>
    klipperAvailability.value.isAvailable &&
    script.value !== null &&
    missing.value.length === 0 &&
    unmet.value.length === 0 &&
    !isRunning.value &&
    !otherRunning.value,
)

/** Why Run is off, said in place rather than left for a disabled button to imply. */
const blockedReason = computed(() => {
  if (isRunning.value || canRun.value) return null
  if (!klipperAvailability.value.isAvailable) return t('calibration.bench.blocked.unavailable')
  if (otherRunning.value) return t('calibration.bench.blocked.otherRunning')
  if (unmet.value.length > 0) return t('calibration.bench.blocked.requirements')
  if (missing.value.length > 0) return t('calibration.bench.blocked.missing')
  return t('calibration.bench.blocked.invalid')
})

const guard = useActionGuard({
  tier: () => (props.procedure.confirm ? 'terminal' : 'disruptive'),
  emphasis: 'primary',
  moduleFlag: computed(() => props.skipConfirm === true),
})
const confirmOpen = ref(false)

function requestRun(): void {
  guard.request(
    () => void startRun(),
    () => (confirmOpen.value = true),
  )
}

async function startRun(): Promise<void> {
  confirmOpen.value = false
  actionOutcomes.value = {}
  await calibration.run(props.procedure, values.value, context.value)
}

const output = computed(() =>
  calibration
    .linesFor(props.procedure.id, subject.value)
    .flatMap((line) => line.split('\n'))
    .map((line) => line.replace(/^\s*\/\/\s?/, ''))
    .slice(-12),
)
const showOutput = ref(false)
const result = computed(() => calibration.resultFor(props.procedure.id, subject.value))
const hasBefore = computed(
  () => result.value?.rows.some((row) => row.before !== undefined) ?? false,
)

const actionOutcomes = ref<Record<string, PersistActionOutcome | boolean>>({})
const pendingAction = ref<string | null>(null)

/** The current run's actions keep their own ids; an earlier run's are scoped by when it ran. */
function actionKey(action: ProcedureAction, at?: number): string {
  return at === undefined ? action.id : `${at}:${action.id}`
}

async function runAction(action: ProcedureAction, at?: number): Promise<void> {
  const id = actionKey(action, at)
  pendingAction.value = id
  try {
    const outcome = await calibration.runAction(action)
    actionOutcomes.value = { ...actionOutcomes.value, [id]: outcome }
  } finally {
    pendingAction.value = null
  }
}

/** A restart during a print would end it, so an action that restarts waits for the print. */
function actionDisabled(action: ProcedureAction): boolean {
  if (!klipperAvailability.value.isAvailable || pendingAction.value !== null) return true
  return action.kind === 'persist' && action.restart === true && printer.hasActivePrint
}

function actionNote(action: ProcedureAction, at?: number): string | null {
  const outcome = actionOutcomes.value[actionKey(action, at)]
  if (outcome === undefined) return null
  if (outcome === true) return t('calibration.result.actionApplied')
  if (outcome === false) return t('dashboard.commandFailed')
  return t(`calibration.result.persist.${outcome}`)
}

const outcomeText = computed(() => {
  // A screws run past its deviation limit fails on purpose, and says so itself.
  if (run.value?.succeeded === false && result.value?.screws?.length) {
    return t('calibration.screws.overLimit')
  }
  if (run.value?.succeeded === false) return t('calibration.result.outcome.failed')
  if (!result.value) return null
  return t(`calibration.result.outcome.${result.value.outcome}`)
})

/*
 * A procedure's questions, asked once its run has finished: the check rows
 * are the reader's answers, recorded into the run's result and its log entry
 * together. Kept per procedure and subject while the page is open, like the values.
 */
const answersById = ref<Record<string, Record<string, boolean>>>({})
const answerScope = computed(() =>
  subject.value === '' ? props.procedure.id : `${props.procedure.id}:${subject.value}`,
)
const askAnswers = computed(
  () =>
    run.value?.succeeded === true && !isRunning.value && (props.procedure.answers?.length ?? 0) > 0,
)
const answersRecorded = computed(() => (run.value?.answers.length ?? 0) > 0)

function answerChecked(key: string): boolean {
  return answersById.value[answerScope.value]?.[key] ?? false
}

function setAnswer(key: string, checked: boolean): void {
  answersById.value = {
    ...answersById.value,
    [answerScope.value]: { ...answersById.value[answerScope.value], [key]: checked },
  }
}

function recordAnswers(): void {
  const rows = (props.procedure.answers ?? []).map((question) => ({
    label: { key: question.label },
    after: t(answerChecked(question.key) ? 'calibration.answer.yes' : 'calibration.answer.no'),
  }))
  calibration.answer(props.procedure.id, rows, subject.value)
}

/*
 * The same ordering the stage arrived on: the first due procedure other than
 * this one, so the sentence never names a procedure the stage would not
 * have opened on itself.
 */
const next = computed(() =>
  nextProcedure(
    props.procedures,
    props.procedure.id,
    (id) => calibration.lastRunAt(id),
    Date.now(),
  ),
)
const nextText = computed(() => {
  if (next.value === null) return null
  const name = t(`calibration.procedure.${next.value.id}.name`)
  const at = calibration.lastRunAt(next.value.id)
  return at === null
    ? t('calibration.bench.next.never', { name })
    : t('calibration.bench.next.stale', { name, when: lastRun(at) })
})

/** Every logged run, oldest first, including the one shown as the result. */
const logged = computed(() => calibration.historyFor(props.procedure.id, subject.value))
const trends = computed(() => trendSeries(props.procedure.id, logged.value))

/** Five recent runs read at a glance; the whole log is there for comparing them. */
const recentHistory = 5
const showAllHistory = ref(false)
const earlier = computed(() =>
  [...logged.value].filter((entry) => entry.at !== run.value?.startedAt).reverse(),
)
const history = computed(() =>
  showAllHistory.value ? earlier.value : earlier.value.slice(0, recentHistory),
)

function entryActions(entry: (typeof history.value)[number]): readonly ProcedureAction[] {
  if (entry.outcome === 'failed') return []
  return entry.actions ?? props.procedure.actionsFromRows?.(entry.rows) ?? []
}

/** Every value an earlier run found, one per line — a shaper run has one per axis. */
function summary(entry: (typeof history.value)[number]): string[] {
  if (entry.outcome === 'failed') return [t('calibration.result.outcome.failed')]
  const found = entry.rows.filter((row) => row.after !== '')
  return found.length > 0
    ? found.map((row) => `${text(row.label)} ${row.after}`)
    : [t(`calibration.result.outcome.${entry.outcome}`)]
}

// What belongs to one procedure's view resets when another is chosen, or another subject of it.
watch(
  () => [props.procedure.id, subject.value],
  () => {
    confirmOpen.value = false
    showOutput.value = false
    showAllHistory.value = false
    actionOutcomes.value = {}
  },
)

const effects = computed(() =>
  [
    t(`calibration.bench.duration.${props.procedure.duration}`),
    ...props.procedure.effects.map((effect) => t(`calibration.bench.effect.${effect}`)),
  ].join(' · '),
)
</script>

<template>
  <CalibrationCard
    class="calibration-workspace"
    :title="t(`calibration.procedure.${procedure.id}.name`)"
  >
    <template #aside>{{ effects }}</template>

    <p class="calibration-workspace__description">
      {{ t(`calibration.procedure.${procedure.id}.detail`) }}
    </p>

    <ul v-if="procedure.requires.length > 0" class="calibration-checks">
      <li
        v-for="requirement in procedure.requires"
        :key="requirement"
        class="calibration-check"
        :class="{ 'calibration-check--unmet': !requirements[requirement].met }"
      >
        <AppIcon
          :name="requirements[requirement].met ? 'check' : 'warning'"
          class="size-4 shrink-0"
          aria-hidden="true"
        />
        <span class="calibration-check__text">{{
          t(
            `calibration.requirement.${requirement}.${requirements[requirement].met ? 'met' : 'unmet'}`,
          )
        }}</span>
        <AppButton
          v-if="!requirements[requirement].met && requirements[requirement].fix"
          size="xs"
          :icon="fixIcons[requirements[requirement].fix!.id]"
          :label="t(`calibration.requirement.fix.${requirements[requirement].fix!.id}`)"
          :pending="requirements[requirement].fix!.pending"
          :disabled="!canFix"
          @click="requirements[requirement].fix!.run()"
        />
      </li>
    </ul>

    <div v-if="procedure.params?.length" class="calibration-params">
      <template v-for="parameter in procedure.params" :key="parameter.key">
        <!--
          A short list is its rows, each one a click: the handful of steppers,
          heaters or axes a printer has reads faster laid out than folded into
          a dropdown the reader has to open to see.
        -->
        <fieldset
          v-if="parameter.kind === 'select' && optionsFor(parameter).length <= choiceRowLimit"
          class="calibration-choice"
          :disabled="isRunning"
        >
          <legend class="calibration-choice__legend">{{ t(parameter.label) }}</legend>
          <label
            v-for="option in optionsFor(parameter)"
            :key="option.value"
            class="check-row check-row--block calibration-choice__row"
          >
            <input
              type="radio"
              :name="`${procedure.id}-${parameter.key}`"
              :value="option.value"
              :checked="(values[parameter.key] ?? '') === option.value"
              @change="setValue(parameter, option.value)"
            />
            <span>{{ option.label }}</span>
          </label>
        </fieldset>
        <AppSelect
          v-else-if="parameter.kind === 'select'"
          :model-value="values[parameter.key] ?? ''"
          :options="optionsFor(parameter)"
          :label="t(parameter.label)"
          :disabled="isRunning"
          @update:model-value="(value) => setValue(parameter, value)"
        />
        <AppField
          v-else-if="parameter.kind === 'number'"
          type="number"
          size="sm"
          :label="t(parameter.label)"
          v-bind="fieldAttributes(parameter)"
          :model-value="numberOf(values[parameter.key])"
          :disabled="isRunning"
          @update:model-value="(value) => setValue(parameter, value)"
        />
        <AppField
          v-else
          type="text"
          size="sm"
          :label="t(parameter.label)"
          v-bind="fieldAttributes(parameter)"
          :model-value="values[parameter.key] ?? ''"
          :disabled="isRunning"
          @update:model-value="(value) => setValue(parameter, value)"
        />
      </template>
    </div>

    <div class="calibration-run">
      <code class="calibration-run__script selectable">{{
        script ?? t('calibration.bench.noScript')
      }}</code>
      <AppButton
        :guard="guard"
        icon="play"
        :label="t('calibration.bench.run')"
        :pending="isRunning"
        :disabled="!canRun"
        @click="requestRun"
      />
    </div>
    <p v-if="blockedReason" class="calibration-panel__hint">{{ blockedReason }}</p>
    <p v-if="procedure.duration === 'interactive'" class="calibration-panel__hint">
      {{ t('calibration.bench.interactive') }}
    </p>

    <div v-if="run" class="calibration-result" role="status" aria-live="polite">
      <div class="calibration-result__head">
        <h3 class="calibration-result__title">
          {{ isRunning ? t('calibration.bench.running') : t('calibration.result.title') }}
        </h3>
        <span class="calibration-result__when">{{
          [run.subject, when(run.startedAt)].filter(Boolean).join(' · ')
        }}</span>
      </div>

      <CalibrationScrewsGrid v-if="result?.screws?.length" :screws="result.screws" />

      <table
        v-if="result && result.rows.length > 0 && !result.screws?.length"
        class="calibration-result__table"
      >
        <thead>
          <tr>
            <th scope="col">{{ t('calibration.result.value') }}</th>
            <th v-if="hasBefore" scope="col">{{ t('calibration.result.before') }}</th>
            <th scope="col">{{ t('calibration.result.now') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in result.rows" :key="index">
            <th scope="row">{{ text(row.label) }}</th>
            <td v-if="hasBefore" class="calibration-result__number">{{ row.before || '—' }}</td>
            <td
              class="calibration-result__number"
              :class="{
                'calibration-result__number--changed':
                  row.before !== undefined && row.before !== null && row.before !== row.after,
              }"
            >
              {{ row.after || '—' }}
            </td>
          </tr>
        </tbody>
      </table>
      <p
        v-if="outcomeText"
        class="calibration-result__outcome"
        :class="{ 'calibration-result__outcome--failed': run.succeeded === false }"
      >
        {{ outcomeText }}
      </p>

      <fieldset v-if="askAnswers" class="calibration-choice" :disabled="answersRecorded">
        <legend class="calibration-choice__legend">{{ t('calibration.answer.title') }}</legend>
        <label
          v-for="question in procedure.answers"
          :key="question.key"
          class="check-row check-row--block calibration-choice__row"
        >
          <input
            type="checkbox"
            :checked="answerChecked(question.key)"
            @change="setAnswer(question.key, ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ t(question.label) }}</span>
        </label>
      </fieldset>
      <p v-if="askAnswers && answersRecorded" class="calibration-panel__hint">
        {{ t('calibration.answer.recorded') }}
      </p>
      <AppButton
        v-else-if="askAnswers"
        size="sm"
        :label="t('calibration.answer.record')"
        @click="recordAnswers"
      />

      <ul v-if="result?.actions?.length" class="calibration-result__actions">
        <li v-for="action in result.actions" :key="action.id">
          <AppButton
            size="sm"
            :label="text(action.label)"
            :pending="pendingAction === action.id"
            :disabled="actionDisabled(action)"
            @click="runAction(action)"
          />
          <span v-if="actionNote(action)" class="calibration-panel__hint">{{
            actionNote(action)
          }}</span>
        </li>
      </ul>

      <AppButton
        variant="quiet"
        size="xs"
        :aria-expanded="showOutput"
        :label="t(showOutput ? 'calibration.bench.hideOutput' : 'calibration.bench.showOutput')"
        @click="showOutput = !showOutput"
      />
      <ol
        v-if="showOutput || (isRunning && !result?.rows.length)"
        class="console-output selectable calibration-result__output"
        role="log"
        tabindex="0"
        :aria-label="t('calibration.bench.output')"
      >
        <li v-if="output.length === 0" class="text-muted">{{ t('calibration.bench.waiting') }}</li>
        <li v-for="(line, index) in output" :key="index">{{ line }}</li>
      </ol>
    </div>

    <p v-if="nextText" class="calibration-next" role="status">
      <span class="calibration-next__text">{{ nextText }}</span>
      <AppButton
        size="xs"
        :label="t('calibration.bench.next.open')"
        @click="next && emit('select', next.id)"
      />
    </p>

    <div v-if="history.length > 0" class="calibration-history">
      <h3 class="calibration-history__title">{{ t('calibration.bench.history') }}</h3>
      <ul
        v-if="trends.length > 0"
        class="calibration-trends"
        :aria-label="t('calibration.bench.trends')"
      >
        <li v-for="series in trends" :key="text(series.label)" class="calibration-trend">
          <span class="calibration-trend__label">{{ text(series.label) }}</span>
          <CalibrationSparkline :values="series.values" />
        </li>
      </ul>
      <ul class="calibration-history__list">
        <li v-for="entry in history" :key="entry.at" class="calibration-history__entry">
          <span class="calibration-history__when">{{ when(entry.at) }}</span>
          <div
            class="calibration-history__body"
            :class="{ 'calibration-history__body--actions': entryActions(entry).length }"
          >
            <span
              v-for="(line, index) in summary(entry)"
              :key="index"
              class="calibration-history__summary"
              >{{ line }}</span
            >
            <ul v-if="entryActions(entry).length" class="calibration-result__actions">
              <li v-for="action in entryActions(entry)" :key="action.id">
                <AppButton
                  size="sm"
                  :label="text(action.label)"
                  :pending="pendingAction === actionKey(action, entry.at)"
                  :disabled="actionDisabled(action)"
                  @click="runAction(action, entry.at)"
                />
                <span v-if="actionNote(action, entry.at)" class="calibration-panel__hint">{{
                  actionNote(action, entry.at)
                }}</span>
              </li>
            </ul>
          </div>
        </li>
      </ul>
      <AppButton
        v-if="earlier.length > recentHistory"
        variant="quiet"
        size="xs"
        :aria-expanded="showAllHistory"
        :label="
          showAllHistory
            ? t('calibration.bench.fewerHistory')
            : t('calibration.bench.allHistory', { count: earlier.length })
        "
        @click="showAllHistory = !showAllHistory"
      />
    </div>

    <ConfirmDialog
      :open="confirmOpen"
      :title="
        t('calibration.bench.confirmTitle', {
          name: t(`calibration.procedure.${procedure.id}.name`),
        })
      "
      :description="t(`calibration.procedure.${procedure.id}.detail`)"
      :items="script ? [script] : []"
      :confirm-label="t('calibration.bench.run')"
      show-skip-option
      @confirm="startRun"
      @cancel="confirmOpen = false"
      @skip="emit('skip')"
    />
  </CalibrationCard>
</template>
