<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppSlider from '@/components/AppSlider.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import MovementBedPlan from '@/components/dashboard/modules/MovementBedPlan.vue'
import MovementQuickSettings from '@/components/dashboard/modules/MovementQuickSettings.vue'
import MovementZAxis from '@/components/dashboard/modules/MovementZAxis.vue'
import { readMovementCardSetting } from '@/components/dashboard/modules/movementCardSettings'
import {
  descending,
  offsetValue,
  readOffsetSteps,
  readPlanarSteps,
  readVerticalSteps,
  signedOffsetStep,
  zOffsetUnits,
  type ZOffsetUnit,
} from '@/components/dashboard/modules/movementSteps'

import { bedExtents } from '@/dashboard/bedPlan'
import { configBoolean, configString, useDashboardModule } from '@/dashboard/context'
import { useActionGuard } from '@/composables/useActionGuard'
import { useConsoleStore } from '@/stores/console'
import { parseScrewsTiltResults, usePrinterStore } from '@/stores/printer'
import { usePrintersStore } from '@/stores/printers'
import { usePrinterConfigStore, type LevelingMethod } from '@/stores/printerConfig'

type Axis = 'X' | 'Y' | 'Z'

/** Clearance for the service park, so the nozzle is not left on the bed. */
const serviceParkZ = 50

/**
 * Below this the toolhead is not meaningfully moving. `motion_report` reports a
 * live velocity roughly once a second and settles to a small non-zero value
 * rather than exactly zero, so a bare `> 0` test would blink the readout on and
 * off against a stationary machine.
 */
const movingAbove = 0.5

const axes: readonly Axis[] = ['X', 'Y', 'Z']
const axisLabelKeys: Record<Axis, string> = {
  X: 'dashboard.movement.axisX',
  Y: 'dashboard.movement.axisY',
  Z: 'dashboard.movement.axisZ',
}

const { locale, t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
// The leveling transcript is read off the console store's raw lines.
const gcodeConsole = useConsoleStore()
const printerConfig = usePrinterConfigStore()
const printers = usePrintersStore()
// The card reads its configuration; writing it belongs to the quick settings
// and the settings pane, which are the two places that present it.
const { config, isSettingsOpen } = useDashboardModule('movement')

const confirmingMotorsOff = ref(false)
/**
 * That *this* card staged the offset, which is what makes the notice below
 * about the thing the user just did rather than about the printer's config in
 * general — a PID calibration stages one too. Whether it is still outstanding
 * is `printer.saveConfigPending`, which is subscribed, so saving from anywhere
 * else takes the notice away here as well.
 */
const appliedOffset = ref(false)
const pendingLeveling = ref<LevelingMethod | null>(null)
/**
 * The console entry the leveling transcript starts after — an id, not an index.
 *
 * The transcript is a bounded ring of the last thousand entries, so an index
 * into it stops meaning the same place the moment the buffer trims from the
 * front: the slice would quietly start somewhere else, dropping the beginning of
 * a run's own output or reaching back into whatever preceded it. Entry ids are
 * monotonic for the session and survive the trim, so the slice keeps naming the
 * run it was taken for.
 */
const levelingTranscriptAfter = ref(0)
/**
 * Which leveling run produced the rows below, not merely that one ever did.
 * `SCREWS_TILT_CALCULATE` reports only into the shared console, so the rows are
 * a reading of a transcript slice — and a slice stays parseable long after its
 * run is over. Holding the method means a later run of a *different* one clears
 * the table instead of leaving the previous run's turns sitting under the new
 * command's name.
 */
const resultsFrom = ref<LevelingMethod | null>(null)
/**
 * Hovering the plan or the Z slider previews a value in the corner readout
 * without moving anything — a lighter-weight relative of the placed target
 * and the draft the slider is already dragging. Each is `null` whenever the
 * pointer is not over its own control, which is what lets the readout fall
 * straight back to the machine's actual position.
 */
const hoverXY = ref<{ x: number; y: number } | null>(null)
const hoverZ = ref<number | null>(null)

const positionFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)
const rateFormatter = computed(
  () =>
    new Intl.NumberFormat(locale.value, {
      maximumFractionDigits: 0,
    }),
)
const stepFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 3 }),
)
/**
 * The fallback axis box's own precision — one step finer than the rest of
 * the card for every axis, and Z finer still: its bed-mesh correction is
 * sub-hundredth-millimetre, and a coarser figure is exactly where the box's
 * whole reason for existing — showing the commanded target next to what the
 * toolhead actually did with it — would wash back out to identical-looking
 * numbers. Both are `minimumFractionDigits` as well as maximum, so a target
 * typed to a whole millimetre still reports the zeros it holds rather than
 * trimming them.
 */
const axisBoxFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
)
const axisBoxFineFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
)

function scaleFor<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
  const stored = configString(config.value, key, fallback)
  return (valid as readonly string[]).includes(stored) ? (stored as T) : fallback
}

const planarSteps = computed(() => readPlanarSteps(config.value))
const verticalSteps = computed(() => readVerticalSteps(config.value))
const offsetSteps = computed(() => readOffsetSteps(config.value))
const offsetUnit = computed<ZOffsetUnit>(() => scaleFor('zOffsetUnit', 'micrometre', zOffsetUnits))
/**
 * The steps row is sized by its widest label rather than by a column count, so
 * it can wrap instead of clipping: eight micrometre labels fit one row of a
 * 299px card at `xs` with the tighter step padding, while millimetres — where
 * `−.005` is five mono characters — take two rows of four there and one row on
 * a docked card. A fixed eight-column grid has no way to express that, and the
 * labels it cannot fit it simply overruns.
 */
const offsetStepMinimum = computed(() => (offsetUnit.value === 'micrometre' ? '1.9rem' : '3.1rem'))

/**
 * Every step says which way the gap moves, not just by how much. The visible
 * label is a signed number and the legend under the row states the two
 * directions, but a control read one at a time — by a screen reader, or by a
 * pointer resting on it — has to carry the direction itself, because a
 * babystep in the wrong direction is a nozzle in the bed.
 */
function offsetStepLabel(step: number): string {
  return t('dashboard.movement.zOffsetAdjust', {
    amount: signedOffsetStep(step, offsetUnit.value),
    unit: t(`dashboard.movement.zOffsetUnit.${offsetUnit.value}`),
    direction: t(
      step < 0 ? 'dashboard.movement.zOffsetCloser' : 'dashboard.movement.zOffsetFarther',
    ),
  })
}

/**
 * The speed factor slider's own position, as a whole percent.
 *
 * A draft rather than a binding straight onto `motion.speedFactor`, for the
 * same reason the temperature sliders keep one: the store reports the machine's
 * value several times a second, and a slider bound to it snaps back out from
 * under the thumb mid-drag. Re-seeded whenever the machine's own value moves,
 * so a change made from the console or another browser reaches this card.
 */
const speedFactorDraft = ref(100)

watch(
  () => printer.motion.speedFactor,
  (factor) => (speedFactorDraft.value = Math.round(factor * 100)),
  { immediate: true },
)

/**
 * Sent on release, never per input event, and from either half of one
 * control — dragging and the exact-entry field both commit through here. A
 * drag from 100 to 40 passes through every value between, and each one is a
 * real `M220`; dispatching them all would queue dozens of commands to land
 * on the one the user meant.
 */
function commitSpeedFactor(percent: number): void {
  speedFactorDraft.value = percent
  void printer.setSpeedFactor(percent)
}
// Keys and defaults live in `movementCardSettings.ts`, shared with the
// settings rows so the two cannot drift.
const showZOffset = computed(() => readMovementCardSetting(config.value, 'showZOffset'))
const showSpeedFactor = computed(() => readMovementCardSetting(config.value, 'showSpeedFactor'))
const showParking = computed(() => readMovementCardSetting(config.value, 'showParking'))
const showBedPlan = computed(() => readMovementCardSetting(config.value, 'showBedPlan'))
const showBedPlanWhilePrinting = computed(() =>
  readMovementCardSetting(config.value, 'showBedPlanWhilePrinting'),
)
const showHomeXY = computed(() => readMovementCardSetting(config.value, 'showHomeXY'))
const showLevelBedShortcut = computed(() =>
  readMovementCardSetting(config.value, 'showLevelBedShortcut'),
)
/**
 * The shortcut beside home-all always reads "Level bed" and always exists
 * for a printer that reports any leveling method at all — it is a second way
 * to reach whichever command `printerConfig` discovered, not a promise tied
 * to one specific macro. `levelingMethods` is ordered by
 * `levelingSections` in `printerConfig.ts`, so this is simply "the" method on
 * the overwhelming majority of printers, which configure exactly one; the
 * rare machine declaring more than one leveling section (mid-migration, or a
 * config testing two schemes) gets a deterministic pick here and the rest
 * still offered from the full-width row below, rather than the shortcut
 * disappearing or picking a different macro on every reload.
 */
const primaryLevelingMethod = computed<LevelingMethod | null>(
  () => printerConfig.levelingMethods[0] ?? null,
)
const skipMotorsOffWarning = computed(() =>
  configBoolean(config.value, 'skipMotorsOffWarning', false),
)
const skipLevelingWarning = computed(() =>
  configBoolean(config.value, 'skipLevelingWarning', false),
)
// A drawing choice for the slider, never a change to the Z values `moveTo`
// sends — see `movementCardSettings.ts`.
const swapZDirection = computed(() => readMovementCardSetting(config.value, 'swapZDirection'))

const homedAxes = computed(() => printer.motion.homedAxes.toUpperCase())
const isFullyHomed = computed(() => axes.every((axis) => homedAxes.value.includes(axis)))
const zOffset = computed(() => printer.motion.homingOrigin[2] ?? 0)
/**
 * That the machine is moving right now, which nothing on this card said before.
 * A jog on a slow Z and a jog that was silently refused looked identical, and
 * the value that tells them apart was already subscribed and rendered nowhere.
 */
const isMoving = computed(() => printer.motion.liveVelocity > movingAbove)
/**
 * `homeAxes()` homes sequentially, so Klipper reports an earlier axis as
 * homed while a later one is still moving — `pendingCommands.home` is what
 * actually says the whole command has finished, and every control below
 * needs both: the axis has to be homed, and homing has to be over.
 */
const homing = computed(() => printer.pendingCommands.home)
/**
 * Homing, releasing the motors and running a leveling procedure are all refused
 * while a job is *loaded*, not merely while one is moving — `hasActivePrint`,
 * which is paused as well as printing, where the jog rows above deliberately use
 * `isPrinting` alone.
 *
 * The distinction is the whole point. Jogging a paused machine is ordinary and
 * often the reason it was paused: reaching the nozzle, clearing a blob, swapping
 * filament by hand. These three are not. `M84` forgets where the axes are and
 * takes the paused job with them; `G28 Z` on a probe-homed machine drives the
 * nozzle down at the bed with a printed part in the way; and every leveling
 * procedure probes across the plate it is halfway through building. Each was
 * offered, enabled, on a paused print before this — and the leveling
 * confirmation's own "do not start this while printing" was advice you could
 * only ever read in exactly the state where it applied.
 */
const hasJobLoaded = computed(() => printer.hasActivePrint)
/**
 * Every offset control issues `MOVE=1`, and Klipper refuses to move an axis it
 * has not homed — so these are gated on Z rather than left to fail with a
 * command error, which is what they did before.
 */
const canAdjustOffset = computed(
  () => isHomed('Z') && !homing.value && !printer.pendingCommands.zOffset,
)

const parkPositions = computed(() => {
  const [minimumX, minimumY] = printer.buildVolume.minimum
  const [maximumX, maximumY] = printer.buildVolume.maximum
  if (minimumX === null || minimumY === null || maximumX === null || maximumY === null) return []
  return [
    { key: 'center', target: { x: (minimumX + maximumX) / 2, y: (minimumY + maximumY) / 2 } },
    // Front and center with the gantry lifted: the position you want when
    // reaching into the machine rather than watching it.
    { key: 'front', target: { x: (minimumX + maximumX) / 2, y: minimumY, z: serviceParkZ } },
  ]
})

/**
 * Every move the plan can command shares the card's own precondition. A print
 * in progress adds a fourth: the toolhead is following the job's own path, and
 * a manual move issued over it is a crash the same jog that is perfectly safe
 * while idle would never cause.
 */
const canMoveToTarget = computed(
  () => isFullyHomed.value && !homing.value && !printer.pendingCommands.move && !printer.isPrinting,
)

/** One arrow press moves by the same distance a jog button would. */
const planKeyboardStep = computed(() => {
  const steps = planarSteps.value
  return steps[Math.floor(steps.length / 2)] ?? 1
})

const screwResults = computed(() =>
  resultsFrom.value === 'screwsTiltAdjust'
    ? parseScrewsTiltResults(
        gcodeConsole.consoleEntries
          .filter((entry) => entry.id > levelingTranscriptAfter.value)
          .map((entry) => entry.raw),
      )
    : [],
)

function isHomed(axis: Axis): boolean {
  return homedAxes.value.includes(axis)
}

/**
 * Both position arrays are indexed by a plain number, so a variable index
 * reads as possibly `undefined` even though every axis has an entry.
 */
function toolheadValue(axis: Axis): number | null {
  return printer.toolheadPosition[axes.indexOf(axis)] ?? null
}

/**
 * `gcode_position` — the frame a typed target actually lands in — rounded to
 * the axis box's own precision. Klipper's own arithmetic leaves this holding
 * values like `0.29999999999999993`, and `AppField`'s model shows a number
 * exactly as given rather than through a formatter, unlike the bracket beside
 * it: unrounded, the box would type over a target with the binary noise
 * behind whatever the user actually entered.
 */
function commandedValue(axis: Axis): number | null {
  const value = printer.motion.position[axes.indexOf(axis)] ?? null
  return value === null ? null : Number(value.toFixed(axis === 'Z' ? 3 : 2))
}

/** The fallback axis box's own formatting: unavailable when unhomed, and
 *  finer than the rest of the card for every axis, Z finest of all. */
function formatAxisReading(axis: Axis, value: number | null): string {
  if (!isHomed(axis) || value === null) return t('dashboard.unavailableValue')
  const formatter = axis === 'Z' ? axisBoxFineFormatter.value : axisBoxFormatter.value
  return formatter.format(value)
}

function canEditAxis(axis: Axis): boolean {
  return isHomed(axis) && !homing.value && !printer.pendingCommands.move && !printer.isPrinting
}

/**
 * `AppField` owns the draft and the focus guard that used to live here by
 * hand — see its own doc comment for why several call sites each grew a copy
 * of that rule rather than one of them owning it. It binds `:model-value`
 * one-way, since `5` on the way to typing `50` is not a target anyone meant
 * to send; the commit is.
 *
 * A refused move — an axis that stopped being homed between a keystroke and
 * Enter — is not reverted here the way the hand-rolled draft used to: the
 * field disables the moment `canEditAxis` turns false, which blurs it, so the
 * race is narrow enough that a bespoke revert path is not worth it. The field
 * settles once the next successful move updates `commandedValue`.
 *
 * `disabled`, not `readonly`, and the two are not interchangeable here.
 * `AppField` documents `readonly` as a value that cannot be edited *anywhere* —
 * a reading wearing a field's chrome — and it delivers exactly that: out of the
 * tab order, pointer events gone, and deliberately not dimmed, because nothing
 * about it is ever going to change. This box is the opposite case, the one
 * `disabled` is for: it is a control that is momentarily unusable and will come
 * back the moment the axis is homed or the print ends. Left `readonly` it looked
 * like an ordinary editable field, took no clicks, took no focus, and said
 * nothing at all about why — while the jog buttons beside it dimmed.
 */
async function commitAxisTarget(axis: Axis, value: number | null): Promise<void> {
  if (value === null || !canEditAxis(axis)) return
  const key = axis.toLowerCase() as 'x' | 'y' | 'z'
  await printer.moveTo({ [key]: value })
}

/**
 * Klipper keeps reporting a coordinate for an unhomed axis, but it is the last
 * value it happened to hold rather than a known position — showing it invites
 * the reader to trust a number the machine itself cannot vouch for.
 */
function position(axis: Axis, value: number | null): string {
  if (!isHomed(axis) || value === null) return t('dashboard.unavailableValue')
  return positionFormatter.value.format(value)
}

function stepsFor(axis: Axis): readonly number[] {
  return axis === 'Z' ? verticalSteps.value : planarSteps.value
}

/**
 * Whether the plan is actually going to draw something, not merely whether
 * the setting asks for one — the same `bedExtents` check `MovementBedPlan`
 * makes internally. The card never states the position twice: this decides
 * whether the header keeps the axes stack or the plan carries it in its own
 * corner, and it has to agree with the child's own decision rather than
 * guess from the setting alone, or a printer that has not yet reported its
 * build volume would lose the readout to a plan that never draws.
 */
const hasBedPlan = computed(
  () =>
    showBedPlan.value &&
    (!printer.isPrinting || showBedPlanWhilePrinting.value) &&
    bedExtents(printer.buildVolume.minimum, printer.buildVolume.maximum) !== null,
)

/**
 * The raw hover value for one axis, or `null` when nothing is being hovered
 * on the control that owns it — the plan for X and Y, the slider for Z.
 */
function hoverValue(axis: Axis): number | null {
  if (axis === 'Z') return hoverZ.value
  if (!hoverXY.value) return null
  return axis === 'X' ? hoverXY.value.x : hoverXY.value.y
}

/**
 * Formatted once here, where `position()` and its locale already live, and
 * handed to whichever surface is showing coordinates this render — the bed
 * plan's own corner readout, and the fallback axis box's not-yet-homed
 * fallback text.
 *
 * A hovered axis reads its hover value instead of the machine's own position,
 * which is what turns the corner reading blue: `preview` is the same
 * condition that picked the value, not a separate guess at it.
 */
const axesReadout = computed(() =>
  axes.map((axis) => {
    const hovered = hoverValue(axis)
    const index = axes.indexOf(axis)
    return {
      code: axis,
      value: position(axis, hovered ?? printer.toolheadPosition[index] ?? null),
      preview: hovered !== null,
    }
  }),
)

function signedStep(value: number): string {
  const formatted = stepFormatter.value.format(Math.abs(value))
  return value < 0 ? `−${formatted}` : `+${formatted}`
}

function axisLabel(axis: Axis): string {
  return t(axisLabelKeys[axis])
}

/**
 * The pivot shows only its axis letter, so its accessible name has to say what
 * pressing it does. No title in the ordinary cases: the card's chip already
 * carries the shared not-homed reason, and a tooltip on every control was noise.
 *
 * A job being loaded is the exception, and it earns one — see `pivotTitle`. The
 * pivot cannot be hidden the way the machine-actions row below is, because it is
 * the axis of its own jog row and removing it would leave the steps either side
 * of a hole; so it disables, and a disabled control whose reason is not visible
 * anywhere on the card is exactly where a title is worth the noise.
 */
function pivotLabel(axis: Axis): string {
  if (hasJobLoaded.value) return t('dashboard.movement.homeAxisBlocked', { axis })
  return isHomed(axis)
    ? t('dashboard.movement.homeAxisHomed', { axis })
    : t('dashboard.movement.homeAxisNotHomed', { axis })
}

function pivotTitle(axis: Axis): string | undefined {
  return hasJobLoaded.value ? t('dashboard.movement.homeAxisBlocked', { axis }) : undefined
}

/**
 * That the offset this card applied is still waiting to be written.
 *
 * The notice stays; the button does not. Writing the config is one printer-wide
 * fact — `Z_OFFSET_APPLY_PROBE` here, a heater calibration in Temperatures, a
 * mesh saved from Calibration — so it is offered once, from the header, rather
 * than by whichever surface happened to stage it. This card's job is to say that
 * what it just did is not permanent yet, and to point at the one gate that makes
 * it so.
 *
 * Still gated on `appliedOffset` as well as the subscribed flag: it is about the
 * thing the user just did here, not about the printer's config in general.
 */
const offsetNeedsSaving = computed(() => appliedOffset.value && printer.saveConfigPending)

/**
 * A staged offset belongs to the machine it was staged on, so switching printers
 * takes the notice with it. Without this the flag outlives the connection it was
 * set for and the next printer's own pending config — a heater calibration
 * someone left unsaved there — would light this card's notice as though this
 * card had staged it.
 */
watch(
  () => printers.activeId,
  () => (appliedOffset.value = false),
)

/**
 * Where a babystepped offset can be made permanent on *this* machine, or null
 * where it cannot be.
 *
 * Two different Klipper commands, registered by two different objects, and
 * exactly one of them exists on any given printer — so this is a capability
 * question rather than a preference. A probe-less machine sent
 * `Z_OFFSET_APPLY_PROBE` gets "Unknown command", which is what the control did
 * before it asked. Null is a real answer too: a machine with no probe section and
 * no Z endstop position has nowhere to put the offset, and the honest thing is to
 * offer nothing rather than a button that fails. See `printerConfig`'s own
 * `hasProbe` and `hasZEndstopOffset` for what each half reads.
 */
const offsetApplyTarget = computed<'probe' | 'endstop' | null>(() => {
  if (printerConfig.hasProbe) return 'probe'
  return printerConfig.hasZEndstopOffset ? 'endstop' : null
})

const offsetApplyTitle = computed(() =>
  offsetApplyTarget.value === 'endstop'
    ? t('dashboard.movement.zOffsetApplyEndstopTitle')
    : t('dashboard.movement.zOffsetApplyProbeTitle'),
)

async function applyOffset(): Promise<void> {
  const target = offsetApplyTarget.value
  if (!target) return
  appliedOffset.value = await printer.applyZOffset(target)
}

/**
 * Which gantry alignment this machine has not run since its motors were last
 * off. Klipper reports `applied` on whichever of the two objects the config
 * declares and Alabaster never reported it anywhere, which left the one thing
 * homing cannot tell you unsaid: every axis reads as homed on a machine whose
 * gantry is out of square, and the first sign is a first layer that is thick at
 * one end.
 *
 * `=== false` rather than a falsy test, because `null` is "this machine has
 * never reported the object" — a printer with no `[quad_gantry_level]` at all —
 * and saying its gantry is unlevelled would be inventing a fault.
 *
 * Empty while a job is loaded, which is the same gate the leveling row itself
 * carries. That is not a second rule but the same one: the notice exists to send
 * the reader to the button, so a notice outliving the button is a caution line
 * about something the card is simultaneously refusing to let them do. The gate
 * lives here rather than on the markup so the two cannot drift.
 */
/**
 * Whether each of the card's two multi-row containers has anything in it.
 *
 * **An empty container is not free.** Every mechanism that spaces a stack is
 * conditioned on sibling structure — the shell's `space-y-4` compiles to a
 * `:not(:last-child)` margin, and a Grid or Flex `gap` counts a zero-height item
 * as a track just the same — so a wrapper that renders with all of its rows
 * gated off still collects a full row of spacing around nothing. Measured on the
 * workshop printer: `movement-layout` while printing with the plan hidden was a
 * 0px box carrying 16px of margin, and turning the park positions off did the
 * same again to `movement-actions`. Two settings and a running print could
 * therefore add 32px of blank card between rows that were visibly adjacent.
 *
 * There is no CSS answer to this; the answer is not to render the box. Each flag
 * is also what the row inside it renders on, so the container's condition and
 * its content's cannot drift into disagreeing about whether anything is there —
 * which is the version of this bug that shows up as a container that vanishes
 * with a row still in it.
 *
 * See ADR 0004 for the same root cause across a disclosure boundary, where it
 * shows up as an animation that snaps instead of as dead space.
 */
const hasMotionRow = computed(() => hasBedPlan.value || !printer.isPrinting)
const hasParkRow = computed(() => showParking.value && parkPositions.value.length > 0)
/**
 * The full-width leveling row's own methods, minus whichever one the
 * machine-actions shortcut above already offers — a reader who turned that
 * shortcut on does not need the same action twice, once beside home-all and
 * once again down here. Off, this list is every method `printerConfig`
 * reports, exactly as before the shortcut existed.
 */
/**
 * Unconditional on the shortcut's own visibility: `primaryLevelingMethod` is
 * always excluded here, whether or not the shortcut is currently drawn. A
 * printer configuring exactly one leveling method — the ordinary case — gets
 * an empty row once that method is its `primaryLevelingMethod`; turning
 * `showLevelBedShortcut` off then hides the action outright rather than
 * spilling it back into this row, which would otherwise offer the same
 * command from two places depending on a setting neither button's label
 * mentions. What is left here is only what a printer declares *beyond* its
 * primary method — rare, but real enough (a config mid-migration between two
 * leveling schemes) that it still needs somewhere to live.
 */
const levelingRowMethods = computed(() =>
  printerConfig.levelingMethods.filter((method) => method !== primaryLevelingMethod.value),
)
const hasLevelingRow = computed(() => levelingRowMethods.value.length > 0 && !hasJobLoaded.value)

const unappliedLeveling = computed(() => {
  if (hasJobLoaded.value) return []
  const notices: string[] = []
  if (printer.leveling.quadGantryApplied === false) {
    notices.push(t('dashboard.movement.levelingUnapplied.quadGantryLevel'))
  }
  if (printer.leveling.zTiltApplied === false) {
    notices.push(t('dashboard.movement.levelingUnapplied.zTilt'))
  }
  return notices
})

/** Declared after the notices, since one of the three things it counts is them. */
const hasActions = computed(
  () => hasParkRow.value || hasLevelingRow.value || unappliedLeveling.value.length > 0,
)

/*
 * Motors off is the reference case for the escalation rule: one click releases
 * the steppers and the machine forgets where it is, so with the confirmation
 * switched off a destructive action looks exactly as ordinary as it did when
 * something was still going to catch a misclick -- and it is the reader who
 * turned the guard off who most needs the reminder, because nothing else will
 * give them one now.
 *
 * Both of these are `neutral` emphasis: the escalation to `danger` is what the
 * dialog's absence buys, one step up, not a floor the control sits on while the
 * dialog is still there to ask. Both are also unconditional -- these are
 * refused outright while a job is loaded (see `hasJobLoaded`), so the state
 * where they are reachable at all is already the state where they are ordinary.
 */
const motorsOffGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'neutral',
  moduleFlag: skipMotorsOffWarning,
})

const levelingGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'neutral',
  moduleFlag: skipLevelingWarning,
})

async function confirmMotorsOff(): Promise<void> {
  confirmingMotorsOff.value = false
  await printer.disableMotors()
}

function requestMotorsOff(): void {
  motorsOffGuard.request(
    () => void printer.disableMotors(),
    () => (confirmingMotorsOff.value = true),
  )
}

async function runLeveling(method: LevelingMethod): Promise<void> {
  // Only the lines this run produces belong to its result, never whatever was
  // already sitting in the shared console buffer — and never the run before
  // this one, whose rows go the moment a new run starts.
  levelingTranscriptAfter.value = gcodeConsole.consoleEntries.at(-1)?.id ?? 0
  resultsFrom.value = method
  await printer.runLeveling(method)
}

async function confirmLeveling(): Promise<void> {
  const method = pendingLeveling.value
  pendingLeveling.value = null
  if (!method) return
  await runLeveling(method)
}

function requestLeveling(method: LevelingMethod): void {
  levelingGuard.request(
    () => void runLeveling(method),
    () => (pendingLeveling.value = method),
  )
}

/** The shortcut's own click target — `v-if` already keeps it off screen without a method to run. */
function requestLevelingShortcut(): void {
  const method = primaryLevelingMethod.value
  if (!method) return
  requestLeveling(method)
}

/**
 * Klipper reports a turn as clock-face minutes, which is how the physical
 * adjustment is actually made — a quarter turn rather than "0.25".
 */
function screwInstruction(screw: (typeof screwResults.value)[number]): string {
  if (screw.isBase) return t('dashboard.movement.screwBase')
  if (screw.direction === null) return t('dashboard.movement.screwLevel')
  const direction =
    screw.direction === 'CW'
      ? t('dashboard.movement.screwClockwise')
      : t('dashboard.movement.screwCounterClockwise')
  if (screw.turns === 0) {
    return t('dashboard.movement.screwMinutes', { direction, minutes: screw.minutes })
  }
  // One turn is one turn. Klipper's own line reads "CW 1 turn 15 min", and a
  // single plural form rendered the commonest non-zero case as "1 turns".
  const key =
    screw.turns === 1
      ? 'dashboard.movement.screwTurnAndMinutes'
      : 'dashboard.movement.screwTurnsAndMinutes'
  return t(key, { direction, turns: screw.turns, minutes: screw.minutes })
}
</script>

<template>
  <AppDashboardModule :open="isSettingsOpen">
    <!--
      Only what changes what the card shows lives here. The step scales are
      judged by looking at the jog buttons, so they belong in the surface, where
      the card is docked and relabels under the user's eye.
    -->
    <template #quick-settings>
      <MovementQuickSettings />
    </template>

    <!--
      The query container is this module's own content, not the shell around
      it: `AppDashboardModule` is generic and carries nothing module-specific,
      so a card that wants its rows to answer their own width declares that
      here — the same shape `PrintModule` already uses for `print-card`. The
      wrapper is unpadded, so its content box is exactly the padded shell
      root's was, and `@container movement-card` still resolves against the
      same width it always did.
    -->
    <div class="movement-card space-y-4">
      <!--
      The card's header: what the machine is doing, not where the toolhead is.
      Once the plan is drawn it carries the coordinates itself, in its own
      bottom-left corner; without a plan the axis row below carries them
      instead. The positioning mode leads on the left — it is what a typed or
      jogged move is actually relative to, so it reads before the speed a move
      happens at — and the feed rate trails on the right, where the rest of
      this card's live readouts sit.
    -->
      <div class="movement-position">
        <span v-if="!isFullyHomed" class="movement-chip">
          <AppIcon name="warning" class="size-3.5" aria-hidden="true" />
          {{ t('dashboard.movement.notHomed') }}
        </span>
        <span v-else class="movement-position__mode">
          <AppIcon name="crosshair" class="size-3.5" aria-hidden="true" />
          {{
            t('dashboard.movement.positionMode', {
              mode: printer.motion.absoluteCoordinates
                ? t('dashboard.movement.positionModeAbsolute')
                : t('dashboard.movement.positionModeRelative'),
            })
          }}
        </span>
        <!--
        Always showing the live figure rather than blanking at rest: a idle
        readout that vanished read as broken rather than as "not moving", and
        `motion_report` settles to a small non-zero value anyway, so zero is
        not even the number rest actually reports. `--idle` only mutes the
        color — the number itself is the state, never the color alone.

        The name is present but not drawn. The icon is decorative and the unit
        is only a unit, so read aloud this was "40 mm/s" — a number with
        nothing saying what it measures, the one reading on the card whose
        neighbor states its own name ("Position: Absolute"). A visible label
        would cost width the corner does not have at 305px, and `sr-only` is
        what closes that without spending any.
      -->
        <span
          class="movement-position__rate"
          :class="{ 'movement-position__rate--idle': !isMoving }"
        >
          <AppIcon name="move" class="size-3.5" aria-hidden="true" />
          <span class="sr-only">{{ t('dashboard.movement.feedrateLabel') }}</span>
          <span class="text-value-slot">{{
            rateFormatter.format(printer.motion.liveVelocity)
          }}</span>
          {{ t('dashboard.movement.feedrateUnit') }}
        </span>
      </div>

      <!--
      Without a plan to carry the position in its own corner, each axis gets a
      box of its own above the jog rows rather than a stacked list in the
      header — the header has room for one line, not three. A homed axis's
      box is a field rather than a plain readout: typing a target and pressing
      Enter is the only way left to reach an exact coordinate without a plan
      to tap or a slider to drag. It edits `gcode_position` — the frame
      `moveTo` actually addresses — because that is what a typed target has to
      agree with, and its notch holds `toolheadPosition` instead — where
      Klipper actually put the toolhead, sampled after the motion transform
      chain, mesh correction included. They agree for X and Y — bed_mesh only
      ever corrects Z — so the bracket's only reason for being there at all is
      the gap it reveals on Z.

      `AppField`'s own `label` is what draws that bracket, and `ariaLabel`
      keeps the field's accessible name as "Target X" rather than the reading
      the bracket shows — see both doc comments there. An unhomed axis has no
      `gcode_position` to type a target into at all, so it shows the shared
      em dash and disables rather than falling back to a plain span the way
      the old hand-rolled box did; `type="text"` is what lets that em dash
      actually render, since a number input silently blanks any text it
      cannot parse as one.
    -->
      <div v-if="!hasBedPlan" class="movement-axis-row">
        <AppField
          v-for="axis in axes"
          :key="`axis-box-${axis}`"
          align="end"
          label-align="end"
          unit-align="start"
          :unit="axis"
          :label="`[${formatAxisReading(axis, toolheadValue(axis))}]`"
          :aria-label="t('dashboard.movement.axisTargetLabel', { axis })"
          :type="isHomed(axis) ? 'number' : 'text'"
          :step="axis === 'Z' ? 0.001 : 0.01"
          :model-value="isHomed(axis) ? commandedValue(axis) : t('dashboard.unavailableValue')"
          :disabled="!canEditAxis(axis)"
          @commit="(value) => commitAxisTarget(axis, typeof value === 'number' ? value : null)"
        />
      </div>

      <!--
      The plan and the jog rows are one control between them, so a card
      wide enough to stand them side by side does — otherwise a wide card
      stacks two 26rem blocks down the middle and leaves the width unused.
      The card is the container rather than the viewport: the same module
      sits in a 305px dashboard column and a docked settings card twice
      that, and it is the card that knows whether both fit.
    -->
      <div
        v-if="hasMotionRow"
        class="movement-layout"
        :class="{ 'movement-layout--paired': hasBedPlan }"
      >
        <!--
        The plan draws the coordinates in its own bottom-left corner when it
        draws at all, so the card never states the toolhead's position twice.
        `hasBedPlan` is computed from the same `bedExtents` check the plan
        makes internally, so the header's decision and the plan's own
        rendering always agree.

        The Z slider stands beside it rather than adding a setting of its own:
        it is meaningless without a picture of X and Y to stand next to, so it
        shares the plan's own toggle and its own precondition. `.z-axis__slider`
        carries the same height cap `.bed-plan__plot` does rather than
        stretching to match it — a rotated `input[type=range]` reports its own
        intrinsic size into a flex row's cross-size the way any orthogonal
        element does, and that measured against the workshop printer inflated
        the whole row to several hundred pixels tall.

        Hovering either previews the axis it owns in the plan's own corner
        reading, which is why that reading is built here rather than read
        straight off the store: `axesReadout` is the one place that already
        knows whether an axis is live or hovered, so the plan never has to
        guess which number it was handed.
      -->
        <div v-if="hasBedPlan" class="movement-plan">
          <MovementBedPlan
            :can-move="canMoveToTarget"
            :keyboard-step="planKeyboardStep"
            :axes-readout="axesReadout"
            @move="printer.moveTo($event)"
            @hover="hoverXY = $event"
          />
          <MovementZAxis
            :can-move="canMoveToTarget"
            :swap-direction="swapZDirection"
            :is-moving="isMoving"
            @move="printer.moveTo({ z: $event })"
            @hover="hoverZ = $event"
          />
        </div>

        <div v-if="!printer.isPrinting">
          <!--
          Each row is symmetric around its axis pivot, which is also that axis's
          home button and carries its homed state — so the separate per-axis home
          row and the per-axis badges are both unnecessary.

          No top margin here: `movement-layout`'s own gap already spaces this
          column from the bed plan (stacked) or lines their tops up (side by
          side). A margin here that the plan's column does not share is what
          used to slide the jog matrix 0.75rem below the plan's own top edge
          on a wide card, so the two no longer read as one control.

          Hidden outright while printing, not merely disabled: a manual jog
          over a running job is not a choice this card offers, the same rule
          the leveling buttons below follow.
        -->
          <div class="grid gap-1">
            <div
              v-for="axis in axes"
              :key="`jog-${axis}`"
              class="jog-matrix"
              role="group"
              :aria-label="axisLabel(axis)"
            >
              <div class="jog-steps">
                <AppButton
                  v-for="step in descending(stepsFor(axis))"
                  :key="`${axis}-minus-${step}`"
                  size="xs"
                  mono
                  :label="signedStep(-step)"
                  class="jog-button"
                  :disabled="printer.pendingCommands.move || homing || !isHomed(axis)"
                  :aria-label="t('dashboard.movement.jog', { axis, distance: signedStep(-step) })"
                  @click="printer.moveAxis(axis, -step)"
                />
              </div>

              <AppButton
                size="xs"
                class="jog-pivot"
                :class="{ 'jog-pivot--homed': isHomed(axis) }"
                :disabled="printer.pendingCommands.home || hasJobLoaded"
                :aria-label="pivotLabel(axis)"
                :title="pivotTitle(axis)"
                @click="() => printer.homeAxes(axis)"
              >
                <AppIcon name="home" class="size-4 shrink-0" aria-hidden="true" />
                <span>{{ axis }}</span>
                <span v-if="!isHomed(axis)" class="jog-pivot__dot" aria-hidden="true"></span>
              </AppButton>

              <div class="jog-steps">
                <AppButton
                  v-for="step in stepsFor(axis)"
                  :key="`${axis}-plus-${step}`"
                  size="xs"
                  mono
                  :label="signedStep(step)"
                  class="jog-button"
                  :disabled="printer.pendingCommands.move || homing || !isHomed(axis)"
                  :aria-label="t('dashboard.movement.jog', { axis, distance: signedStep(step) })"
                  @click="printer.moveAxis(axis, step)"
                />
              </div>
            </div>

            <!--
            A fourth row of the same table, so both controls stand in a column
            that already means something: home-all under the three axis pivots,
            in the home column, and motors-off in the first of the positive
            steps. They were a line of their own below the grid, which cost the
            card a whole row for two buttons that had already shrunk to their
            icons — and left the home-all button sitting apart from the three
            per-axis home buttons it generalises.

            Gone entirely while a job is loaded, paused included — the rule the
            leveling row follows and the jog rows above deliberately do not. See
            `hasJobLoaded`: both of these end a paused print rather than
            interrupting it, so neither is a choice this card offers while one
            exists. Removed rather than disabled, because unlike an axis pivot
            neither is holding a row together.
          -->
            <div
              v-if="!hasJobLoaded"
              class="jog-matrix jog-matrix--machine"
              role="group"
              :aria-label="t('dashboard.movement.machineActions')"
            >
              <!--
              The ordinary way to reach leveling, beside home-all rather than
              buried in the full-width row below. Always labeled "Level bed"
              regardless of which command it actually runs, so the button
              reads the same on every printer; the tooltip and aria-label
              carry the real macro name via `primaryLevelingMethod`. Turning
              this off (`showLevelBedShortcut`) hides the action outright — it
              does not fall back into the row, which unconditionally excludes
              `primaryLevelingMethod` regardless of whether this button is
              drawn. See `levelingRowMethods`. Shares this guard and disabled
              condition exactly, since it is the same action reached from a
              second place, not a second action.
            -->
              <AppButton
                v-if="showLevelBedShortcut && primaryLevelingMethod"
                size="sm"
                :guard="levelingGuard"
                :pending="printer.pendingCommands.leveling"
                :label="t('dashboard.movement.levelBedShort')"
                class="jog-leveling-shortcut"
                :aria-busy="printer.pendingCommands.leveling || undefined"
                :disabled="printer.pendingCommands.leveling || homing || !isFullyHomed"
                :aria-label="t(`dashboard.movement.leveling.${primaryLevelingMethod}`)"
                :title="t(`dashboard.movement.leveling.${primaryLevelingMethod}`)"
                @click="requestLevelingShortcut"
              />
              <AppButton
                size="xs"
                class="jog-pivot jog-pivot--primary"
                :aria-label="t('dashboard.movement.homeAll')"
                :disabled="printer.pendingCommands.home"
                @click="() => printer.homeAxes()"
              >
                <AppIcon name="home" class="size-4 shrink-0" aria-hidden="true" />
                <span>{{ t('dashboard.movement.homeAllShort') }}</span>
              </AppButton>
              <div class="jog-actions">
                <!--
                `G28 X Y` beside `G28` itself: homing the gantry without
                re-homing Z matters wherever Z homing is the slow or disruptive
                half — a probe deploy/stow, a bed mesh only a Z re-home
                perturbs. Off by default, like `showBedPlanWhilePrinting`: a
                control nobody asked for outright until it existed does not get
                to change what an existing card already shows.
              -->
                <AppButton
                  v-if="showHomeXY"
                  size="xs"
                  class="jog-pivot"
                  :aria-label="t('dashboard.movement.homeXY')"
                  :disabled="printer.pendingCommands.home"
                  @click="() => printer.homeAxes('XY')"
                >
                  <AppIcon name="home" class="size-4 shrink-0" aria-hidden="true" />
                  <span>{{ t('dashboard.movement.homeXYShort') }}</span>
                </AppButton>
                <AppButton
                  size="sm"
                  :guard="motorsOffGuard"
                  class="jog-motors-off"
                  :aria-label="t('dashboard.movement.motorsOff')"
                  :title="t('dashboard.movement.motorsOff')"
                  :disabled="printer.pendingCommands.motorsOff"
                  @click="requestMotorsOff"
                >
                  <AppIcon name="bolt" class="size-4 shrink-0" aria-hidden="true" />
                  <span>{{ t('dashboard.movement.motorsOffShort') }}</span>
                </AppButton>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!--
      What is left down here is the two kinds of action that are not part of
      jogging: places to send the toolhead, and procedures that run for minutes
      and report back. One stretched row each, so the right edge is straight at
      any card width rather than landing wherever the labels happen to end.
    -->
      <div v-if="hasActions" class="movement-actions">
        <!--
        Parking stays on screen and disables while a job is running, where the
        jog matrix and the leveling row are removed outright. The line between
        the two treatments is what the control *is*, not how dangerous it is: a
        park names a destination, which is exactly what a tap on the bed plan
        does, and the plan is also drawn-and-disabled while printing. The jog
        rows issue motion by hand and the leveling row starts a procedure;
        neither is a choice this card offers over a running job, and neither has
        a reading worth leaving behind. Two dead park buttons also cost less than
        a row that appears and disappears under a plot being watched — the same
        reason the feed rate reserves its line rather than using `v-if`.
      -->
        <div v-if="hasParkRow" class="movement-actions__row">
          <AppButton
            v-for="park in parkPositions"
            :key="`park-${park.key}`"
            size="sm"
            :disabled="!canMoveToTarget"
            @click="printer.moveTo(park.target)"
          >
            {{ t(`dashboard.movement.park.${park.key}`) }}
          </AppButton>
        </div>

        <div v-if="hasLevelingRow" class="movement-actions__row">
          <AppButton
            v-for="method in levelingRowMethods"
            :key="`leveling-${method}`"
            size="sm"
            :guard="levelingGuard"
            :pending="printer.pendingCommands.leveling"
            :aria-busy="printer.pendingCommands.leveling || undefined"
            :disabled="printer.pendingCommands.leveling || homing || !isFullyHomed"
            @click="requestLeveling(method)"
          >
            {{ t(`dashboard.movement.leveling.${method}`) }}
          </AppButton>
        </div>

        <!--
        What homing cannot tell you: an axis reads as homed on a machine whose
        gantry is out of square, and the first sign is otherwise a first layer
        thick at one end. Klipper reports it as `applied` on the alignment object
        itself, and it says nothing while all is well — so this line appears only
        when there is something to do about it, directly under the button that
        does it. Icon plus words, never the color alone.
      -->
        <p v-for="notice in unappliedLeveling" :key="notice" class="movement-actions__notice">
          <AppIcon name="warning" class="size-3.5 shrink-0" aria-hidden="true" />
          <span>{{ notice }}</span>
        </p>
      </div>

      <!--
      Klipper reports screw adjustments only as console text; rendering them as
      rows is the whole point of running this from the card. They are read as a
      set — which screw needs the most turn, which are nearly there — so the
      instructions have to share a column edge, which is what `module-table`
      is and what a row-by-row flex container could not do.
    -->
      <div v-if="screwResults.length > 0" class="module-table screw-table">
        <div class="module-table__head">
          <span>{{ t('dashboard.movement.screwColumnName') }}</span>
          <span>{{ t('dashboard.movement.screwColumnAdjustment') }}</span>
        </div>
        <div v-for="screw in screwResults" :key="screw.name" class="module-table__row">
          <span class="module-table__name">{{ screw.name }}</span>
          <span class="module-table__value" :class="{ 'text-muted': screw.isBase }">
            {{ screwInstruction(screw) }}
          </span>
        </div>
      </div>

      <div v-if="showZOffset" class="trim">
        <div class="trim__line">
          <!--
          The unit is stated once, here, rather than repeated on eight buttons
          that have no room for it — and the value is written in the same unit
          as the steps, so the two numbers on this line can always be compared
          without converting one of them in your head.
        -->
          <span class="trim__label">
            {{ t(`dashboard.movement.zOffsetTitle.${offsetUnit}`) }}
          </span>
          <span class="trim__value">{{ offsetValue(zOffset, offsetUnit) }}</span>
          <AppButton
            variant="quiet"
            size="xs"
            icon-only
            icon="undo"
            :disabled="!canAdjustOffset"
            :aria-label="t('dashboard.movement.zOffsetReset')"
            :title="t('dashboard.movement.zOffsetReset')"
            @click="printer.resetZOffset()"
          />
          <!--
          Absent, not disabled, where this machine has nowhere to put the
          offset. `Z_OFFSET_APPLY_PROBE` comes from Klipper's probe object and
          `Z_OFFSET_APPLY_ENDSTOP` from `manual_probe`, so exactly one of them
          exists on any printer and a machine with neither has no command at
          all — which is why the target decides whether the control is drawn as
          well as which script it sends. It shipped as an unconditional probe
          command, and on every probe-less printer it was a button whose only
          possible outcome was "Unknown command".
        -->
          <AppButton
            v-if="offsetApplyTarget"
            variant="quiet"
            size="xs"
            icon-only
            icon="save"
            :disabled="printer.pendingCommands.zOffset || zOffset === 0"
            :aria-label="t('dashboard.movement.zOffsetApply')"
            :title="offsetApplyTitle"
            @click="applyOffset"
          />
        </div>

        <!--
        Z_OFFSET_APPLY_PROBE only stages the change; without SAVE_CONFIG the
        dialed-in offset is gone at the next Klipper restart, and nothing on the
        card used to say so. Gated on the subscribed pending flag as well as on
        having applied, so saving from anywhere — the header gate, the console,
        another browser — clears it here too.

        A statement, not an action. Writing the config is one printer-wide fact
        and is offered once, from the header, rather than by whichever card
        happened to stage it; this says the offset is not permanent yet and names
        where to make it so.
      -->
        <p v-if="offsetNeedsSaving" class="trim__pending">
          <span>{{ t('dashboard.movement.zOffsetUnsaved') }}</span>
        </p>
        <div class="trim__steps" :style="{ '--offset-step-min': offsetStepMinimum }">
          <AppButton
            v-for="step in descending(offsetSteps)"
            :key="`offset-minus-${step}`"
            size="xs"
            mono
            :label="signedOffsetStep(-step, offsetUnit)"
            :disabled="!canAdjustOffset"
            :aria-label="offsetStepLabel(-step)"
            :title="offsetStepLabel(-step)"
            @click="printer.adjustZOffset(-step)"
          />
          <AppButton
            v-for="step in offsetSteps"
            :key="`offset-plus-${step}`"
            size="xs"
            mono
            :label="signedOffsetStep(step, offsetUnit)"
            :disabled="!canAdjustOffset"
            :aria-label="offsetStepLabel(step)"
            :title="offsetStepLabel(step)"
            @click="printer.adjustZOffset(step)"
          />
        </div>

        <!--
        Which way the gap goes, under the group each half describes. The sign
        alone does not say it: `SET_GCODE_OFFSET Z_ADJUST` moves the toolhead by
        the delta, so negative closes the gap — while the probe's own
        `z_offset`, which this very value is folded into by
        `Z_OFFSET_APPLY_PROBE`, runs the other way. Z zero is the nozzle on the
        bed, so a negative babystep is the one that presses into it.
      -->
        <p class="trim__legend">
          <span>
            <AppIcon name="down" class="size-3" aria-hidden="true" />
            {{ t('dashboard.movement.zOffsetLegendCloser') }}
          </span>
          <span>
            {{ t('dashboard.movement.zOffsetLegendFarther') }}
            <AppIcon name="up" class="size-3" aria-hidden="true" />
          </span>
        </p>
      </div>

      <!--
      The second trim: `M220`, a multiplier on every move the machine makes,
      which is why it is on this card and not filed under the job it happens to
      be scaling. Its sibling `M221` already sits on the Extruder card for the
      same reason, so both factors now read the same way — each beside the thing
      it scales.

      Deliberately outside the printing gate that hides the jog matrix. Slowing
      a running print down is the whole point of this control; unlike a manual
      jog, `M220` is designed to be changed mid-job. And it is always drawn
      rather than only while printing, because Klipper never clears it: a factor
      left at 60% is session state that silently applies to whatever prints
      next, and a control that hides between jobs is how nobody notices.
    -->
      <div v-if="showSpeedFactor">
        <AppSlider
          :label="t('dashboard.movement.speedFactor')"
          :model-value="speedFactorDraft"
          :unit="t('dashboard.percentUnit')"
          :min="10"
          :max="300"
          :step="1"
          entry
          can-reset
          :reset-value="100"
          :disabled="printer.pendingCommands.speed"
          @commit="commitSpeedFactor"
        />
      </div>
    </div>
  </AppDashboardModule>

  <ConfirmDialog
    :open="confirmingMotorsOff"
    :title="t('dashboard.movement.motorsOffConfirmTitle')"
    :description="t('dashboard.movement.motorsOffConfirmDescription')"
    :confirm-label="t('dashboard.movement.motorsOff')"
    tone="danger"
    @confirm="confirmMotorsOff"
    @cancel="confirmingMotorsOff = false"
  />
  <ConfirmDialog
    :open="pendingLeveling !== null"
    :title="t('dashboard.movement.levelingConfirmTitle')"
    :description="
      t('dashboard.movement.levelingConfirmDescription', {
        method: pendingLeveling ? t(`dashboard.movement.leveling.${pendingLeveling}`) : '',
      })
    "
    :confirm-label="t('dashboard.movement.levelingConfirmAction')"
    @confirm="confirmLeveling"
    @cancel="pendingLeveling = null"
  />
</template>
