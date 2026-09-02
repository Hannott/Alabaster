<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { bedExtents, nudgeCoordinate, planCoordinate, planPoint } from '@/dashboard/bedPlan'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'

/**
 * A top-down picture of the build volume, the nozzle on it, and a drag that
 * names somewhere to send the nozzle. It replaces the X/Y "min / center / max"
 * step mode, which asked a spatial question and answered it with three numbers
 * that never fitted the buttons drawing them.
 *
 * The geometry is all in `dashboard/bedPlan.ts` and tested there. What lives
 * here is the interaction: which marker exists when, and what commits a move.
 */

const { locale, t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()

const emit = defineEmits<{
  move: [target: { x: number; y: number }]
  /** Where the pointer is hovering, in machine coordinates, or `null` once it leaves. */
  hover: [target: { x: number; y: number } | null]
}>()

const props = defineProps<{
  /** Whether a move may be commanded at all — the card's shared precondition. */
  canMove: boolean
  /** The step the keyboard nudges by, from the active X and Y scale. */
  keyboardStep: number
  /**
   * The X/Y/Z readout, already formatted by the card that owns the locale and
   * the not-homed dash — empty when the card is showing it elsewhere instead,
   * so the plot never has to decide that for itself. `preview` marks a value
   * standing in for a hover rather than the machine's own position, which is
   * the card's call: it is the one that knows whether the Z entry in this same
   * corner is currently hovered on the slider standing beside the plot.
   */
  axesReadout: readonly { code: string; value: string; preview?: boolean }[]
}>()

const target = ref<{ x: number; y: number } | null>(null)
/**
 * The plot element itself. Only `commitFromControl` needs it — every other
 * handler here already has it as the event's `currentTarget`.
 */
const plot = ref<HTMLElement | null>(null)

const coordinateFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)

const extents = computed(() =>
  bedExtents(printer.buildVolume.minimum, printer.buildVolume.maximum, printerConfig.bedShape),
)

const homedAxes = computed(() => printer.motion.homedAxes.toUpperCase())
const isPlanarHomed = computed(() => homedAxes.value.includes('X') && homedAxes.value.includes('Y'))

/**
 * The nozzle marker exists only once X and Y are homed, for the same reason
 * the coordinate readout shows a dash: Klipper keeps reporting a position for
 * an unhomed axis, but it is the last value it happened to hold rather than
 * somewhere the machine knows the nozzle to be. Drawing that on a picture of
 * the bed would be a far more confident lie than printing the number.
 */
const nozzle = computed(() => {
  const box = extents.value
  if (!box || !isPlanarHomed.value) return null
  const [x, y] = printer.toolheadPosition
  if (x === null || y === null) return null
  return planPoint({ x, y }, box)
})

const targetPoint = computed(() => {
  const box = extents.value
  return box && target.value ? planPoint(target.value, box) : null
})

/** A placed target is meaningless once the machine can no longer be moved. */
watch(
  () => props.canMove,
  (canMove) => {
    if (!canMove) {
      target.value = null
      emit('hover', null)
    }
  },
)

function describe(coordinate: { x: number; y: number }): string {
  return t('dashboard.movement.planTargetAt', {
    x: coordinateFormatter.value.format(coordinate.x),
    y: coordinateFormatter.value.format(coordinate.y),
  })
}

const planLabel = computed(() => {
  if (!extents.value) return t('dashboard.movement.planUnknown')
  if (target.value) return t('dashboard.movement.planGoTo', { target: describe(target.value) })
  const [x, y] = printer.toolheadPosition
  if (!isPlanarHomed.value || x === null || y === null) {
    return t('dashboard.movement.planNotHomed')
  }
  return t('dashboard.movement.planNozzleAt', {
    x: coordinateFormatter.value.format(x),
    y: coordinateFormatter.value.format(y),
  })
})

/**
 * The plot is drawn at the bed's own aspect ratio rather than stretched to a
 * box, so a rectangular bed is not silently squared. That also makes the
 * pointer maths honest: with no letterboxing inside the element, a fraction of
 * the element is a fraction of the bed, and nothing has to unpick a
 * `preserveAspectRatio` transform to find out where a tap landed.
 */
const plotStyle = computed(() =>
  extents.value ? { aspectRatio: `${extents.value.width} / ${extents.value.depth}` } : undefined,
)

function coordinateAt(event: PointerEvent): { x: number; y: number } | null {
  const box = extents.value
  if (!box || !props.canMove) return null
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  return planCoordinate(
    { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height },
    box,
  )
}

function aimAt(event: PointerEvent): void {
  const coordinate = coordinateAt(event)
  if (coordinate) target.value = coordinate
}

/**
 * Aiming is a drag, not a tap: the target follows the pointer for as long as
 * the button is held, so a destination can be corrected without lifting and
 * trying again. `setPointerCapture` is what makes that survive the pointer
 * leaving the plot mid-drag — without it a drag that strays over the jog rows
 * silently stops tracking, which reads as the plot having lost the gesture.
 */
function startAim(event: PointerEvent): void {
  if (!props.canMove) return
  const pressed = event.currentTarget as HTMLElement
  pressed.setPointerCapture?.(event.pointerId)
  // `pointerdown.prevent` is what stops a drag selecting the card around it,
  // and it also suppresses the focus the press would otherwise have given —
  // which left Enter doing nothing at all after aiming with the mouse, since
  // the key handlers are on the plot. Focus is taken back explicitly.
  pressed.focus()
  aimAt(event)
  emit('hover', coordinateAt(event))
}

/**
 * Every pointer move over the plot reports a hover, whether or not a button
 * is held — a lighter-weight relative of aiming, answering "what would this
 * be" rather than "go here". Aiming is layered on top of the same event only
 * while a button is down.
 */
function continueAim(event: PointerEvent): void {
  emit('hover', coordinateAt(event))
  // `buttons` rather than a held flag of our own: a button released outside
  // the window never sends a pointerup, and the flag would stay stuck on.
  if (event.buttons === 0) return
  aimAt(event)
}

/**
 * Arrow keys nudge in millimetres rather than in pixels, so one press means
 * the same distance whatever size the card is. With nothing placed yet the
 * first press starts from the nozzle, which is the position the user is
 * looking at.
 */
function nudge(deltaX: number, deltaY: number): void {
  const box = extents.value
  if (!box || !props.canMove) return
  const [x, y] = printer.toolheadPosition
  const from = target.value ?? (x !== null && y !== null ? { x, y } : null)
  if (!from) return
  target.value = nudgeCoordinate(from, deltaX, deltaY, box)
}

/**
 * Sends the aimed target. Three ways in, and none of them is a single press on
 * the plot: a double-click, whose first press has already aimed; Enter for the
 * keyboard; and the `Go` control that appears over the plot once a target is
 * placed.
 *
 * A single press still only aims, and that is the whole safety of it — this is
 * the one control on the card that can command an arbitrarily long move, and a
 * full-bed traverse across a printed part is a crash.
 *
 * `Go` was retired once, on the grounds that controls standing beside the plot
 * cost more width than the picture they served. That argument was about a
 * gutter, and it still holds; what came back is not one. Aiming with no visible
 * way to send left the gesture undiscoverable — a double-click is not guessable
 * and nothing on the card said it, the plot's own accessible name did not
 * mention it either, and the published documentation described a `Go` button
 * that no longer existed. As an overlay inside the plot's own box, in the corner
 * the readout does not use, it costs no width at all: the same move the corner
 * reading made when it left the header for the plot.
 */
function commit(): void {
  if (!target.value || !props.canMove) return
  emit('move', { ...target.value })
  target.value = null
}

/**
 * The same commit, from the `Go` control, plus the one thing that control needs
 * and the plot's own two gestures do not: somewhere for focus to go.
 *
 * Sending clears the target, which unmounts the button that was just pressed —
 * so a keyboard user who reaches `Go` and activates it is left on `<body>`, with
 * the plot they were aiming at no longer in the tab position they had got to.
 * The plot is where they were, so the plot is where focus returns; the two
 * gestures on the plot itself never leave it in the first place.
 */
function commitFromControl(): void {
  plot.value?.focus()
  commit()
}
</script>

<template>
  <div v-if="extents" class="bed-plan">
    <div
      ref="plot"
      class="bed-plan__plot"
      :style="plotStyle"
      role="group"
      tabindex="0"
      :aria-label="planLabel"
      @pointerdown.prevent="startAim"
      @pointermove.prevent="continueAim"
      @pointerleave="emit('hover', null)"
      @dblclick.prevent="commit"
      @keydown.left.prevent="nudge(-keyboardStep, 0)"
      @keydown.right.prevent="nudge(keyboardStep, 0)"
      @keydown.up.prevent="nudge(0, keyboardStep)"
      @keydown.down.prevent="nudge(0, -keyboardStep)"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="target = null"
    >
      <!--
        The plate's own fill, border and clipping live on this inner box
        rather than on `.bed-plan__plot` itself, so the readout and `Go` below
        can stand in the plot's corners without being clipped by them. A
        circular bed (delta, rotary delta, polar) needs exactly that: its
        `bedExtents` is always the square Klipper reports, so the plot itself
        stays square and the corners keep the room the readout and `Go`
        already use — only this box rounds into the circle inscribed in that
        square, via `border-radius: 50%` on `--circular`, which costs nothing
        else because `bedExtents` only ever calls a bed circular when its
        reported box is square to begin with.

        Only the center lines are drawn in SVG. They are the one thing
        `preserveAspectRatio="none"` cannot spoil — a line stretched along its
        own axis is the same line — while anything with a shape of its own
        comes out distorted by however far the bed is from square: a circle
        becomes an ellipse, and a crosshair's two arms end up different
        lengths. Both markers are therefore DOM boxes positioned in per-cent,
        which the aspect ratio does not touch.
      -->
      <div
        class="bed-plan__surface"
        :class="{ 'bed-plan__surface--circular': extents.shape === 'circular' }"
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <line class="bed-plan__grid" x1="50" y1="0" x2="50" y2="100" />
          <line class="bed-plan__grid" x1="0" y1="50" x2="100" y2="50" />
        </svg>
        <!--
          Both markers translate a full-size box rather than moving their own
          edges: a transform per cent is a per cent of the element, so a box
          that already fills the plot converts the plan's own fractions
          straight into a GPU-friendly translate, and the nozzle can then be
          interpolated between samples without animating layout.

          On a circular bed this box is what clips a marker that strays
          outside the circle — `overflow: hidden` on the surface itself —
          which only matters for the nozzle: `planCoordinate` and
          `nudgeCoordinate` already pull a placed target back to the circle's
          edge before it can be drawn here, but the nozzle is deliberately
          never clamped, so a toolhead genuinely outside the reachable circle
          still reads as off the bed rather than as a dot sitting on top of an
          unreachable corner.
        -->
        <!--
          Both are keyed, and that is load-bearing rather than tidiness. They
          are adjacent `v-if` spans of the same tag, so without keys Vue is
          free to patch one into the other when the crosshair is removed on
          commit — reusing the element rather than replacing it. The nozzle
          then inherits the crosshair's transform as its starting value and
          animates across the plot from wherever the aim happened to be,
          which is exactly the jump this had: order a move, and the dot flies
          off and comes back.
        -->
        <span
          v-if="targetPoint"
          key="bed-plan-target"
          class="bed-plan__target"
          :style="{ transform: `translate(${targetPoint.x * 100}%, ${targetPoint.y * 100}%)` }"
          aria-hidden="true"
        ></span>
        <span
          v-if="nozzle"
          key="bed-plan-nozzle"
          class="bed-plan__nozzle"
          :style="{ transform: `translate(${nozzle.x * 100}%, ${nozzle.y * 100}%)` }"
          aria-hidden="true"
        ></span>
      </div>
      <!--
        The readout sits in the plot's own bottom-left corner rather than in a
        side gutter, so the plot no longer costs the card a column either side
        just to hold three numbers. It stacks above whatever the markers draw
        — `z-index` in the stylesheet, not DOM order, since the markers now
        live inside `.bed-plan__surface`, a sibling that comes before this one
        — so a nozzle or target passing through that corner goes behind the
        digits instead of over them. Not `aria-hidden`: this is the position,
        stated once, not a decoration: with it moved out of the header the
        group's own `aria-label` no longer carries Z at all, so screen-reader
        users would lose it entirely if it were hidden here too.

        Deliberately a sibling of `.bed-plan__surface` rather than a child of
        it: the surface is what a circular bed clips to its inscribed circle,
        and the readout sits in the square plot's own corner, which the
        circle does not reach. Nesting it inside the surface would have it
        clipped away on exactly the printers this change is for.
      -->
      <div v-if="axesReadout.length > 0" class="bed-plan__readout">
        <span
          v-for="axis in axesReadout"
          :key="`plan-readout-${axis.code}`"
          class="bed-plan__readout-axis"
          :class="{ 'bed-plan__readout-axis--preview': axis.preview }"
        >
          <span class="bed-plan__readout-code">{{ axis.code }}</span>
          <span class="bed-plan__readout-value">{{ axis.value }}</span>
        </span>
      </div>
      <!--
        The visible way to send an aimed target, in the corner the readout
        leaves empty, and only while there is something to send — the same
        unsent-value rule a typed temperature target follows.

        Every handler here is about *not* reaching the plot underneath, and each
        one has a distinct failure behind it. `pointerdown.stop`: the plot aims on
        every press that reaches it, so without this, pressing Go would re-aim at
        Go's own corner and then send the toolhead there instead of to the
        crosshair. `keydown.enter.stop.prevent`: the plot commits on Enter too,
        and preventing the key's default is what stops the button *also*
        activating itself, so one keypress is one move. `pointermove.stop` with a
        cleared hover on entry: every pointer move over the plot previews a
        coordinate in the corner reading, and this button is not a place on the
        bed — left alone, resting on Go previewed the bed corner behind it as
        though that were the destination.

        Deliberately no `preventDefault` on the press: the plot needs one to stop
        a drag selecting the card, and it costs that handler the focus a press
        normally gives — which is exactly what this button must keep.
      -->
      <AppButton
        v-if="target"
        variant="primary"
        size="xs"
        :label="t('dashboard.movement.planGo')"
        class="bed-plan__go"
        :aria-label="planLabel"
        @pointerdown.stop
        @pointermove.stop
        @pointerenter="emit('hover', null)"
        @click="commitFromControl"
        @keydown.enter.stop.prevent="commitFromControl"
      />
    </div>
  </div>
</template>
