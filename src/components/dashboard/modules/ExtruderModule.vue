<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppSlider from '@/components/AppSlider.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import ExtruderQuickSettings from '@/components/dashboard/modules/ExtruderQuickSettings.vue'
import { readExtruderCardSetting } from '@/components/dashboard/modules/extruderCardSettings'
import {
  extrudedBeadLength,
  isExtruderMoving,
  volumetricFlow,
} from '@/components/dashboard/modules/extruderFlow'
import {
  hasNonlinearPressureAdvance,
  readPressureAdvanceSettings,
} from '@/components/dashboard/modules/pressureAdvanceSettings'
import {
  readRetractionFields,
  retractionArguments,
  type RetractionField,
} from '@/components/dashboard/modules/retractionSettings'
import { configNumber, configStringList, useDashboardModule } from '@/dashboard/context'
import { formatMacroLabel, useMacrosStore } from '@/stores/macros'
import { useSpoolStore } from '@/stores/spool'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useTelemetryStore } from '@/stores/telemetry'

const { locale, t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const telemetry = useTelemetryStore()
const macros = useMacrosStore()
const spool = useSpoolStore()
const { config, updateConfig, isSettingsOpen, openSurface } = useDashboardModule('extruder')

/**
 * Pressure advance edits in progress.
 *
 * Seeded from the machine and re-seeded whenever it moves, which is what keeps
 * a value changed from the console or another browser reaching this card. The
 * write is unconditional: `AppField` holds the in-progress value and asserts it
 * back over anything that arrives while its box has focus, so this no longer
 * carries a focus flag of its own. See "A field renders from a draft" in
 * `docs/design/interface-standards.md`.
 *
 * `smoothTime` is null until the printer reports one. The field is empty rather
 * than pre-filled with a plausible default, because Apply sends both values at
 * once: a made-up smoothing figure would be written over the real one by
 * someone who only meant to change the advance.
 */
const drafts = reactive<{ advance: number; smoothTime: number | null }>({
  advance: 0,
  smoothTime: null,
})

// Which optional blocks the card draws; keys, defaults, and the reasoning
// behind each default live in `extruderCardSettings.ts`, shared with the
// settings rows so the two cannot drift.
const showLoadMacros = computed(() => readExtruderCardSetting(config.value, 'showLoadMacros'))
const showPressureAdvance = computed(() =>
  readExtruderCardSetting(config.value, 'showPressureAdvance'),
)
const showRetraction = computed(() => readExtruderCardSetting(config.value, 'showRetraction'))
const showManualExtrusion = computed(() =>
  readExtruderCardSetting(config.value, 'showManualExtrusion'),
)
const showExtrusionFactor = computed(() =>
  readExtruderCardSetting(config.value, 'showExtrusionFactor'),
)
const length = computed(() => configNumber(config.value, 'length', 25))
const feedrate = computed(() => configNumber(config.value, 'feedrate', 5))

/**
 * Quick picks beside each field, the same `button--value` shape Movement's
 * own jog-distance and Z-offset steps use. Every control in a feed row —
 * chip, field box, and the row's action button — sits on the `sm` tier, so
 * the row reads as one control rather than three sizes stacked side by side;
 * `sm` because that is `AppField`'s own default and the size every other
 * field on this card already uses. Fixed rather than configurable: unlike a
 * jog distance, which trades off against a printer's own travel, these are
 * just shortcuts onto a plain number field, and a second settings row to
 * edit the shortcuts would outweigh what they save.
 */
const lengthPresets = [1, 5, 10, 25, 50]
const feedratePresets = [1, 2, 5, 10, 15]

const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)
const advanceFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 4 }),
)

const hotendTemperature = computed(() => telemetry.readings.extruder?.temperature ?? null)
const minimumTemperature = computed(() => printerConfig.minExtrudeTemperature)
// Klipper refuses extrusion below min_extrude_temp, so the module says why up
// front instead of surfacing a rejected command afterwards.
const isTooCold = computed(
  () => hotendTemperature.value === null || hotendTemperature.value < minimumTemperature.value,
)
const canExtrude = computed(() => printer.extruder.canExtrude && !isTooCold.value)
/**
 * A print in progress owns the extruder's own moves; a manual extrude, retract,
 * or filament-change macro layered over it is a blob or a skipped stretch of
 * filament that the job's own e-steps never accounted for. Kept apart from
 * `canExtrude` so the status line still tells the hotend-temperature reason
 * apart from the printing one instead of both collapsing into "too cold".
 */
const canManualExtrude = computed(() => canExtrude.value && !printer.isPrinting)
/*
 * The macros this card offers, chosen by the user from what their printer
 * reports. Empty until they choose: Klipper defines no filament macros, so the
 * two names this module used to compile in were one person's `printer.cfg` and
 * every other printer got a silent blank. See `ExtruderMacroSettingsFields`.
 *
 * A configured macro the printer no longer defines keeps its button and is
 * marked missing rather than filtered out — absence is exactly the state this
 * block is being fixed for, and dropping the row would reintroduce it one layer
 * down. `macros.isMissing` answers false until discovery has run, so a card
 * mid-connection shows its buttons rather than accusing the printer of losing
 * them.
 */
const macroButtons = computed(() =>
  configStringList(config.value, 'macros').map((name) => ({
    name,
    label: formatMacroLabel(name),
    isMissing: macros.isMissing(name),
  })),
)
watch(
  () => ({
    advance: printer.extruder.pressureAdvance,
    smoothTime: printer.extruder.smoothTime,
  }),
  (reported) => {
    if (reported.advance !== null) drafts.advance = reported.advance
    if (reported.smoothTime !== null) drafts.smoothTime = reported.smoothTime
  },
  { immediate: true },
)

/**
 * Sent as a pair, because `SET_PRESSURE_ADVANCE` takes them as one command.
 * The smoothing argument is omitted entirely while the printer has not reported
 * one — the store's parameter is optional and leaving it out keeps Klipper's
 * own value, which is the honest thing to do with a number this card has never
 * seen.
 */
function applyPressureAdvance(): void {
  void printer.setPressureAdvance(drafts.advance, drafts.smoothTime ?? undefined)
}

/**
 * The value the machine is actually running, beside the one the form sets, so
 * an edit in progress can be compared against what is live.
 *
 * The card no longer adds that an applied advance is lost on the next restart.
 * `SET_PRESSURE_ADVANCE` stages nothing, so `configfile.save_config_pending`
 * is never true for it and there is genuinely no notification behind the fact
 * — but a runtime `SET_` command not surviving a restart is how every one of
 * them behaves, and stating it under two of this card's blocks was telling
 * the reader what they already know about their own firmware.
 */
const activeAdvanceLabel = computed(() =>
  t('dashboard.extruder.currentAdvance', {
    value: advanceFormatter.value.format(printer.extruder.pressureAdvance ?? 0),
  }),
)

/*
 * Where the firmware describes pressure advance as a model with coefficients,
 * the card reads them instead of offering to edit them.
 *
 * `SET_PRESSURE_ADVANCE` has no parameter for `pressure_advance_model`, so the
 * curve can only be chosen in `printer.cfg` — and a form that let you tune
 * coefficients of a model you cannot select is a control that is half connected
 * to the thing it appears to govern. The whole block goes read-only rather than
 * splitting into editable and non-editable halves, because the split would sit
 * exactly where the reader cannot see it.
 *
 * These are configured values, not live ones: the `extruder` status object
 * reports `pressure_advance` and `smooth_time` and none of the coefficients, so
 * there is no notification behind them. The block is headed for the model
 * rather than for the tuning control the editable form offers, which is the
 * honest framing for values re-read when Klipper restarts rather than pushed
 * as they change.
 *
 * The `readonly` fields are what say the values cannot be edited here. A
 * caption spelling out that this firmware sets the model in `printer.cfg` was
 * cut: someone running a firmware whose model lives in their own config file
 * put it there, and an inert field already reads as inert.
 */
const isNonlinearAdvance = computed(() =>
  hasNonlinearPressureAdvance(printerConfig.extruderSettings),
)
const configuredAdvanceSettings = computed(() =>
  readPressureAdvanceSettings(printerConfig.extruderSettings),
)

/*
 * Firmware retraction — retraction the printer performs itself, so a slicer can
 * ask for one with `G10` instead of emitting its own E moves, and so the
 * lengths can be tuned mid-print without reslicing.
 *
 * Gated on the printer reporting the settings at all, which happens only where
 * the config declares `[firmware_retraction]`. That is a section its owner added
 * deliberately, so unlike pressure advance — which every printer has and most
 * people touch once — its presence is itself the statement of intent, and the
 * block defaults on rather than off.
 */
const retractionFields = computed<RetractionField[]>(() =>
  readRetractionFields(printer.retraction.settings),
)
const hasRetraction = computed(
  () => printer.retraction.hasSettings && retractionFields.value.length > 0,
)

/**
 * The restart baseline is a different source from the live values above.
 * `SET_RETRACTION` changes `firmware_retraction`'s status object, but it does
 * not change `configfile.settings`; keeping the two separate is what lets a
 * field that now reports 61 still offer to restore the configured 60.
 *
 * Klipper's resolved config is untrusted at this boundary. Only finite numeric
 * entries become reset targets, so a missing or malformed option disables the
 * reset for that field instead of inventing a baseline.
 */
const configuredRetraction = computed<Record<string, number>>(() => {
  const section = printerConfig.section('firmware_retraction')
  if (section === null) return {}

  return Object.fromEntries(
    Object.entries(section).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ),
  )
})

function retractionResetProps(field: RetractionField) {
  const value = configuredRetraction.value[field.key]
  return value === undefined ? {} : { canReset: true, resetValue: value }
}

/**
 * Each field commits on its own — `AppField`'s one-way `:model-value` plus
 * `@commit`, the same as Movement's axis boxes — rather than a batch of
 * drafts an Apply button reads. `SET_RETRACTION` still takes every value in
 * one command, so a single committed field is folded into the rest of what
 * the printer currently reports rather than sent alone; the other fields'
 * own edits, if any are mid-edit, are untouched, since each is its own
 * `AppField` with its own draft.
 */
function commitRetraction(field: RetractionField, value: number | null): void {
  if (value === null) return
  const values = { ...printer.retraction.settings, [field.key]: value }
  void printer.setRetraction(retractionArguments(retractionFields.value, values))
}

/*
 * The extrusion factor belongs to this card because Klipper multiplies
 * `extrude_factor` into every `G1 E` it processes — including the manual
 * extrude and retract below. It was previously on the Print card, where it
 * scaled these buttons from a place that never mentioned them.
 *
 * A draft rather than a binding onto the store: this mirrors a value a
 * connected printer pushes several times a second, so `:value` bound to the
 * live figure would reset the field mid-keystroke. Seeded once and re-seeded
 * whenever the machine's own value moves, which is what keeps the reading
 * current when the console, a macro, or another browser changes it.
 */
const extrusionFactor = ref(100)

watch(
  () => printer.motion.extrusionFactor,
  (value) => (extrusionFactor.value = Math.round(value * 100)),
  { immediate: true },
)

/**
 * Both halves of the control commit through here, so the slider and the field
 * are two views of one number rather than two controls that agree by accident.
 * The bounds match `setExtrusionFactor`'s own clamp: a field that accepted 200
 * and quietly sent 150 would be a control that misreports what it did.
 */
function commitExtrusionFactor(value: number): void {
  const percent = Number.isFinite(value) ? Math.round(Math.min(150, Math.max(50, value))) : 100
  extrusionFactor.value = percent
  void printer.setExtrusionFactor(percent)
}

/**
 * What the current length and feedrate would actually push out the nozzle,
 * once filament diameter is converted to bead diameter. Null without a known
 * filament diameter (from the active spool) or nozzle diameter (from
 * Klipper's own `[extruder]` section) — the same refusal-to-guess posture
 * `volumetricFlow` already takes, since both a fabricated bead length and a
 * fabricated flow are numbers someone could act on.
 */
const extrusionPreview = computed(() => {
  const filamentDiameter = spool.activeSpool?.filament?.diameter
  const nozzleDiameter = printerConfig.extruderGeometry.nozzleDiameter
  const beadLength = extrudedBeadLength(length.value, filamentDiameter, nozzleDiameter)
  const flow = volumetricFlow(feedrate.value, filamentDiameter)
  if (beadLength === null || flow === null || nozzleDiameter === null) return null
  return { beadLength, flow, nozzleDiameter }
})

/**
 * `motion_report` pushes a change only when the value actually changes, so a
 * printer holding one exact extrusion speed across a long straight segment
 * never re-fires the reading at all. A hold keyed to "when did a sample last
 * arrive" would read that silence as the flow having stopped and decay to
 * zero while the extruder is still running exactly as before — which is the
 * "drops to 0" this once did. Judged against the printer's current reported
 * value on every tick instead, so a sustained reading keeps re-crediting
 * itself rather than aging out for having never changed.
 */
const peakWindowMs = 1000
const peakExtruderVelocity = ref(0)
let peakSetAt = 0

/** Below this the toolhead is not meaningfully moving — Movement's own threshold for `live_velocity`. */
const toolheadMovingThreshold = 0.5

/**
 * Whether the current reading is even eligible to be shown.
 *
 * A bare E-only move — retract or unretract, with no X/Y/Z component — pulls
 * filament back through the bowden tube rather than melting it through the
 * nozzle, so it runs at whatever speed `firmware_retraction` was configured
 * with, which is easily double or triple a real print's flow and would read
 * as an absurd melt rate if credited at face value. Excluded only while a
 * print is running, because that is the only time an E-only move is
 * retraction rather than this card's own manual Extrude/Retract buttons —
 * which move the extruder the same way, and whose whole reason for having a
 * live reading is to show that they are doing it.
 */
function isCreditableSample(toolheadVelocity: number): boolean {
  return !printer.isPrinting || toolheadVelocity >= toolheadMovingThreshold
}

/**
 * A negative-zero reading. Klipper reports a retract's tail-end velocity with
 * the sign of its own direction, so a settled retract can report exactly
 * `-0` — a value `Intl.NumberFormat` prints as "-0", a distinct-looking
 * reading for something that means precisely zero. Checked against the same
 * rounding the display itself uses, since a value that only rounds to zero —
 * `-0.02` at one decimal place — hits the same defect.
 */
function withoutNegativeZero(value: number, fractionDigits: number): number {
  return Number(value.toFixed(fractionDigits)) === 0 ? 0 : value
}

function tick(): void {
  const now = Date.now()
  const credible = isCreditableSample(printer.motion.liveVelocity)
  const candidate = withoutNegativeZero(credible ? printer.motion.liveExtruderVelocity : 0, 1)
  const stillHolding = now - peakSetAt < peakWindowMs
  if (stillHolding && Math.abs(candidate) < Math.abs(peakExtruderVelocity.value)) return
  peakExtruderVelocity.value = candidate
  peakSetAt = now
}

watch(() => [printer.motion.liveExtruderVelocity, printer.motion.liveVelocity], tick, {
  immediate: true,
})

let peakTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  peakTimer = setInterval(tick, 100)
})
onUnmounted(() => {
  if (peakTimer !== undefined) clearInterval(peakTimer)
})

/*
 * What the extruder is doing at this instant, held over the trailing second.
 *
 * Without it a slow purge and an extrude Klipper silently refused look
 * identical — the same defect Movement named for the toolhead and fixed only
 * there. It sits beside the state sentence rather than replacing it: what the
 * extruder is allowed to do and what it is doing are different facts, and
 * during a print the state never changes while this is the only line that
 * does.
 *
 * It never animates. ADR 0004 forbids animating telemetry at its own update
 * frequency; the number changes when the peak-hold above says it changed.
 */
const isMoving = computed(() => isExtruderMoving(peakExtruderVelocity.value))

/**
 * Volumetric flow, when the filament's diameter is known — which is to say,
 * when Spoolman has an active spool whose filament records one. Absent
 * otherwise rather than computed from an assumed 1.75 mm, since flow scales
 * with the square of the diameter and this is a figure people compare against
 * a hotend's rated limit.
 */
const flowValue = computed(() =>
  volumetricFlow(peakExtruderVelocity.value, spool.activeSpool?.filament?.diameter),
)

/**
 * The number this card shows, whichever of flow or filament speed it is.
 * Re-checked for negative zero here too: multiplying the peak by the
 * filament's cross-section can round a value that was already clean back
 * into one that isn't.
 */
const readoutValue = computed(() =>
  numberFormatter.value.format(
    withoutNegativeZero(flowValue.value ?? peakExtruderVelocity.value, 1),
  ),
)

/** The unit beside it — never derived from the number, since a diameter answers "which unit", not "which value". */
const readoutUnit = computed(() =>
  flowValue.value === null
    ? t('dashboard.extruder.millimetresPerSecondUnit')
    : t('dashboard.extruder.cubicMillimetresPerSecondUnit'),
)
</script>

<template>
  <AppDashboardModule :open="isSettingsOpen">
    <template #quick-settings>
      <ExtruderQuickSettings />
    </template>

    <!--
      What this card can do right now, and nothing else. The eyebrow read
      "EXTRUDER" under a header that now says the same thing, and the bare
      hotend reading beside it was Temperatures' subject shown a second time
      without a target or any way to change it. What survives is the gate: too
      cold to extrude, or ready. That a running print owns the extruder is not
      stated — the disabled buttons below already say so, and a print is not a
      state this card needs to explain. The temperature in the too-cold
      sentence is the threshold, not a readout.
    -->
    <div class="extruder-status">
      <p v-if="!canExtrude" class="flex items-center gap-1.5 text-alert-inline">
        <AppIcon name="emergency" class="size-3.5 shrink-0" aria-hidden="true" />
        {{
          t('dashboard.extruder.tooCold', {
            value: numberFormatter.format(minimumTemperature),
            unit: t('dashboard.temperatureUnit'),
          })
        }}
      </p>
      <p v-else class="text-xs text-muted">{{ t('dashboard.extruder.ready') }}</p>
      <!--
        What the extruder is doing outranks what it is allowed to do, so it is
        always on screen rather than only while turning — the same posture
        Movement's own feed-rate readout takes, dimming rather than
        disappearing at rest so a stalled move never looks identical to an
        idle one. Flow when the filament's diameter is known, filament speed
        otherwise. `text-value-micro` is Movement's own feed-rate size, not
        `text-value`, so the two read as the same kind of number, and
        `text-value-slot` reserves the same fixed digit width Movement's own
        readout does, so the number never shifts as its own digit count
        changes. No decorative icon here, unlike Movement's readout: every
        candidate glyph tried for "material flowing" read as clutter at this
        size rather than adding meaning. No transition: telemetry moves, it
        does not animate.
      -->
      <p class="text-value-micro" :class="isMoving ? 'text-data-sky' : 'text-muted'">
        <span class="text-value-slot">{{ readoutValue }}</span>
        {{ readoutUnit }}
      </p>
    </div>

    <!--
      Dragging is the fast path and the entry field is the exact one; both
      commit through `commitExtrusionFactor`, and the track commits only on
      release rather than per pixel of drag — `5` on the way to `50` is a
      valid factor and sending it would be a real command.
    -->
    <AppSlider
      v-if="showExtrusionFactor"
      :label="t('dashboard.extruder.factor')"
      :model-value="extrusionFactor"
      :unit="t('dashboard.percentUnit')"
      :min="50"
      :max="150"
      :step="1"
      entry
      can-reset
      :reset-value="100"
      :disabled="printer.pendingCommands.extrusion"
      @commit="commitExtrusionFactor"
    />

    <!--
      Two values above the two verbs they feed.

      This was a field, its chip ladder and one macro button on a single line,
      twice over. That row needs roughly 26rem before three legible controls
      fit side by side, and a dashboard column is routinely narrower — where
      the chips were the part that gave way, five of them dividing whatever
      the field and the button had not already taken. It also asserted a
      pairing that is not real: Retract and Extrude each read *both* numbers,
      so standing one beside the length and the other beside the feedrate said
      the length belonged to retraction and the speed to extrusion.

      So the numbers stack above the actions instead — the arrangement Mainsail
      settled on for the same four controls. Each field owns the chips
      directly beneath it, which is what makes a ladder readable as that
      field's shortcuts without a line connecting them, and the two buttons
      share a row where neither is tied to a number. Chips stay `button--value`,
      the shape Movement's jog-distance and Z-offset steps already use for "a
      value, not a verb"; the two verbs take the card's ordinary button tier,
      the same one the macro buttons below them use, now that they no longer
      have to match a field's height across a row.

      Headed like firmware retraction and pressure advance below, because it
      is the same kind of thing they are: a named block the card draws or does
      not. Unheaded it was the one block whose rows had to be identified from
      their own field labels while every block under it announced itself.
    -->
    <div v-if="showManualExtrusion" class="grid gap-2 manual-extrusion">
      <p class="text-xs font-black">{{ t('dashboard.extruder.manualTitle') }}</p>
      <div class="extruder-feed">
        <div class="extruder-feed__values">
          <div class="extruder-feed__value">
            <AppField
              :model-value="length"
              :label="t('dashboard.extruder.length')"
              :unit="t('dashboard.extruder.millimetresUnit')"
              :min="1"
              :max="printerConfig.maxExtrudeDistance"
              :step="1"
              @commit="(value) => updateConfig({ length: value ?? 25 })"
            />
            <div
              class="extruder-feed__presets"
              role="group"
              :aria-label="t('dashboard.extruder.lengthPresets')"
            >
              <AppButton
                v-for="preset in lengthPresets"
                :key="`length-${preset}`"
                size="sm"
                mono
                :label="preset"
                :aria-label="t('dashboard.extruder.setLength', { value: preset })"
                @click="updateConfig({ length: preset })"
              />
            </div>
          </div>

          <div class="extruder-feed__value">
            <AppField
              :model-value="feedrate"
              :label="t('dashboard.extruder.feedrate')"
              :unit="t('dashboard.extruder.millimetresPerSecondUnit')"
              :min="1"
              :max="60"
              :step="1"
              @commit="(value) => updateConfig({ feedrate: value ?? 5 })"
            />
            <div
              class="extruder-feed__presets"
              role="group"
              :aria-label="t('dashboard.extruder.feedratePresets')"
            >
              <AppButton
                v-for="preset in feedratePresets"
                :key="`feedrate-${preset}`"
                size="sm"
                mono
                :label="preset"
                :aria-label="t('dashboard.extruder.setFeedrate', { value: preset })"
                @click="updateConfig({ feedrate: preset })"
              />
            </div>
          </div>
        </div>

        <!--
          What the two fields above actually mean once filament becomes bead: a
          thin nozzle turns a short push of thick filament into a much longer,
          thinner line. Absent without a known filament and nozzle diameter,
          the same refusal `volumetricFlow` already takes elsewhere on this
          card, rather than showing a number invented from an assumed 1.75 mm.

          Between the values and the verbs, not after them: it is a caption on
          the two fields, and reading it immediately before pressing Extrude is
          what makes it a preview rather than a footnote.
        -->
        <p v-if="extrusionPreview" class="extruder-feed__note hint">
          {{
            t('dashboard.extruder.extrusionPreview', {
              length: numberFormatter.format(extrusionPreview.beadLength),
              flow: numberFormatter.format(extrusionPreview.flow),
              nozzle: numberFormatter.format(extrusionPreview.nozzleDiameter),
            })
          }}
        </p>

        <div class="extruder-feed__actions">
          <AppButton
            size="sm"
            :disabled="!canManualExtrude || printer.pendingCommands.extrude"
            icon="up"
            :label="t('dashboard.extruder.retract')"
            @click="printer.extrudeFilament(-length, feedrate)"
          />
          <AppButton
            size="sm"
            variant="primary"
            :disabled="!canManualExtrude || printer.pendingCommands.extrude"
            icon="down"
            :label="t('dashboard.extruder.extrude')"
            @click="printer.extrudeFilament(length, feedrate)"
          />
        </div>
      </div>
    </div>

    <!--
      Three states, none of them an empty space. The card previously rendered
      nothing at all whether the macros were unconfigured, absent from the
      printer, or merely not discovered yet — one silence covering three
      different situations, only one of which the reader could act on. The
      not-connected case is handled a layer up, where `AvailabilityRegion`
      already dims the whole card.
    -->
    <template v-if="showLoadMacros">
      <div v-if="macroButtons.length > 0" class="macro-grid">
        <AppButton
          v-for="macro in macroButtons"
          :key="macro.name"
          mono
          :class="{ 'macro-control__run--missing': macro.isMissing }"
          :disabled="macro.isMissing || macros.isRunning(macro.name) || printer.isPrinting"
          :title="
            macro.isMissing
              ? t('dashboard.macros.missing', { macro: macro.label })
              : t('dashboard.macros.run', { macro: macro.label })
          "
          @click="macros.run(macro.name)"
        >
          <AppIcon
            v-if="macro.isMissing"
            name="emergency"
            class="size-5 shrink-0"
            aria-hidden="true"
          />
          <span class="truncate">{{ macro.label }}</span>
        </AppButton>
      </div>
      <div v-else class="grid gap-1">
        <p class="text-xs text-muted">{{ t('dashboard.extruder.macrosEmpty') }}</p>
        <button type="button" class="text-action self-start" @click="openSurface()">
          <AppIcon name="popout" class="size-3.5" aria-hidden="true" />
          {{ t('dashboard.macros.choose') }}
        </button>
      </div>
    </template>
    <!--
      Firmware retraction. The same `AppField`s with units and paired steppers
      that Machine's motion limits use — four numbers a reader nudges
      while watching a test print — but each commits on its own, the same
      one-way `:model-value` plus `@commit` Movement's axis boxes use, rather
      than a batch an Apply button reads: there is no "several at once" reason
      to hold one field's edit hostage to another's, and `SET_RETRACTION`
      taking every value in one command is `commitRetraction`'s problem to
      solve, not the reader's.

      A field per setting the printer reports, so a firmware with a fifth (Kalico
      adds Z hop) draws it without a change here, and one without never draws a
      dead control.
    -->
    <div v-if="showRetraction && hasRetraction" class="grid gap-2 retraction-fields">
      <p class="text-xs font-black">{{ t('dashboard.extruder.retractionTitle') }}</p>
      <div class="grid grid-cols-1 gap-y-1 min-[100rem]:grid-cols-2 gap-x-4">
        <AppField
          v-for="field in retractionFields"
          :key="field.key"
          :model-value="printer.retraction.settings[field.key]"
          :label="t(`dashboard.extruder.retraction.${field.key}`)"
          :unit="t(field.unitKey)"
          :min="0"
          :step="field.step"
          :disabled="printer.pendingCommands.retraction"
          v-bind="retractionResetProps(field)"
          align="end"
          steppers
          @commit="(value) => commitRetraction(field, typeof value === 'number' ? value : null)"
        />
      </div>
    </div>

    <!--
      A model and its coefficients, read from the configuration the machine
      reports. The labels are the setting names from `printer.cfg`, made
      readable and not renamed, so what the card says can be searched for in the
      file it came from.

      The same ordinary two-column grid the editable form below uses, rather
      than a `module-table`: this is the same block on a different firmware, so
      it should read as the same block. As a table it was seven full-width rows at
      `module-table__name`'s 2.4rem line-height plus a header — 284px, for
      values four characters long, with most of the card's width spent on
      nothing. Two columns of fields is 235px, and stays 235px from a 760px card
      down to a 358px one: with the shared prefix elided from the labels (see
      `formatPressureAdvanceLabel`) none of them wraps at any width the
      dashboard produces, so the block no longer grows as its column narrows.

      Real `readonly` inputs rather than field-shaped spans: `readonly` is the
      accurate state where `disabled` would claim a control that might become
      usable, and a styled span would not announce itself to a screen reader at
      all. The same `AppField` renders it, so it keeps the editable form's
      outlined floating-label treatment without pretending to be editable — and
      `AppField` is also where a read-only field is made genuinely inert rather
      than merely uneditable, which is not something this block can arrange for
      itself. See its `readonly` prop.
    -->
    <div v-if="showPressureAdvance && isNonlinearAdvance" class="grid gap-2 pressure-advance-model">
      <p class="text-xs font-black">{{ t('dashboard.extruder.pressureAdvanceConfigured') }}</p>
      <div class="grid grid-cols-1 gap-y-1 min-[100rem]:grid-cols-2 gap-x-4">
        <AppField
          v-for="setting in configuredAdvanceSettings"
          :key="setting.key"
          :model-value="setting.value"
          :label="setting.label"
          type="text"
          align="end"
          readonly
        />
      </div>
    </div>
    <form v-else-if="showPressureAdvance" class="grid gap-2" @submit.prevent="applyPressureAdvance">
      <p class="text-xs font-black">{{ t('dashboard.extruder.pressureAdvance') }}</p>
      <div class="grid grid-cols-1 gap-y-1 min-[100rem]:grid-cols-2 gap-x-4">
        <AppField
          v-model="drafts.advance"
          :label="t('dashboard.extruder.advance')"
          :min="0"
          :max="2"
          :step="0.005"
          align="end"
          steppers
        />
        <!--
          Empty until the printer reports its own smoothing, never seeded with a
          plausible default: Apply sends both values together, so a guess here is
          written over the real one by someone who only meant to change the
          advance.
        -->
        <AppField
          v-model="drafts.smoothTime"
          :label="t('dashboard.extruder.smoothTime')"
          :unit="t('dashboard.extruder.secondsUnit')"
          :placeholder="t('dashboard.unavailableValue')"
          :min="0"
          :max="0.2"
          :step="0.005"
          align="end"
          reserve-stepper-space
        />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <AppButton
          size="sm"
          :label="t('dashboard.extruder.applyAdvance')"
          type="submit"
          :disabled="printer.pendingCommands.pressureAdvance"
        />
        <span class="text-[0.7rem] text-muted">{{ activeAdvanceLabel }}</span>
      </div>
    </form>
  </AppDashboardModule>
</template>
