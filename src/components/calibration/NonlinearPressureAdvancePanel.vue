<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import CalibrationRequirements from '@/components/calibration/CalibrationRequirements.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DisclosureReveal from '@/components/DisclosureReveal.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { onKlipperRestart } from '@/composables/onKlipperRestart'
import { useAvailability } from '@/composables/useAvailability'
import { useProcedureText } from '@/composables/useProcedureText'
import {
  buildTowerScript,
  configValue,
  convergenceTolerance,
  defaultTowerHeight,
  firstRange,
  formatTowerValue,
  isNonlinearModel,
  isValidRange,
  matchesStart,
  nextRange,
  nextTower,
  nonlinearModels,
  pathTowers,
  rangeAround,
  readingToValues,
  readingValue,
  readNpaConfig,
  sessionPath,
  sessionReadings,
  startingChanges,
  suggestFor,
  towerOption,
  towerReads,
  type NonlinearModel,
  type NpaOption,
  type NpaPath,
  type NpaRange,
  type NpaReading,
  type NpaSuggestion,
  type NpaTower,
} from '@/features/calibration/nonlinearPressureAdvance'
import { procedureById } from '@/features/calibration/procedures'
import {
  paTestChanges,
  paTestOptions,
  paTestProblem,
  readPaTest,
  type PaTestOption,
  type PaTestProblem,
  type PaTestValues,
} from '@/features/calibration/paTestSettings'
import { useCalibrationStore, type PersistActionOutcome } from '@/stores/calibration'
import { useConfirmationsStore } from '@/stores/confirmations'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * Kalico's nonlinear pressure advance, tuned from printed towers.
 *
 * A bench of towers rather than a wizard: the coefficients interact, so the
 * guide sends the reader back to a tower it already printed whenever the side
 * and the front disagree, and a reader who misjudged a height prints it again.
 * Every tower is always one tab away; the panel only says which one it would
 * print next, from the readings logged since the last start.
 *
 * A reading is the heights the reader measured on a printed tower. It is
 * logged when it is saved or acted on, so the value it works out can be kept
 * later from the list of readings — not only at the moment it was read.
 * Every write goes to `[extruder]` and restarts Klipper, because a tower
 * leaves the coefficient it swept at its last value, and the next tower has
 * to start from what the file says.
 */
const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const { when } = useProcedureText()
const { availability: klipperAvailability } = useAvailability('klipper')

const entries = computed(() => calibration.historyFor('nonlinearPressureAdvance'))
const config = computed(() =>
  readNpaConfig(printerConfig.section('extruder'), printerConfig.loadedConfig.extruder ?? null),
)
const towerHeight = computed(() => {
  const height = Number(printerConfig.section('pa_test')?.height)
  return Number.isFinite(height) && height > 0 ? height : defaultTowerHeight
})

const path = ref<NpaPath>(sessionPath(entries.value) ?? 'direct')
const readings = computed(() =>
  sessionReadings(entries.value).filter((reading) => reading.path === path.value),
)
const suggestedTower = computed(() => nextTower(path.value, readings.value))
/*
 * Before any reading, a file that is not at the guide's starting values would
 * have the first tower sweep against coefficients an earlier tuning left in.
 */
const needsStart = computed(
  () =>
    !isNonlinearModel(config.value.model) ||
    (readings.value.length === 0 && !matchesStart(config.value, path.value)),
)

type Tab = 'start' | NpaTower
const tab = ref<Tab>(needsStart.value ? 'start' : (suggestedTower.value ?? 'offset'))
const tabs = computed<Tab[]>(() => ['start', ...pathTowers[path.value]])

/*
 * The log arrives after the panel mounts on a fresh load, so the path and the
 * tab it opens on follow it once — never after the reader has chosen.
 */
let followedLog = entries.value.length > 0
watch(entries, (next) => {
  if (followedLog || next.length === 0) return
  followedLog = true
  path.value = sessionPath(next) ?? path.value
  if (!needsStart.value && suggestedTower.value) tab.value = suggestedTower.value
})

/*
 * ------------------------------------------------------------------ start
 */

const model = ref<NonlinearModel>(config.value.model === 'tanh' ? 'tanh' : 'recipr')
const startMatches = computed(
  () => matchesStart(config.value, path.value) && config.value.model === model.value,
)
const maxAccel = computed(() => {
  const accel = Number(printerConfig.section('printer')?.max_accel)
  return Number.isFinite(accel) ? accel : null
})
/*
 * Only where the firmware reports `enabled_extruders` at all: the option is
 * the same branch's, and on a firmware without it there is nothing to set.
 */
const extruderUnshaped = computed(() => {
  const shaper = printerConfig.section('input_shaper')
  if (!shaper || !('enabled_extruders' in shaper)) return false
  const enabled = shaper.enabled_extruders
  const list = Array.isArray(enabled) ? enabled.map(String) : String(enabled ?? '').split(/[\s,]+/)
  return !list.includes('extruder')
})

const writing = ref<string | null>(null)
const writeOutcome = ref<{ id: string; outcome: PersistActionOutcome } | null>(null)
// "Klipper is restarting" is over once it is back.
onKlipperRestart(() => {
  writeOutcome.value = null
})

async function persist(
  id: string,
  changes: { option: string; value: string }[],
  removes: string[] = [],
  section = 'extruder',
): Promise<void> {
  writing.value = id
  try {
    const outcome = await calibration.runAction({
      kind: 'persist',
      id,
      label: { literal: id },
      section,
      changes,
      removes,
      restart: true,
    })
    if (typeof outcome === 'string') writeOutcome.value = { id, outcome }
  } finally {
    writing.value = null
  }
}

async function writeStart(): Promise<void> {
  await persist(
    'start',
    startingChanges(path.value, model.value),
    config.value.hasLinearAdvanceOption ? ['pressure_advance'] : [],
  )
  if (writeOutcome.value?.id === 'start' && writeOutcome.value.outcome !== 'refused') {
    calibration.recordManual(
      'nonlinearPressureAdvance',
      { kind: 'start', path: path.value, model: model.value },
      [],
      'done',
    )
  }
}

/*
 * ------------------------------------------------------------------ towers
 */

const rangeFor = (tower: NpaTower) => nextRange(path.value, tower, readings.value)

const ranges = ref<Record<NpaTower, NpaRange>>({
  offset: rangeFor('offset'),
  advance: rangeFor('advance'),
  timeOffset: rangeFor('timeOffset'),
})
watch(path, () => {
  for (const tower of pathTowers[path.value]) ranges.value[tower] = rangeFor(tower)
})
/*
 * A new reading of a tower — saved here, or arriving with the log after a
 * reload — moves that tower's next sweep onto the value it found.
 */
const latestReadingAt = computed(() =>
  Object.fromEntries(
    pathTowers[path.value].map((tower) => [
      tower,
      readings.value.filter((reading) => reading.tower === tower).at(-1)?.at ?? null,
    ]),
  ),
)
watch(latestReadingAt, (next, previous) => {
  for (const tower of pathTowers[path.value]) {
    if (next[tower] !== previous[tower]) ranges.value[tower] = rangeFor(tower)
  }
})

const lastValues = computed(() => entries.value.at(-1)?.values ?? {})
function remembered(name: string, fallback: number): number {
  const value = Number(lastValues.value[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}
const defaultNozzle = () => printerConfig.extruderGeometry.nozzleDiameter ?? 0.4
const defaultTargetTemp = 210
const defaultBedTemp = 60
const nozzle = ref<number | null>(remembered('nozzle', defaultNozzle()))
const targetTemp = ref<number | null>(remembered('targetTemp', defaultTargetTemp))
const bedTemp = ref<number | null>(remembered('bedTemp', defaultBedTemp))

const heights = ref<Record<NpaTower, { side: number | null; front: number | null }>>({
  offset: { side: null, front: null },
  advance: { side: null, front: null },
  timeOffset: { side: null, front: null },
})

const activeTower = computed<NpaTower | null>(() => (tab.value === 'start' ? null : tab.value))

const script = computed(() => {
  const tower = activeTower.value
  if (tower === null || nozzle.value === null || targetTemp.value === null) return null
  return buildTowerScript({
    path: path.value,
    tower,
    range: ranges.value[tower],
    nozzle: nozzle.value,
    targetTemp: targetTemp.value,
    bedTemp: bedTemp.value ?? 0,
  })
})

const printBlocked = computed(
  () =>
    !klipperAvailability.value.isAvailable ||
    printer.hasActivePrint ||
    calibration.activeRun !== null ||
    script.value === null,
)
const printed = ref<NpaTower | null>(null)

/*
 * No local deadline: the macro heats and then prints the whole tower before
 * it returns, which is many minutes. Under the transport's usual 60 seconds
 * the call gave up mid-print, reported a failure, and offered Print again
 * while the first tower was still going.
 */
async function printTower(): Promise<void> {
  const tower = activeTower.value
  if (script.value === null || tower === null) return
  // Said when the tower is sent, not when the macro returns: that is when it has finished printing.
  printed.value = tower
  writeOutcome.value = null
  if (!(await printer.sendGcode(script.value, 'calibration', { timeoutMs: null }))) {
    printed.value = null
  }
}

// A note says what the last write on this tower did; on another tower it describes nothing.
watch(tab, () => {
  writeOutcome.value = null
})

/** The reading the fields describe, against the config the tower printed with. */
const draft = computed<NpaReading | null>(() => {
  const tower = activeTower.value
  if (tower === null || !isValidRange(ranges.value[tower])) return null
  const reads = towerReads(path.value, tower)
  return {
    at: Date.now(),
    path: path.value,
    tower,
    range: { ...ranges.value[tower] },
    towerHeight: towerHeight.value,
    side: reads.side ? heights.value[tower].side : null,
    front: reads.front ? heights.value[tower].front : null,
    linearAdvance: config.value.linearAdvance,
    nonlinearOffset: config.value.nonlinearOffset,
  }
})
const draftSuggestion = computed(() =>
  draft.value === null ? null : suggestFor(draft.value, readings.value),
)
const draftValue = computed(() => (draft.value === null ? null : readingValue(draft.value)))

function saveReading(): NpaReading | null {
  const reading = draft.value
  if (reading === null || draftSuggestion.value === null) return null
  calibration.recordManual(
    'nonlinearPressureAdvance',
    {
      ...readingToValues(reading),
      nozzle: String(nozzle.value ?? ''),
      targetTemp: String(targetTemp.value ?? ''),
      bedTemp: String(bedTemp.value ?? ''),
    },
    [
      {
        label: { literal: towerOption[reading.tower] },
        after: draftValue.value === null ? '' : formatTowerValue(reading.tower, draftValue.value),
      },
    ],
    'measured',
  )
  heights.value[reading.tower] = { side: null, front: null }
  return reading
}

async function actOn(suggestion: NpaSuggestion): Promise<void> {
  if (suggestion.kind === 'unreadable') {
    saveReading()
    tab.value = suggestion.first
    return
  }
  const tower = activeTower.value
  if (saveReading() === null) return
  await persist(`reading-${tower}`, [{ option: suggestion.option, value: suggestion.value }])
  if (suggestion.kind === 'keep' && suggestion.next !== null) tab.value = suggestion.next
}

function narrow(tower: NpaTower, value: number): void {
  ranges.value[tower] = rangeAround(tower, value)
}

/*
 * ------------------------------------------------------------------ tower settings
 *
 * The fields follow what Klipper loaded, so a restart after saving shows the
 * file's values rather than the ones typed.
 */
const towerSettingsOpen = ref(false)
const loadedPaTest = computed(() => readPaTest(printerConfig.section('pa_test')))
const paTest = ref<PaTestValues>({ ...loadedPaTest.value })
watch(loadedPaTest, (next) => {
  paTest.value = { ...next }
})
const paTestIssue = computed(() => paTestProblem(paTest.value))
const paTestEdits = computed(() => paTestChanges(loadedPaTest.value, paTest.value))

function paTestLabel(option: PaTestOption): string {
  return t(`calibration.npa.towerSettings.option.${option}`)
}

function paTestIssueText(issue: PaTestProblem): string {
  const option = paTestLabel(issue.option)
  if (issue.kind === 'required') {
    return t('calibration.npa.towerSettings.problem.required', { option })
  }
  if (issue.kind === 'whole') return t('calibration.npa.towerSettings.problem.whole', { option })
  if (issue.kind === 'atLeast') {
    return t('calibration.npa.towerSettings.problem.atLeast', { option, value: issue.min })
  }
  if (issue.kind === 'atMost') {
    return t('calibration.npa.towerSettings.problem.atMost', { option, value: issue.max })
  }
  const than = typeof issue.than === 'number' ? String(issue.than) : paTestLabel(issue.than)
  return t('calibration.npa.towerSettings.problem.above', { option, than })
}

function savePaTest(): void {
  void persist('paTest', paTestEdits.value, [], 'pa_test')
}

/*
 * ------------------------------------------------------------------ text
 */

function towerPhrase(tower: NpaTower): string {
  return t(`calibration.npa.towerPhrase.${tower}`)
}

function suggestionText(suggestion: NpaSuggestion, reading: NpaReading): string {
  if (suggestion.kind === 'unreadable') {
    return t('calibration.npa.suggestion.unreadable', {
      option: suggestion.option,
      tower: towerPhrase(suggestion.first),
    })
  }
  if (suggestion.kind === 'nudge') {
    const gap = Math.abs((reading.side ?? 0) - (reading.front ?? 0))
    return t(
      suggestion.direction === 'up'
        ? 'calibration.npa.suggestion.nudgeUp'
        : 'calibration.npa.suggestion.nudgeDown',
      {
        side: t(
          (reading.side ?? 0) < (reading.front ?? 0)
            ? 'calibration.npa.suggestion.sideBelow'
            : 'calibration.npa.suggestion.sideAbove',
          { gap: formatTowerValue('offset', gap) },
        ),
        option: suggestion.option,
        percent: formatTowerValue('offset', suggestion.step * 100),
        value: suggestion.value,
      },
    )
  }
  const agreed =
    reading.side !== null && reading.front !== null
      ? `${t('calibration.npa.suggestion.agree', { tolerance: convergenceTolerance })} `
      : ''
  const keep =
    suggestion.ideal !== undefined
      ? t('calibration.npa.suggestion.keepShare', {
          ideal: suggestion.ideal,
          option: suggestion.option,
          value: suggestion.value,
        })
      : t('calibration.npa.suggestion.keep', { option: suggestion.option, value: suggestion.value })
  const next =
    suggestion.next === null
      ? t('calibration.npa.suggestion.done')
      : t('calibration.npa.suggestion.then', { tower: towerPhrase(suggestion.next) })
  return `${agreed}${keep} ${next}`
}

function actionLabel(suggestion: NpaSuggestion): string {
  if (suggestion.kind === 'unreadable') {
    return t('calibration.npa.open', { tower: towerPhrase(suggestion.first) })
  }
  return t('calibration.npa.writeRestart', { option: suggestion.option, value: suggestion.value })
}

const nextText = computed(() => {
  if (needsStart.value) return t('calibration.npa.next.start')
  const tower = suggestedTower.value
  if (tower === null) return t('calibration.npa.next.done')
  const latest = readings.value.at(-1)
  return t(latest?.tower === tower ? 'calibration.npa.next.again' : 'calibration.npa.next.tower', {
    tower: towerPhrase(tower),
  })
})
const canOpenNext = computed(() => nextTab.value !== null && nextTab.value !== tab.value)
const nextTab = computed<Tab | null>(() => (needsStart.value ? 'start' : suggestedTower.value))

/*
 * ------------------------------------------------------------------ values
 */

const valueOptions: readonly NpaOption[] = [
  'nonlinear_offset',
  'linear_advance',
  'pressure_advance_time_offset',
]

/** The latest value a reading in this session worked out for each coefficient. */
function calculatedFor(option: NpaOption): string | null {
  for (let index = readings.value.length - 1; index >= 0; index -= 1) {
    const reading = readings.value[index]!
    const suggestion = suggestFor(reading, readings.value.slice(0, index))
    if (suggestion?.kind !== 'unreadable' && suggestion?.option === option) return suggestion.value
  }
  return null
}

const valueRows = computed(() =>
  valueOptions.map((option) => {
    const file = configValue(config.value, option)
    const calculated = calculatedFor(option)
    return {
      option,
      file: file === null ? '' : String(file),
      calculated: calculated ?? '',
      differs: calculated !== null && Number(calculated) !== file,
    }
  }),
)

const history = computed(() =>
  readings.value
    .map((reading, index) => ({
      reading,
      value: readingValue(reading),
      suggestion: suggestFor(reading, readings.value.slice(0, index)),
    }))
    .reverse(),
)

function keepReading(at: number, suggestion: NpaSuggestion): void {
  if (suggestion.kind === 'unreadable') return
  void persist(`history-${at}`, [{ option: suggestion.option, value: suggestion.value }])
}

/*
 * ------------------------------------------------------------------ clear
 *
 * Terminal: the readings are the printer's log, shared by every browser, and
 * nothing recomputes them.
 */
const confirmations = useConfirmationsStore()
const clearGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'clearPressureAdvanceReadings',
})
const confirmingClear = ref(false)

function clearAll(): void {
  confirmingClear.value = false
  calibration.clearLog('nonlinearPressureAdvance')
  for (const tower of pathTowers[path.value]) {
    ranges.value[tower] = firstRange(path.value, tower)
    heights.value[tower] = { side: null, front: null }
  }
  nozzle.value = defaultNozzle()
  targetTemp.value = defaultTargetTemp
  bedTemp.value = defaultBedTemp
  printed.value = null
  writeOutcome.value = null
  tab.value = needsStart.value ? 'start' : pathTowers[path.value][0]!
}

function requestClear(): void {
  clearGuard.request(clearAll, () => (confirmingClear.value = true))
}

function readingSummary(reading: NpaReading): string {
  const parts = [
    `${formatTowerValue(reading.tower, reading.range.from)}–${formatTowerValue(reading.tower, reading.range.to)}`,
  ]
  if (reading.side !== null) parts.push(t('calibration.npa.sideAt', { height: reading.side }))
  if (reading.front !== null) parts.push(t('calibration.npa.frontAt', { height: reading.front }))
  return parts.join(' · ')
}

const writeDisabled = computed(
  () => !klipperAvailability.value.isAvailable || printer.hasActivePrint || writing.value !== null,
)
</script>

<template>
  <CalibrationCard
    class="calibration-workspace"
    :title="t('calibration.procedure.nonlinearPressureAdvance.name')"
  >
    <p class="calibration-workspace__description">
      {{ t('calibration.procedure.nonlinearPressureAdvance.detail') }}
    </p>

    <CalibrationRequirements :requires="procedureById('nonlinearPressureAdvance')!.requires" />

    <fieldset class="calibration-choice">
      <legend class="calibration-choice__legend">{{ t('calibration.npa.path') }}</legend>
      <label class="check-row check-row--block">
        <input v-model="path" type="radio" name="npa-path" value="direct" />
        <span>{{ t('calibration.npa.pathDirect') }}</span>
      </label>
      <label class="check-row check-row--block">
        <input v-model="path" type="radio" name="npa-path" value="bowden" />
        <span>{{ t('calibration.npa.pathBowden') }}</span>
      </label>
    </fieldset>

    <div class="calibration-result">
      <table class="calibration-result__table">
        <thead>
          <tr>
            <th scope="col">{{ t('calibration.result.value') }}</th>
            <th scope="col">{{ t('calibration.npa.inFile') }}</th>
            <th scope="col">{{ t('calibration.npa.calculated') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('calibration.npa.saveRestart') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in valueRows" :key="row.option">
            <th scope="row" class="calibration-workspace__command calibration-npa__option">
              {{ row.option }}
            </th>
            <td class="calibration-result__number">{{ row.file || '—' }}</td>
            <td
              class="calibration-result__number"
              :class="{ 'calibration-result__number--changed': row.differs }"
            >
              {{ row.calculated || '—' }}
            </td>
            <td>
              <AppButton
                v-if="row.differs"
                size="xs"
                icon="save"
                :label="t('calibration.npa.saveRestart')"
                :pending="writing === `value-${row.option}`"
                :disabled="writeDisabled"
                @click="
                  persist(`value-${row.option}`, [{ option: row.option, value: row.calculated }])
                "
              />
            </td>
          </tr>
        </tbody>
      </table>
      <span
        v-if="writeOutcome && writeOutcome.id.startsWith('value-')"
        class="calibration-panel__hint"
        role="status"
        >{{ t(`calibration.result.persist.${writeOutcome.outcome}`) }}</span
      >
    </div>

    <p class="calibration-npa__next" role="status">
      <span>{{ nextText }}</span>
      <!--
        Always laid out, hidden rather than removed: the button is taller than
        the line of text, so mounting it moved everything below.
      -->
      <span
        class="calibration-npa__open"
        :class="{ 'calibration-npa__open--idle': !canOpenNext }"
        :aria-hidden="!canOpenNext"
      >
        <AppButton
          size="sm"
          :label="t('calibration.npa.next.open')"
          :disabled="!canOpenNext"
          @click="nextTab !== null && (tab = nextTab)"
        />
      </span>
    </p>

    <div class="calibration-npa__tabs" role="group" :aria-label="t('calibration.npa.towers')">
      <button
        v-for="item in tabs"
        :key="item"
        type="button"
        class="tab-select"
        :aria-pressed="tab === item"
        @click="tab = item"
      >
        {{ t(`calibration.npa.tab.${item}`) }}
      </button>
    </div>

    <template v-if="tab === 'start'">
      <p class="calibration-panel__hint">{{ t('calibration.npa.start.detail') }}</p>
      <p v-if="maxAccel !== null" class="calibration-panel__hint">
        {{ t('calibration.npa.start.accel', { accel: maxAccel }) }}
      </p>
      <p v-if="extruderUnshaped" class="calibration-panel__hint">
        {{ t('calibration.npa.start.extruderSync') }}
      </p>
      <fieldset class="calibration-choice">
        <legend class="calibration-choice__legend">pressure_advance_model</legend>
        <label v-for="name in nonlinearModels" :key="name" class="check-row check-row--block">
          <input v-model="model" type="radio" name="npa-model" :value="name" />
          <span class="calibration-choice__row">{{ name }}</span>
          <span v-if="name === 'recipr'" class="calibration-panel__hint">{{
            t('calibration.npa.start.reciprHint')
          }}</span>
        </label>
      </fieldset>
      <div class="calibration-result">
        <table class="calibration-result__table">
          <tbody>
            <tr v-for="change in startingChanges(path, model)" :key="change.option">
              <th scope="row" class="calibration-workspace__command calibration-npa__option">
                {{ change.option }}
              </th>
              <td class="calibration-result__number">{{ change.value }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="config.hasLinearAdvanceOption" class="calibration-panel__hint">
          {{ t('calibration.npa.start.removes') }}
        </p>
        <div class="calibration-result__actions">
          <AppButton
            size="sm"
            variant="primary"
            icon="save"
            :label="t('calibration.npa.start.write')"
            :pending="writing === 'start'"
            :disabled="writeDisabled || startMatches"
            @click="writeStart"
          />
          <span v-if="writeOutcome?.id === 'start'" class="calibration-panel__hint">{{
            t(`calibration.result.persist.${writeOutcome.outcome}`)
          }}</span>
          <span v-else-if="startMatches" class="calibration-panel__hint">{{
            t('calibration.npa.start.matches')
          }}</span>
        </div>
      </div>
    </template>

    <template v-else>
      <p class="calibration-panel__hint">
        {{ t(`calibration.npa.tower.read.${path}.${tab}`) }}
      </p>
      <div class="calibration-step__controls">
        <AppField
          v-model="ranges[tab].from"
          type="number"
          size="sm"
          :label="t('calibration.npa.tower.from')"
          :min="0"
        />
        <AppField
          v-model="ranges[tab].to"
          type="number"
          size="sm"
          :label="t('calibration.npa.tower.to')"
          :min="0"
        />
      </div>
      <div class="calibration-step__controls">
        <AppField
          v-model="nozzle"
          type="number"
          size="sm"
          :label="t('calibration.npa.tower.nozzle')"
          :unit="t('calibration.unit.millimetres')"
          :min="0.1"
          :max="2"
        />
        <AppField
          v-model="targetTemp"
          type="number"
          size="sm"
          :label="t('calibration.npa.tower.targetTemp')"
          :unit="t('dashboard.temperatureUnit')"
          :min="printerConfig.minExtrudeTemperature"
          :max="350"
        />
        <AppField
          v-model="bedTemp"
          type="number"
          size="sm"
          :label="t('calibration.npa.tower.bedTemp')"
          :unit="t('dashboard.temperatureUnit')"
          :min="0"
          :max="150"
        />
      </div>
      <div>
        <AppButton
          variant="quiet"
          size="xs"
          :icon="towerSettingsOpen ? 'collapse' : 'expand'"
          :label="t('calibration.npa.towerSettings.title')"
          :aria-expanded="towerSettingsOpen"
          aria-controls="npa-tower-settings"
          @click="towerSettingsOpen = !towerSettingsOpen"
        />
      </div>
      <DisclosureReveal :open="towerSettingsOpen">
        <div id="npa-tower-settings" class="calibration-npa__tower-settings">
          <p class="calibration-panel__hint">{{ t('calibration.npa.towerSettings.detail') }}</p>
          <div class="calibration-params">
            <AppField
              v-for="{ option, unit } in paTestOptions"
              :key="option"
              v-model="paTest[option]"
              type="number"
              size="sm"
              :label="paTestLabel(option)"
              v-bind="unit === null ? {} : { unit: t(`calibration.unit.${unit}`) }"
              :min="0"
            />
          </div>
          <div class="calibration-result__actions">
            <AppButton
              size="sm"
              icon="save"
              :label="t('calibration.npa.saveRestart')"
              :pending="writing === 'paTest'"
              :disabled="writeDisabled || paTestIssue !== null || paTestEdits.length === 0"
              @click="savePaTest"
            />
            <span v-if="paTestIssue" class="calibration-panel__hint" role="status">{{
              paTestIssueText(paTestIssue)
            }}</span>
            <span v-else-if="writeOutcome?.id === 'paTest'" class="calibration-panel__hint">{{
              t(`calibration.result.persist.${writeOutcome.outcome}`)
            }}</span>
          </div>
        </div>
      </DisclosureReveal>
      <div class="calibration-run">
        <code class="calibration-run__script selectable">{{
          script ?? t('calibration.bench.noScript')
        }}</code>
        <AppButton
          size="sm"
          variant="primary"
          icon="play"
          :label="t('calibration.npa.tower.print')"
          :pending="printer.pendingCommands.calibration"
          :disabled="printBlocked"
          @click="printTower"
        />
      </div>
      <p v-if="printed === tab" class="calibration-panel__hint" role="status">
        {{ t('calibration.npa.tower.printed') }}
      </p>

      <div class="calibration-step__controls">
        <AppField
          v-if="towerReads(path, tab).side"
          v-model="heights[tab].side"
          type="number"
          size="sm"
          :label="t('calibration.npa.tower.side')"
          :unit="t('calibration.unit.millimetres')"
          :min="0"
          :max="towerHeight"
        />
        <AppField
          v-if="towerReads(path, tab).front"
          v-model="heights[tab].front"
          type="number"
          size="sm"
          :label="t('calibration.npa.tower.front')"
          :unit="t('calibration.unit.millimetres')"
          :min="0"
          :max="towerHeight"
        />
      </div>
      <p class="calibration-panel__hint">
        {{ t('calibration.npa.tower.heightHint', { height: towerHeight }) }}
      </p>

      <div
        v-if="draft && draftSuggestion"
        class="calibration-result"
        role="status"
        aria-live="polite"
      >
        <p v-if="draftValue !== null" class="calibration-npa__value">
          <span class="calibration-workspace__command">{{ towerOption[tab] }}</span>
          <span class="calibration-result__number">{{ formatTowerValue(tab, draftValue) }}</span>
        </p>
        <p class="calibration-npa__suggestion">{{ suggestionText(draftSuggestion, draft) }}</p>
        <div class="calibration-result__actions">
          <AppButton
            size="sm"
            variant="primary"
            :icon="draftSuggestion.kind === 'unreadable' ? undefined : 'save'"
            :label="actionLabel(draftSuggestion)"
            :pending="writing === `reading-${tab}`"
            :disabled="draftSuggestion.kind !== 'unreadable' && writeDisabled"
            @click="actOn(draftSuggestion)"
          />
          <AppButton size="sm" :label="t('calibration.npa.tower.save')" @click="saveReading" />
          <AppButton
            v-if="draftValue !== null"
            size="sm"
            :label="t('calibration.npa.tower.narrow', { value: formatTowerValue(tab, draftValue) })"
            @click="narrow(tab, draftValue)"
          />
        </div>
      </div>
      <span v-if="writeOutcome?.id === `reading-${tab}`" class="calibration-panel__hint">{{
        t(`calibration.result.persist.${writeOutcome.outcome}`)
      }}</span>
    </template>

    <div v-if="history.length > 0" class="calibration-history">
      <div class="calibration-npa__readings-head">
        <h3 class="calibration-history__title">{{ t('calibration.npa.readings') }}</h3>
        <AppButton
          size="xs"
          :guard="clearGuard"
          :label="t('calibration.npa.clear')"
          :disabled="writing !== null"
          @click="requestClear"
        />
      </div>
      <ul class="calibration-history__list">
        <li
          v-for="item in history"
          :key="item.reading.at"
          class="calibration-history__entry calibration-npa__reading"
        >
          <span class="calibration-history__when">{{ when(item.reading.at) }}</span>
          <div class="calibration-history__body">
            <span>{{ t(`calibration.npa.tab.${item.reading.tower}`) }}</span>
            <span class="calibration-history__summary">{{ readingSummary(item.reading) }}</span>
            <span
              v-if="item.suggestion && item.suggestion.kind !== 'unreadable'"
              class="calibration-history__summary"
              >{{ item.suggestion.option }} {{ item.suggestion.value }}</span
            >
          </div>
          <AppButton
            v-if="
              item.suggestion &&
              item.suggestion.kind !== 'unreadable' &&
              Number(item.suggestion.value) !== configValue(config, item.suggestion.option)
            "
            class="calibration-npa__reading-action"
            size="xs"
            icon="save"
            :label="t('calibration.npa.saveRestart')"
            :pending="writing === `history-${item.reading.at}`"
            :disabled="writeDisabled"
            @click="item.suggestion && keepReading(item.reading.at, item.suggestion)"
          />
        </li>
      </ul>
      <span
        v-if="writeOutcome && writeOutcome.id.startsWith('history-')"
        class="calibration-panel__hint"
        role="status"
        >{{ t(`calibration.result.persist.${writeOutcome.outcome}`) }}</span
      >
    </div>
    <ConfirmDialog
      :open="confirmingClear"
      :title="t('calibration.npa.clearTitle')"
      :description="t('calibration.npa.clearConfirm')"
      :confirm-label="t('calibration.npa.clear')"
      tone="danger"
      show-skip-option
      @confirm="clearAll"
      @cancel="confirmingClear = false"
      @skip="confirmations.setSkip('clearPressureAdvanceReadings', true)"
    />
  </CalibrationCard>
</template>
