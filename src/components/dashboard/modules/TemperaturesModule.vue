<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import TemperatureChart from '@/components/dashboard/modules/TemperatureChart.vue'
import TemperaturesQuickSettings from '@/components/dashboard/modules/TemperaturesQuickSettings.vue'
import {
  sensorColorVariable,
  sensorLabel as sensorDisplayLabel,
} from '@/components/dashboard/modules/temperatureSensors'
import {
  readChartHeight,
  readChartWindowMinutes,
  type ChartHeightOption,
} from '@/components/dashboard/modules/temperaturesChartSettings'
import {
  configBoolean,
  configOptionalStringList,
  configStringMap,
  useDashboardModule,
} from '@/dashboard/context'
import { readPresets, type TemperaturePreset } from '@/dashboard/temperaturePresets'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { pointsWithin, useTelemetryStore, type SensorReading } from '@/stores/telemetry'

/** The nudge step, matching Movement's small-step convention rather than a config choice. */
const nudgeStep = 5
/** Below this a fitted rate reads as noise, not a trend worth printing. */
const minimumDisplayedRate = 0.1
/** Below this an estimate flashes past rather than being read. */
const minimumDisplayedEta = 5
// Re-scaled when the chart gained axes: 4rem left no room for a label row.
const chartHeightRem: Record<ChartHeightOption, number> = { compact: 6, standard: 9, tall: 13 }

/**
 * Samples drawn from before the window's own floor, so the trace runs out past
 * the plot's clipped left edge instead of ending somewhere inside it.
 *
 * Two things push the drawn line's start later than that floor, and they add
 * up. The floor almost never lands on a sample, so the last one before it can
 * be milliseconds earlier — that is the first. The second is the scroll: while
 * the axis slides between two samples, the visible left edge sits up to a full
 * sample interval earlier than the floor (ADR 0004's scrolling time-axis
 * exception). A single spare sample covers neither reliably once the cadence
 * jitters, and it does — the store appends on a one-second floor against a
 * feed arriving four times a second, so gaps run about 1.0–1.25s. Simulated
 * against that cadence, one spare left the line starting as much as 1.2s
 * inside the edge, which is the gap opening and snapping shut once a second
 * that this is set to three to remove. All three are clipped, so they cost
 * three points on a path already holding hundreds.
 */
const chartBleedSamples = 3

const { locale, t } = useI18n({ useScope: 'global' })
const telemetry = useTelemetryStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const { config, isSettingsOpen } = useDashboardModule('temperatures')

const showChart = computed(() => configBoolean(config.value, 'showChart', true))
// Option lists, fallbacks, and their validation live in
// `temperaturesChartSettings.ts`, shared with the settings fields so the two
// cannot drift.
const chartHeight = computed(() => readChartHeight(config.value))
const chartWindowMinutes = computed(() => readChartWindowMinutes(config.value))
/**
 * On by default: the gap between a reading and the setpoint it is climbing
 * toward is the whole reason to watch this chart. The control that turns it off
 * sits with the rest of the chart's shape, in `TemperaturesChartSettingsFields`
 * — it shipped as a stored key with no control anywhere, which is a setting
 * only a hand-edited profile could reach.
 */
const showChartTargets = computed(() => configBoolean(config.value, 'showChartTargets', true))
/**
 * Fit the axis to what is on screen, or hold it at what the machine can reach.
 * A fixed axis is the easiest of all to read across time, because every frame
 * is the same frame — at the cost of a bed heat-up occupying a seventh of a
 * plot scaled for a 300° hotend.
 */
const chartAutoScale = computed(() => configBoolean(config.value, 'chartAutoScale', true))
/**
 * Off by default. Zero is a real reference for a temperature and a floor that
 * never moves at all, but on an idle printer it spends the plot on nothing —
 * readings of 29 and 35 drew a 0–50 axis and occupied a eighth of its height.
 * Anchoring is worth choosing, not worth assuming.
 */
const chartZeroBaseline = computed(() => configBoolean(config.value, 'chartZeroBaseline', false))

/**
 * Material presets, editable in the settings surface. They were hard-coded at
 * PLA 210/60, PETG 240/80 and ABS 250/100 — a guess about someone else's
 * filament, on a card whose whole job is this machine's temperatures.
 */
const presets = computed(() => readPresets(config.value))

/**
 * Off by default. Duty answers a diagnostic question — is this heater
 * saturated and still not climbing — and the rail beside each name already
 * shows it live, so the trace is for the case where the history matters.
 */
const chartShowPower = computed(() => configBoolean(config.value, 'chartShowPower', false))

/** Colors the user has chosen, over the stable default each sensor derives. */
const sensorColors = computed(() => configStringMap(config.value, 'sensorColors'))

/**
 * The sensors this card lists. A never-customized instance shows all of them —
 * a printer reports its MCU and host temperatures alongside the ones anyone
 * watches, and a card that cannot drop those spends rows on numbers nobody
 * reads — but once the user has touched the list, an explicitly empty one
 * means none, not a reset back to "all". See `configOptionalStringList`.
 */
const listedSensors = computed(() => {
  const configured = configOptionalStringList(config.value, 'listSensors')
  if (configured === null) return telemetry.sensors
  return telemetry.sensors.filter((sensor) => configured.includes(sensor.objectName))
})

const chartSeries = computed(() => {
  const configured = configOptionalStringList(config.value, 'chartSeries')
  if (configured === null) {
    return telemetry.sensors.filter((sensor) => sensor.isSettable)
  }
  return telemetry.sensors.filter((sensor) => configured.includes(sensor.objectName))
})
/** The hottest any charted sensor is configured to reach. */
const chartFixedMaximum = computed(() => {
  if (chartAutoScale.value) return null
  const limits = chartSeries.value.map(
    (sensor) => printerConfig.limitsFor(sensor.objectName).maximum,
  )
  return limits.length > 0 ? Math.max(...limits) : null
})

/**
 * The history array's own newest sample, rather than `telemetry.lastEventtime`
 * — which ticks on every status push, roughly four times a second, while a
 * new history point lands once a second at most (`historyIntervalSeconds` in
 * `telemetry.ts`). Feeding the faster clock to the chart's time axis let the
 * window's right edge creep ahead of the data between history pushes, then
 * jump the trace forward to catch up once one arrived — worst on the
 * one-minute window, where that gap is a visible fraction of the whole plot.
 * Pegging the axis to the same sample the drawn points come from means the
 * axis and the trace move together; the chart itself then scrolls the gap
 * between two samples smoothly, per ADR 0004's scrolling time-axis exception.
 */
const chartLatestEventtime = computed(
  () => telemetry.temperatureHistory[telemetry.temperatureHistory.length - 1]?.eventtime ?? null,
)

/**
 * Klipper's `eventtime` is a monotonic clock with no relation to the wall, so
 * the chart cannot label a time without being told where the two meet. The
 * newest sample is happening now, which fixes the offset for every older one.
 *
 * Milliseconds matter here even though the axis only ever labels whole
 * minutes: `Date#getSeconds()` truncates to a whole second, while eventtime is
 * a continuously advancing float. Subtracting a float from a value that only
 * steps once a second produced an offset that sawtoothed by up to a full
 * second, every second — invisible while the chart's own trace was drifting
 * for the same reason (both errors read as one motion), but a distinct,
 * visible wobble in the grid lines once the trace was fixed to move in step
 * with its data instead.
 *
 * Local time, not UTC — the labels name the clock on the wall in the room with
 * the printer. `Date#getHours()` and friends are what carry the zone; a
 * `Date.now() % 86400` reading is a whole timezone out and looked plausible
 * doing it, since the labels are still well-formed times.
 *
 * Held in a ref behind a deadband rather than recomputed from every sample.
 * The two clocks both advance a second per second, so the true offset is a
 * constant, and each fresh measurement of it only adds that message's own
 * latency. Re-registering on every sample fed that jitter straight into the
 * position of every gridline, which is a wobble once a second on an axis whose
 * whole job here is to slide evenly. The band is wide enough to swallow
 * latency and narrow enough to re-register on a real discontinuity — a printer
 * restart, a clock change, or a tab waking after a suspend.
 */
const wallClockDeadbandSeconds = 0.25
const wallClockOffsetSeconds = ref(0)

function localSecondsToday(): number {
  const now = new Date()
  return (
    now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000
  )
}

watch(
  chartLatestEventtime,
  (latest) => {
    if (latest === null) return
    const measured = localSecondsToday() - latest
    if (Math.abs(measured - wallClockOffsetSeconds.value) > wallClockDeadbandSeconds) {
      wallClockOffsetSeconds.value = measured
    }
  },
  { immediate: true },
)

/**
 * The moment the chart is being read at, or null while it shows the present.
 * Held here rather than in the chart because the table is what displays it —
 * see the note on the cursor in `TemperatureChart.vue`.
 */
const cursorEventtime = ref<number | null>(null)

/** The recorded sample nearest the cursor, so every row reads the same moment. */
const cursorPoint = computed(() => {
  const at = cursorEventtime.value
  if (at === null) return null
  let nearest: (typeof telemetry.temperatureHistory)[number] | null = null
  let distance = Number.POSITIVE_INFINITY
  for (const point of telemetry.temperatureHistory) {
    const gap = Math.abs(point.eventtime - at)
    if (gap < distance) {
      distance = gap
      nearest = point
    }
  }
  return nearest
})

/** Wall-clock time of the moment being read, for the heading that names it. */
const cursorLabel = computed(() => {
  const point = cursorPoint.value
  if (!point) return null
  const seconds = point.eventtime + wallClockOffsetSeconds.value
  const inDay = ((Math.round(seconds) % 86400) + 86400) % 86400
  const hours = Math.floor(inDay / 3600)
  const minutes = Math.floor((inDay % 3600) / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
})

interface ChartSeriesInput {
  objectName: string
  label: string
  activeTarget: number | null
}

/**
 * The chart's identity inputs — which sensors are drawn, what each is called,
 * and the setpoint it is aiming for — held to a stable reference while their
 * contents are unchanged. The sensor objects behind them get a fresh identity
 * on every status push (~4/s, live readings move that often), and a computed
 * only spares its dependents when its own value is reference-equal — so
 * without this barrier the point extraction below, and the downsampling and
 * path building it feeds in `TemperatureChart`, re-ran per push instead of
 * per sample. Returning `previous` unchanged is what stops the cascade.
 */
const chartSeriesInputs = computed<ChartSeriesInput[]>((previous) => {
  const next = chartSeries.value.map((sensor) => ({
    objectName: sensor.objectName,
    label: sensorLabel(sensor),
    activeTarget: sensor.target,
  }))
  if (
    previous &&
    previous.length === next.length &&
    previous.every(
      (entry, index) =>
        entry.objectName === next[index]!.objectName &&
        entry.label === next[index]!.label &&
        entry.activeTarget === next[index]!.activeTarget,
    )
  ) {
    return previous
  }
  return next
})

/**
 * Recomputes when a history sample lands (once a second — see
 * `historyIntervalSeconds` in `telemetry.ts`), a target moves, or the charted
 * set changes — not on every status push. The chart cannot draw a sample the
 * history does not hold yet, so the faster feed had nothing to offer it; the
 * live readings in the table above keep their per-push freshness.
 */
const chartSeriesData = computed(() =>
  chartSeriesInputs.value.map((input) => ({
    objectName: input.objectName,
    label: input.label,
    color: colorFor(input.objectName),
    points: pointsWithin(
      telemetry.temperatureHistory,
      input.objectName,
      chartWindowMinutes.value * 60,
      'values',
      chartBleedSamples,
    ),
    targetPoints: pointsWithin(
      telemetry.temperatureHistory,
      input.objectName,
      chartWindowMinutes.value * 60,
      'targets',
      chartBleedSamples,
    ),
    powerPoints: pointsWithin(
      telemetry.temperatureHistory,
      input.objectName,
      chartWindowMinutes.value * 60,
      'powers',
      chartBleedSamples,
    ),
    activeTarget: input.activeTarget,
  })),
)

const decimalFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)
const integerFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)
const rateFormatter = computed(
  () =>
    new Intl.NumberFormat(locale.value, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero',
    }),
)

function colorFor(objectName: string): string {
  return sensorColorVariable(objectName, sensorColors.value)
}

/**
 * What the Current column shows: the live reading, or the one at the moment
 * being read out of the chart. The target field never follows the cursor —
 * acting on a value from four minutes ago is the one thing this must not
 * invite.
 */
function displayedTemperature(sensor: SensorReading): number | null {
  const point = cursorPoint.value
  if (!point) return sensor.temperature
  return point.values[sensor.objectName] ?? null
}

/**
 * What the detail line's power figure shows: the live duty, or the one
 * recorded at the moment being read out of the chart — the same substitution
 * `displayedTemperature` makes, so scrubbing the chart reads out one
 * consistent moment across every number on the card, not just the
 * temperature.
 */
function displayedPower(sensor: SensorReading): number | null {
  const point = cursorPoint.value
  if (!point) return sensor.power
  return point.powers?.[sensor.objectName] ?? null
}

function temperature(value: number | null): string {
  return value === null ? t('dashboard.unavailableValue') : decimalFormatter.value.format(value)
}

function percent(value: number | null): string {
  return value === null
    ? t('dashboard.unavailableValue')
    : integerFormatter.value.format(Math.round(value * 100))
}

function sensorLabel(sensor: SensorReading): string {
  return sensorDisplayLabel(sensor, t)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

async function setTarget(sensor: SensorReading, target: number): Promise<void> {
  const sent =
    sensor.kind === 'temperatureFan'
      ? await printer.setTemperatureFanTarget(sensor.objectName, target)
      : await printer.setHeaterTarget(sensor.objectName, target)
  // A refused command leaves the printer on the target it always had, so
  // nothing about the field's model changes and its box would go on showing a
  // value the machine never accepted — see `refusedTargets`.
  if (!sent) refusedTargets.value += 1
}

/**
 * Counts refusals, and is in every target field's `key` so that a refusal
 * rebuilds them. A field re-seeds its box when its model changes, and a refused
 * command changes nothing: the printer is still on the target it always had, so
 * the box would keep showing the number that was rejected with only the card's
 * failure line to say otherwise — and it would keep showing it for as long as
 * that target went unchanged, which on an idle heater is indefinitely. The
 * hand-rolled draft this replaced could simply be assigned back; a component
 * that owns its own draft has to be rebuilt instead. Rebuilding also takes the
 * caret out of the row, which is right: the edit is over and it failed.
 */
const refusedTargets = ref(0)

/**
 * The setpoint the field renders, rounded to whole degrees. Klipper reports a
 * float, `AppField` shows its model exactly as given rather than through a
 * formatter, and a box reading `59.999999` is one nobody wants to type over.
 */
function targetValue(sensor: SensorReading): number | null {
  return sensor.target === null ? null : Math.round(sensor.target)
}

/**
 * `AppField` owns the draft and the focus guard that this module used to hold
 * by hand — a `targetDrafts` record, a `focusedTarget` flag, and a
 * `lastSeenTargets` map that existed only so one sensor's status push could not
 * resync another sensor's row. See the component's own doc comment for why
 * several call sites each grew a copy of that rule rather than one of them
 * owning it. The field binds `:model-value` one-way, so `5` on the way to
 * typing `50` never reaches the printer; the commit does.
 *
 * A refused command is not reverted here the way the hand-rolled draft was:
 * the field renders the printer's own target, so it settles back on the next
 * status push once the box is left, and the card's shared failure line is what
 * reports the refusal. Clamping is this module's job rather than the field's,
 * because `min` and `max` on a number input bound a stepper press and not a
 * typed value — sending a heater past its configured `max_temp` earns a
 * Klipper error where the nudge buttons beside it have always clamped.
 */
function commitTarget(sensor: SensorReading, value: number | null): void {
  if (value === null) return
  void setTarget(sensor, clamp(Math.round(value), 0, limitFor(sensor)))
}

/**
 * The target field's accessible name, which cannot be its visible label: the
 * notch holds the live reading, and a screen reader announcing a bare number
 * where "Target for the hotend" belongs would name the field after what it
 * reports rather than after what typing into it does. The reading is folded
 * into the name instead, because the notch is now the only place the card
 * states it — dropping it would leave the sensor's actual temperature
 * unreachable to anyone not reading the border.
 */
function targetFieldLabel(sensor: SensorReading): string {
  const heater = sensorLabel(sensor)
  const current = displayedTemperature(sensor)
  if (current === null) return t('dashboard.temperature.targetLabel', { heater })
  return t('dashboard.temperature.targetLabelCurrent', {
    heater,
    current: temperature(current),
    unit: t('dashboard.temperatureUnit'),
  })
}

function quickOff(sensor: SensorReading): Promise<void> {
  return setTarget(sensor, 0)
}

/**
 * A `temperature_fan` has no off, so it is not offered one.
 *
 * Klipper runs such a fan whenever its sensor reads *above* the target, so
 * `TARGET=0` is not "stop" — it is "run whenever this thing is warmer than
 * absolute zero", which is a fan pinned on forever. The button was shipped
 * doing exactly that: an Off that turned the fan permanently on. The nudge
 * buttons beside it stay, because moving a fan's threshold up or down is a real
 * thing to want; only the word "Off" was a lie.
 */
function hasQuickOff(sensor: SensorReading): boolean {
  return sensor.kind !== 'temperatureFan'
}

function nudge(sensor: SensorReading, delta: number): Promise<void> {
  const next = clamp((sensor.target ?? 0) + delta, 0, limitFor(sensor))
  return setTarget(sensor, next)
}

function signedNudge(delta: number): string {
  const formatted = integerFormatter.value.format(Math.abs(delta))
  return delta < 0 ? `−${formatted}` : `+${formatted}`
}

function hasActiveTarget(sensor: SensorReading): boolean {
  return sensor.target !== null && sensor.target > 0
}

function powerPercent(sensor: SensorReading): number {
  return sensor.power === null ? 0 : clamp(Math.round(sensor.power * 100), 0, 100)
}

function formatShortDuration(seconds: number): string {
  if (seconds < 60) return t('dashboard.duration.seconds', { seconds: Math.round(seconds) })
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0
    ? t('dashboard.duration.hoursMinutes', { hours, minutes })
    : t('dashboard.duration.minutes', { minutes })
}

/**
 * What the heater is doing, in one phrase. Null once there is nothing reliable
 * to say, rather than a guess dressed as one.
 *
 * `timeToTarget` returning zero means arrived, which used to render as "~0s"
 * and then vanish — an absence where the useful reading is that the heater has
 * settled and is now holding. The rate is the fallback for when no ETA can be
 * trusted, most usefully during a stall, where it is the number that explains
 * why no ETA is shown.
 */
function statusPhrase(sensor: SensorReading): string | null {
  // A stalled heater has a warning to show instead, and the two cannot share
  // the readout: they are the same answer at different confidence, and putting
  // both up meant the warning arriving shoved the estimate sideways.
  if (isStalled(sensor)) return null
  const seconds = telemetry.timeToTarget(sensor.objectName)
  // Arrival first: a heater that is there is holding, not almost there.
  if (seconds === 0) return t('dashboard.temperature.atTarget')
  // Below this an estimate is a number that appears, counts down through a
  // handful of frames and vanishes — noise where the useful reading is that
  // the heater is about to be there. Applies to the tail of every climb, not
  // only to a heater fast enough to arrive inside one.
  if (seconds !== null && seconds < minimumDisplayedEta) {
    return t('dashboard.temperature.almostThere')
  }
  if (seconds !== null) {
    return t('dashboard.temperature.eta', { duration: formatShortDuration(seconds) })
  }
  const rate = telemetry.rateOfChange(sensor.objectName)
  if (rate === null || Math.abs(rate) < minimumDisplayedRate) return null
  return t('dashboard.temperature.rate', { rate: rateFormatter.value.format(rate) })
}

/**
 * The exact-figure half of the detail line. Power lives here because the
 * rail beside the sensor's name only shows it as a proportion — the rail
 * answers "is this heater working", this answers "how hard". Reads out of
 * `displayedPower`, so scrubbing the chart rewrites this figure along with
 * the Current column rather than leaving it pinned to the live reading — and
 * it is kept apart from the status phrase beside it so the template can give
 * it, alone, the same per-sensor color the Current column takes on a scrub.
 */
function detailPower(sensor: SensorReading): string | null {
  const power = displayedPower(sensor)
  return power === null ? null : `${percent(power)}${t('dashboard.percentUnit')}`
}

function isStalled(sensor: SensorReading): boolean {
  return hasActiveTarget(sensor) && telemetry.isStalled(sensor.objectName)
}

/**
 * Cooling down an already-cold machine is a command that does nothing, so the
 * control says so rather than accepting a press and reporting success.
 *
 * Heaters only, because `TURN_OFF_HEATERS` is what the control sends and that
 * command does not touch a `temperature_fan`. Counting a fan's target here left
 * the button enabled on a machine where the only thing with a setpoint was one
 * Klipper would not act on: the press succeeded, nothing changed, and the
 * button stayed lit offering the same nothing again.
 */
const hasAnyActiveTarget = computed(() =>
  telemetry.sensors.some((sensor) => sensor.kind !== 'temperatureFan' && hasActiveTarget(sensor)),
)

/**
 * A preset applies to the two heaters it names, each clamped to that heater's
 * own configured `max_temp` — the same clamp `commitTarget` applies to a typed
 * target, and for the same reason: a hand-edited or catalogue-sourced preset of
 * 400° on a 300° hotend is otherwise a button that reliably earns a Klipper
 * error instead of setting a temperature.
 *
 * A null temperature is a heater the preset deliberately leaves alone, so it is
 * skipped rather than sent as the zero it used to become. See
 * `temperaturePresets.ts` for why the two have to be different values.
 */
async function applyPreset(preset: TemperaturePreset): Promise<void> {
  const hotend = telemetry.readings.extruder
  if (hotend && preset.extruder !== null) {
    await printer.setHeaterTarget('extruder', clamp(preset.extruder, 0, limitFor(hotend)))
  }
  const bed = telemetry.readings.heater_bed
  if (bed && preset.bed !== null) {
    await printer.setHeaterTarget('heater_bed', clamp(preset.bed, 0, limitFor(bed)))
  }
}

/**
 * What a preset button promises, which has to name what it will not touch as
 * well as what it will — a button reading `Hotend 240 °C` alone says nothing
 * about whether pressing it also moves the bed.
 */
function presetTitle(preset: TemperaturePreset): string {
  const unit = t('dashboard.temperatureUnit')
  if (preset.extruder === null) {
    return t('dashboard.temperature.presetDetailBedOnly', { bed: preset.bed, unit })
  }
  if (preset.bed === null) {
    return t('dashboard.temperature.presetDetailHotendOnly', { hotend: preset.extruder, unit })
  }
  return t('dashboard.temperature.presetDetail', {
    hotend: preset.extruder,
    bed: preset.bed,
    unit,
  })
}

function limitFor(sensor: SensorReading): number {
  return Math.round(printerConfig.limitsFor(sensor.objectName).maximum)
}

/**
 * Switching a heater off, applying another material's preset and cooling the
 * whole machine down are all refused while a job is *loaded*, not merely while
 * one is moving — `hasActivePrint`, which is paused as well as printing. The
 * card gated these on `isPrinting`, so the moment a print paused it offered all
 * three, enabled, and each of them ends the paused job rather than interrupting
 * it: the part cools off the plate, the nozzle sets solid, and resuming reheats
 * from cold into a print that has already moved. It is the same line
 * `MovementModule` draws for homing and motors-off, and the same one the module
 * plan states as "a paused print is a loaded print".
 *
 * Nudging a target by a few degrees is the deliberate exception and stays
 * enabled, printing or paused: leaning on a temperature by 5° is an ordinary
 * mid-print adjustment, and it is often exactly why someone opened this card.
 */
const hasJobLoaded = computed(() => printer.hasActivePrint)
</script>

<template>
  <AppDashboardModule :open="isSettingsOpen">
    <template #quick-settings>
      <TemperaturesQuickSettings />
    </template>

    <!--
      The query container is this module's own content, not the shell around
      it: `AppDashboardModule` is generic and carries nothing module-specific,
      so a card that wants its rows to answer their own width declares that
      here — the same shape `PrintModule` already uses for `print-card`. The
      wrapper is unpadded, so its content box is exactly the padded shell
      root's was, and `@container temperature-card` still resolves against
      the same width it always did.
    -->
    <div class="temperature-card space-y-4">
      <div v-if="listedSensors.length > 0" class="module-table temperature-table">
        <!--
        No head row at all. Every column here names itself: the reading and its
        target are one labeled field, and the sensor's own name is the row.
        `Name` over a column of names was a label restating its contents, and it
        cost a row of caps at the top of the densest card on the dashboard.

        The row's other tenant — the caption naming which moment the table is
        being read at — moved onto the chart, and had to. Measured, an empty head
        row does collapse to nothing, but then the caption appearing on a scrub
        grew the table by 22px and pushed the chart down that far *under the
        pointer doing the scrubbing*. A caption in flow either reserves its
        height always or moves the thing it describes; out of flow, over the plot
        it belongs to, it does neither.
      -->
        <div v-for="sensor in listedSensors" :key="sensor.objectName" class="module-table__row">
          <span
            class="temperature-rail"
            :class="{ 'temperature-rail--passive': !sensor.isSettable }"
            :style="{ '--series-color': colorFor(sensor.objectName) }"
            aria-hidden="true"
          >
            <span v-if="sensor.isSettable" class="temperature-rail__stem">
              <span
                class="temperature-rail__fill"
                :style="{ '--meter-value': `${powerPercent(sensor)}%` }"
              ></span>
            </span>
            <span class="temperature-rail__bulb"></span>
          </span>
          <span class="module-table__name">{{ sensorLabel(sensor) }}</span>
          <!--
          One field per sensor, not a reading beside a box to type in. The two
          numbers are one subject — where the heater is and where it is going —
          and the notch is what lets the field say both without a column and a
          heading each: the reading rides the border, the setpoint is the value.
          That is the same device Movement's axis boxes use, brackets included —
          a live reading in a notch is written `[25.0]`, so it cannot be read as
          the name of the box beneath it (see `interface-standards.md`) — and it
          is why the two numeric headings are gone.

          A sensor that only reports has no setpoint to type, so the reading
          takes the box itself and the notch says why nothing can be entered.
          Read-only rather than disabled: this is a reading, not a control that
          happens to be unavailable, and dimming it would say the wrong thing
          about a number that is perfectly current.
        -->
          <AppField
            v-if="sensor.isSettable"
            :key="`${sensor.objectName}-${refusedTargets}`"
            class="temperature-cell--value temperature-reading--notch"
            :class="{ 'temperature-cell--scrubbed': cursorLabel !== null }"
            :style="{ '--series-color': colorFor(sensor.objectName) }"
            align="end"
            label-align="end"
            :unit="t('dashboard.temperatureUnit')"
            :label="`[${temperature(displayedTemperature(sensor))}]`"
            :aria-label="targetFieldLabel(sensor)"
            :min="0"
            :max="limitFor(sensor)"
            :step="1"
            :model-value="targetValue(sensor)"
            @commit="(value) => commitTarget(sensor, value)"
          />
          <AppField
            v-else
            class="temperature-cell--value temperature-reading--box"
            :class="{ 'temperature-cell--scrubbed': cursorLabel !== null }"
            :style="{ '--series-color': colorFor(sensor.objectName) }"
            readonly
            align="end"
            label-align="end"
            type="text"
            :unit="t('dashboard.temperatureUnit')"
            :label="t('dashboard.temperature.passive')"
            :aria-label="t('dashboard.temperature.readingLabel', { sensor: sensorLabel(sensor) })"
            :model-value="temperature(displayedTemperature(sensor))"
          />

          <div v-if="hasActiveTarget(sensor)" class="temperature-detail">
            <div class="temperature-controls">
              <AppButton
                size="sm"
                mono
                :label="signedNudge(-nudgeStep)"
                :disabled="printer.pendingCommands.temperature"
                :aria-label="
                  t('dashboard.temperature.targetAdjust', {
                    heater: sensorLabel(sensor),
                    amount: signedNudge(-nudgeStep),
                  })
                "
                :title="
                  t('dashboard.temperature.targetAdjust', {
                    heater: sensorLabel(sensor),
                    amount: signedNudge(-nudgeStep),
                  })
                "
                @click="nudge(sensor, -nudgeStep)"
              />
              <AppButton
                size="sm"
                mono
                :label="signedNudge(nudgeStep)"
                :disabled="printer.pendingCommands.temperature"
                :aria-label="
                  t('dashboard.temperature.targetAdjust', {
                    heater: sensorLabel(sensor),
                    amount: signedNudge(nudgeStep),
                  })
                "
                :title="
                  t('dashboard.temperature.targetAdjust', {
                    heater: sensorLabel(sensor),
                    amount: signedNudge(nudgeStep),
                  })
                "
                @click="nudge(sensor, nudgeStep)"
              />
              <AppButton
                v-if="hasQuickOff(sensor)"
                variant="quiet"
                size="sm"
                icon="power"
                :label="t('dashboard.temperature.off')"
                :disabled="printer.pendingCommands.temperature || hasJobLoaded"
                :aria-label="
                  hasJobLoaded
                    ? t('dashboard.temperature.quickOffBlocked', { heater: sensorLabel(sensor) })
                    : t('dashboard.temperature.quickOff', { heater: sensorLabel(sensor) })
                "
                :title="
                  hasJobLoaded
                    ? t('dashboard.temperature.quickOffBlocked', { heater: sensorLabel(sensor) })
                    : t('dashboard.temperature.quickOff', { heater: sensorLabel(sensor) })
                "
                @click="quickOff(sensor)"
              />
            </div>
            <span class="temperature-stat">
              <span class="temperature-stat__value"
                ><span
                  v-if="detailPower(sensor) !== null"
                  :style="cursorLabel !== null ? { color: colorFor(sensor.objectName) } : undefined"
                  >{{ detailPower(sensor) }}</span
                ><template v-if="detailPower(sensor) !== null && statusPhrase(sensor)"> · </template
                >{{ statusPhrase(sensor) }}</span
              >
              <!--
                `role="alert"` rather than a `status` region kept mounted: an
                alert is announced when it is inserted, which is exactly when
                this appears, and a heater that has a target and is not reaching
                it is worth interrupting for. The icon and the words carry it
                visually — color alone never does.
              -->
              <span v-if="isStalled(sensor)" class="temperature-stat__stall" role="alert">
                <AppIcon name="warning" class="size-4" aria-hidden="true" />
                {{ t('dashboard.temperature.stalled') }}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div class="temperature-presets flex flex-wrap items-center gap-2">
        <AppButton
          v-for="(preset, index) in presets"
          :key="`${index}-${preset.name}`"
          size="sm"
          :label="preset.name"
          :disabled="printer.pendingCommands.temperature || hasJobLoaded"
          :title="hasJobLoaded ? t('dashboard.temperature.presetBlocked') : presetTitle(preset)"
          @click="applyPreset(preset)"
        />
        <AppButton
          size="sm"
          class="ms-auto"
          :disabled="printer.pendingCommands.temperature || !hasAnyActiveTarget || hasJobLoaded"
          :title="
            hasJobLoaded
              ? t('dashboard.temperature.cooldownBlocked')
              : hasAnyActiveTarget
                ? undefined
                : t('dashboard.temperature.cooldownIdle')
          "
          @click="printer.turnOffHeaters()"
        >
          <AppIcon name="snowflake" class="size-4 text-data-sky" aria-hidden="true" />
          {{ t('dashboard.temperature.cooldown') }}
        </AppButton>
      </div>

      <!--
        The frame exists only to be the caption's containing block. It is
        unpadded and has no size of its own, so the chart measures exactly the
        width it did as a direct child of the card.
      -->
      <div v-if="showChart" class="temperature-chart-frame">
        <!--
          Mounted whether or not it has anything to say: `role="status"`
          announces a change *within* a region that already exists, so rendering
          this only while scrubbing would be a region that arrives with its
          content and reliably announces neither. Empty it is out of flow and
          unpainted, so it costs nothing to keep.

          Polite, and the only thing on the card that announces: the readings
          themselves rewrite about once a second, so announcing those would talk
          over everything else, where the moment being read changes once per
          arrow key and is the fact a reader actually needs.
        -->
        <span
          class="temperature-reading-at"
          :class="{ 'temperature-reading-at--active': cursorLabel !== null }"
          role="status"
        >
          {{
            cursorLabel === null ? '' : t('dashboard.temperature.readingAt', { time: cursorLabel })
          }}
        </span>
        <TemperatureChart
          v-model:cursor-eventtime="cursorEventtime"
          :series="chartSeriesData"
          :window-seconds="chartWindowMinutes * 60"
          :height-rem="chartHeightRem[chartHeight]"
          :show-targets="showChartTargets"
          :show-power="chartShowPower"
          :lock-to-zero="chartZeroBaseline"
          :fixed-maximum="chartFixedMaximum"
          :wall-clock-offset-seconds="wallClockOffsetSeconds"
          :latest-eventtime="chartLatestEventtime"
        />
      </div>
    </div>
  </AppDashboardModule>
</template>
