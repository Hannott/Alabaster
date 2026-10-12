<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppSelect from '@/components/AppSelect.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import CalibrationRequirements from '@/components/calibration/CalibrationRequirements.vue'
import CalibrationScrewsGrid from '@/components/calibration/CalibrationScrewsGrid.vue'
import CalibrationSparkline from '@/components/calibration/CalibrationSparkline.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { onKlipperRestart } from '@/composables/onKlipperRestart'
import { useNow } from '@/composables/useNow'
import { useAvailability } from '@/composables/useAvailability'
import { useCalibrationSelection } from '@/composables/useCalibrationSelection'
import { useFollowingLog } from '@/composables/useFollowingLog'
import { useProcedureContext } from '@/composables/useProcedureContext'
import { useProcedureRequirements } from '@/composables/useProcedureRequirements'
import { useProcedureText } from '@/composables/useProcedureText'
import {
  defaultShaperPicks,
  initialProcedureValues,
  missingProcedureValues,
  nextProcedure,
  procedureSubject,
  shaperActionsFor,
  type CalibrationProcedure,
  type ProcedureAction,
  type ProcedureId,
  type ProcedureParameter,
  type ProcedureResultRow,
  type ShaperCandidate,
} from '@/features/calibration/procedures'
import type { ScrewReading } from '@/features/calibration/screws'
import { trendSeries } from '@/features/calibration/trends'
import { useAvailabilityStore } from '@/stores/availability'
import {
  useCalibrationStore,
  type LogOutcome,
  type PersistActionOutcome,
} from '@/stores/calibration'
import { useConfirmationsStore } from '@/stores/confirmations'
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
const confirmations = useConfirmationsStore()
const printer = usePrinterStore()
const availability = useAvailabilityStore()
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
  const max =
    typeof parameter.max === 'function' ? parameter.max(context.value, values.value) : parameter.max
  if (max !== undefined) attributes.max = max
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

const script = computed(() => props.procedure.build?.(values.value, context.value) ?? null)
const missing = computed(() => missingProcedureValues(props.procedure, values.value))

/*
 * What the chosen values are about — the stepper a buzz test moves. A run, its
 * answers and its history belong to it, so choosing another stepper shows what
 * that one found and not the last run's card.
 */
const subject = computed(() => procedureSubject(props.procedure, values.value))
const selection = useCalibrationSelection()
watch([() => props.procedure.id, subject], ([id, value]) => selection.setSubject(id, value), {
  immediate: true,
})
const run = computed(() => calibration.runFor(props.procedure.id, subject.value))
const isRunning = computed(() => run.value?.running === true)
const otherRunning = computed(() => calibration.busy && !isRunning.value)

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
  outputChoice.value = null
  openedAt.value = null
  // The questions are about this run; the last run's ticks are not answers to it.
  const others = { ...answersById.value }
  delete others[answerScope.value]
  answersById.value = others
  await calibration.run(props.procedure, values.value, context.value)
}

const output = computed(() =>
  calibration
    .linesFor(props.procedure.id, subject.value)
    .flatMap((line) => line.split('\n'))
    .map((line) => line.replace(/^\s*\/\/\s?/, ''))
    .slice(-200),
)
const result = computed(() => calibration.resultFor(props.procedure.id, subject.value))

/**
 * Every logged run, oldest first, including the one shown as the result.
 * Declared here because the result shown can be one of them.
 */
const logged = computed(() => calibration.historyFor(props.procedure.id, subject.value))

/*
 * An earlier run opened from the list, by when it started; null shows the
 * latest. The history used to be one summary line per run with its buttons
 * beside it, which could not show a run's values against what the printer
 * had before, nor offer the shaper choice its result had — so an earlier run
 * opens into the same result card the live run uses.
 */
const openedAt = ref<number | null>(null)
const opened = computed(() =>
  openedAt.value === null
    ? null
    : (logged.value.find((entry) => entry.at === openedAt.value) ?? null),
)

/** What the result card shows: the opened earlier run, else the live one. */
interface ShownResult {
  at: number
  subject: string
  rows: readonly ProcedureResultRow[]
  outcome: LogOutcome
  actions: readonly ProcedureAction[]
  candidates: readonly ShaperCandidate[]
  screws: readonly ScrewReading[] | undefined
  live: boolean
}

const shown = computed<ShownResult | null>(() => {
  const entry = opened.value
  if (entry) {
    return {
      at: entry.at,
      subject: procedureSubject(props.procedure, entry.values),
      rows: entry.rows,
      outcome: calibration.outcomeOf(entry),
      actions: entry.actions ?? props.procedure.actionsFromRows?.(entry.rows) ?? [],
      candidates: entry.candidates ?? [],
      screws: undefined,
      live: false,
    }
  }
  const live = run.value
  if (!live) return null
  const outcome: LogOutcome = live.running
    ? 'running'
    : live.interrupted
      ? 'interrupted'
      : live.aborted
        ? 'aborted'
        : live.succeeded === false
          ? 'failed'
          : (result.value?.outcome ?? 'done')
  return {
    at: live.startedAt,
    subject: live.subject,
    rows: result.value?.rows ?? [],
    outcome,
    actions: result.value?.actions ?? [],
    candidates: result.value?.shaperCandidates ?? [],
    screws: result.value?.screws,
    live: true,
  }
})

const shownEnded = computed(() => {
  const outcome = shown.value?.outcome
  return outcome === 'failed' || outcome === 'interrupted' || outcome === 'aborted'
})

function openEntry(at: number): void {
  openedAt.value = openedAt.value === at ? null : at
  actionOutcomes.value = {}
}

/*
 * One run forgotten, after asking: the log is the printer's, so this is the
 * only copy on every browser.
 */
const forgetAt = ref<number | null>(null)
const forgetGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'quiet',
  key: 'forgetCalibrationRun',
})

function requestForget(at: number): void {
  forgetGuard.request(
    () => forgetEntry(at),
    () => (forgetAt.value = at),
  )
}

function forgetEntry(at: number | null = forgetAt.value): void {
  forgetAt.value = null
  if (at === null) return
  if (openedAt.value === at) openedAt.value = null
  calibration.forgetEntry(props.procedure.id, at)
}

/*
 * One state for whether the output is shown, which the toggle both reads and
 * sets. The log used to open on its own while a run had nothing else to show,
 * independently of the toggle — so during a run the toggle flipped its label
 * and the log stayed exactly where it was. Null follows the run: shown while
 * it has no result yet, hidden once it has one. A press is the reader's
 * choice and holds until another procedure is opened or another run starts.
 */
const outputChoice = ref<boolean | null>(null)
const outputVisible = computed(
  () => outputChoice.value ?? (isRunning.value && !result.value?.rows.length),
)
function toggleOutput(): void {
  outputChoice.value = !outputVisible.value
}
const outputLog = ref<HTMLElement | null>(null)
const followLog = useFollowingLog(outputLog, () => output.value.length)

/*
 * Which shaper each axis gets, where a run offers more than one: Shake&Tune's
 * "for performance" and "for low vibrations", or every shaper Klipper fitted.
 * Held per run, so the next run starts from its own recommendation.
 */
const shaperChoice = ref<{ at: number; picks: Partial<Record<'x' | 'y', string>> }>({
  at: 0,
  picks: {},
})

function candidateKey(candidate: ShaperCandidate): string {
  return `${candidate.shaperType}@${candidate.frequency}`
}

const shaperAxes = computed(() => {
  const candidates = shown.value?.candidates ?? []
  const axes = (['x', 'y'] as const).flatMap((axis) => {
    const options = candidates.filter((candidate) => candidate.axis === axis)
    return options.length > 0 ? [{ axis, options }] : []
  })
  return axes.some((axis) => axis.options.length > 1) ? axes : []
})

const chosenShapers = computed(() => {
  const defaults = defaultShaperPicks(shown.value?.candidates ?? [])
  const picks = shaperChoice.value.at === shown.value?.at ? shaperChoice.value.picks : {}
  return shaperAxes.value.flatMap(({ axis, options }) => {
    const chosen = options.find((option) => candidateKey(option) === picks[axis]) ?? defaults[axis]
    return chosen ? [chosen] : []
  })
})

function chooseShaper(axis: 'x' | 'y', candidate: ShaperCandidate): void {
  const at = shown.value?.at ?? 0
  const picks = shaperChoice.value.at === at ? shaperChoice.value.picks : {}
  shaperChoice.value = { at, picks: { ...picks, [axis]: candidateKey(candidate) } }
  // What was applied or saved was the previous choice; its note no longer describes this one.
  actionOutcomes.value = {}
}

function isChosen(candidate: ShaperCandidate): boolean {
  return chosenShapers.value.some(
    (chosen) => chosen.axis === candidate.axis && candidateKey(chosen) === candidateKey(candidate),
  )
}

function candidateLabel(candidate: ShaperCandidate): string {
  const value = `${candidate.shaperType} @ ${candidate.frequency} Hz`
  if (candidate.kind !== null && candidate.kind !== 'best') {
    return `${t(`calibration.result.shaperChoice.${candidate.kind}`)}: ${value}`
  }
  const parts = [value]
  if (candidate.vibrations !== undefined) {
    parts.push(t('calibration.result.shaperChoice.vibrations', { value: candidate.vibrations }))
  }
  if (candidate.maxAccel !== undefined) {
    parts.push(t('calibration.result.shaperChoice.maxAccel', { value: candidate.maxAccel }))
  }
  if (candidate.recommended) parts.push(t('calibration.result.shaperChoice.recommended'))
  return parts.join(' · ')
}

/**
 * The shown result's actions, built from the chosen shapers where the reader
 * has a choice. A step of the run itself — a drift calibration's next sample
 * — belongs to the live run only.
 */
const resultActions = computed<readonly ProcedureAction[]>(() => {
  if (shaperAxes.value.length > 0) return shaperActionsFor(chosenShapers.value)
  const actions = shown.value?.actions ?? []
  return shown.value?.live ? actions : actions.filter((action) => action.transient !== true)
})
const hasBefore = computed(() => shown.value?.rows.some((row) => row.before !== undefined) ?? false)

const actionOutcomes = ref<Record<string, PersistActionOutcome | boolean>>({})
/* "Applied until Klipper restarts" and "Klipper is restarting" both end with the restart. */
onKlipperRestart(() => {
  actionOutcomes.value = {}
})
const pendingAction = ref<string | null>(null)

/** An action's note is about one run's press of it, so the key carries when that run started. */
function actionKey(action: ProcedureAction): string {
  return `${shown.value?.at ?? 0}:${action.id}`
}

async function runAction(action: ProcedureAction): Promise<void> {
  const id = actionKey(action)
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
  // A command key takes one command at a time and refuses a second without a word.
  if (calibration.busy || printer.pendingCommands.calibration) return true
  return action.kind === 'persist' && action.restart === true && printer.hasActivePrint
}

function actionNote(action: ProcedureAction): string | null {
  const outcome = actionOutcomes.value[actionKey(action)]
  if (outcome === undefined) return null
  if (outcome === true) return t('calibration.result.actionApplied')
  if (outcome === false) return t('dashboard.commandFailed')
  return t(`calibration.result.persist.${outcome}`)
}

const outcomeText = computed(() => {
  const view = shown.value
  if (!view) return null
  // A screws run past its deviation limit fails on purpose, and says so itself.
  if (view.live && run.value?.succeeded === false && result.value?.screws?.length) {
    return t('calibration.screws.overLimit')
  }
  if (view.outcome === 'running') return null
  if (shownEnded.value) return t(`calibration.result.outcome.${view.outcome}`)
  /*
   * Applied and staged both last until a restart. One since the run has
   * undone the first and either written or dropped the second, so the result
   * still says what it found and no longer says it is running or waiting.
   */
  const readyAt = availability.klipperReadyAt
  const restartedSince = readyAt !== null && readyAt > view.at
  if (restartedSince && view.outcome === 'applied') {
    return t('calibration.result.outcome.appliedEnded')
  }
  // A reconnect counts as a restart too, so a staged value Klipper still reports keeps its note.
  if (restartedSince && view.outcome === 'staged' && !printer.saveConfigPending) {
    return t('calibration.result.outcome.stagedEnded')
  }
  return t(`calibration.result.outcome.${view.outcome}`)
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
const now = useNow()
const next = computed(() =>
  nextProcedure(props.procedures, props.procedure.id, (id) => calibration.lastRunAt(id), now.value),
)
const nextText = computed(() => {
  if (next.value === null) return null
  const name = t(`calibration.procedure.${next.value.id}.name`)
  const at = calibration.lastRunAt(next.value.id)
  return at === null
    ? t('calibration.bench.next.never', { name })
    : t('calibration.bench.next.stale', { name, when: lastRun(at) })
})

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

/** Every value an earlier run found, one per line — a shaper run has one per axis. */
function summary(entry: (typeof history.value)[number]): string[] {
  const outcome = calibration.outcomeOf(entry)
  if (outcome === 'failed' || outcome === 'interrupted' || outcome === 'aborted') {
    return [t(`calibration.result.outcome.${outcome}`)]
  }
  if (outcome === 'running') return [t('calibration.bench.running')]
  const found = entry.rows.filter((row) => row.after !== '')
  return found.length > 0
    ? found.map((row) => `${text(row.label)} ${row.after}`)
    : [t(`calibration.result.outcome.${outcome}`)]
}

// What belongs to one procedure's view resets when another is chosen, or another subject of it.
watch(
  () => [props.procedure.id, subject.value],
  () => {
    confirmOpen.value = false
    forgetAt.value = null
    openedAt.value = null
    outputChoice.value = null
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

    <CalibrationRequirements :requires="procedure.requires" />

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

    <div v-if="shown" class="calibration-result" role="status" aria-live="polite">
      <div class="calibration-result__head">
        <h3 class="calibration-result__title">
          {{
            shown.live && isRunning
              ? t('calibration.bench.running')
              : shown.live
                ? t('calibration.result.title')
                : t('calibration.result.earlierTitle')
          }}
        </h3>
        <span class="calibration-result__when">{{
          [shown.subject, when(shown.at)].filter(Boolean).join(' · ')
        }}</span>
        <AppButton
          v-if="!shown.live"
          variant="quiet"
          size="xs"
          :label="t('calibration.bench.latest')"
          @click="openedAt = null"
        />
      </div>

      <CalibrationScrewsGrid v-if="shown.screws?.length" :screws="shown.screws" />

      <table
        v-if="shown.rows.length > 0 && !shown.screws?.length"
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
          <tr v-for="(row, index) in shown.rows" :key="index">
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
        :class="{ 'calibration-result__outcome--failed': shownEnded }"
      >
        {{ outcomeText }}
      </p>

      <fieldset
        v-if="shown.live && askAnswers"
        class="calibration-choice"
        :disabled="answersRecorded"
      >
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
      <p v-if="shown.live && askAnswers && answersRecorded" class="calibration-panel__hint">
        {{ t('calibration.answer.recorded') }}
      </p>
      <AppButton
        v-else-if="shown.live && askAnswers"
        size="sm"
        :label="t('calibration.answer.record')"
        @click="recordAnswers"
      />

      <fieldset
        v-for="axis in shaperAxes"
        :key="axis.axis"
        class="calibration-choice calibration-choice--stacked"
        :disabled="pendingAction !== null"
      >
        <legend class="calibration-choice__legend">
          {{ t('calibration.result.shaperChoice.legend', { axis: axis.axis.toUpperCase() }) }}
        </legend>
        <label
          v-for="candidate in axis.options"
          :key="candidateKey(candidate)"
          class="check-row check-row--block calibration-choice__row"
        >
          <input
            type="radio"
            :name="`${procedure.id}-shaper-${axis.axis}`"
            :checked="isChosen(candidate)"
            @change="chooseShaper(axis.axis, candidate)"
          />
          <span>{{ candidateLabel(candidate) }}</span>
        </label>
      </fieldset>

      <ul v-if="resultActions.length" class="calibration-result__actions">
        <li v-for="action in resultActions" :key="action.id">
          <AppButton
            size="sm"
            :label="text(action.label)"
            :pending="pendingAction === actionKey(action)"
            :disabled="actionDisabled(action)"
            @click="runAction(action)"
          />
          <span v-if="actionNote(action)" class="calibration-panel__hint">{{
            actionNote(action)
          }}</span>
        </li>
      </ul>

      <AppButton
        v-if="shown.live"
        variant="quiet"
        size="xs"
        :aria-expanded="outputVisible"
        :label="t(outputVisible ? 'calibration.bench.hideOutput' : 'calibration.bench.showOutput')"
        @click="toggleOutput"
      />
      <ol
        v-if="shown.live && outputVisible"
        ref="outputLog"
        class="console-output selectable calibration-result__output"
        role="log"
        tabindex="0"
        :aria-label="t('calibration.bench.output')"
        @scroll="followLog.onScroll"
      >
        <li v-if="output.length === 0" class="text-muted">
          {{ isRunning ? t('calibration.bench.waiting') : t('calibration.bench.noOutput') }}
        </li>
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
      <!--
        Each run is a row the reader opens into the result card above, with
        its values, its outcome and whatever its result offered; a row the
        reader has no further use for is forgotten from the printer's record.
      -->
      <ul class="calibration-history__list">
        <li v-for="entry in history" :key="entry.at" class="calibration-history__entry">
          <button
            type="button"
            class="file-select selection-row calibration-history__open"
            :class="{ 'selection-row--selected': entry.at === openedAt }"
            :aria-pressed="entry.at === openedAt"
            @click="openEntry(entry.at)"
          >
            <span class="calibration-history__when">{{ when(entry.at) }}</span>
            <span class="calibration-history__body">
              <span
                v-for="(line, index) in summary(entry)"
                :key="index"
                class="calibration-history__summary"
                >{{ line }}</span
              >
            </span>
          </button>
          <AppButton
            :guard="forgetGuard"
            size="xs"
            icon="trash"
            :label="t('calibration.bench.forget')"
            :disabled="calibration.outcomeOf(entry) === 'running'"
            @click="requestForget(entry.at)"
          />
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

    <ConfirmDialog
      :open="forgetAt !== null"
      :title="t('calibration.bench.forgetTitle')"
      :description="t('calibration.bench.forgetDescription')"
      :items="forgetAt === null ? [] : [when(forgetAt)]"
      :confirm-label="t('calibration.bench.forget')"
      tone="danger"
      show-skip-option
      @confirm="forgetEntry()"
      @cancel="forgetAt = null"
      @skip="confirmations.setSkip('forgetCalibrationRun', true)"
    />
  </CalibrationCard>
</template>
