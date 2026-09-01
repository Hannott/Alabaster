import { ref, type Ref } from 'vue'

/**
 * The two-finger half of a canvas viewport's pointer handling: pan from the
 * fingers' midpoint, magnification from how far apart they are.
 *
 * It exists as one shared piece rather than once per viewer because a pinch has
 * to feel the same in both of them. The G-code viewer and the bed mesh height
 * map have nothing else in common — different cameras, different projections,
 * different units — so what is shared here is deliberately only the gesture
 * arithmetic. Each viewer decides what a pan and a magnification *mean* to its
 * own camera, including where a zoom is anchored.
 *
 * Two decisions shape it.
 *
 * **The gesture latches.** It engages when the second finger lands and stays
 * engaged until the last one lifts, so a finger left down for the moment it
 * takes to release a pinch keeps panning instead of falling back to a
 * one-finger orbit. Fingers never leave a touchscreen at the same instant, and
 * without the latch every pinch ended by spinning the model a few degrees.
 *
 * **A change in the number of fingers emits nothing.** Adding or removing a
 * finger moves the midpoint and the spread by a large amount that the hand
 * never made, so those two frames re-seed the baseline and report no movement
 * at all. Emitting them jumped the camera on the way into and out of every
 * gesture.
 *
 * Touch pointers only. A mouse and a pen come one at a time, and folding them
 * in here would take the drag away from handlers that already read the button.
 *
 * One consequence to hold on to: a browser reports one pointer per
 * `pointermove`, so a two-finger movement arrives as a run of single-finger
 * events and each step is only what that one finger did to the pair. A finger
 * moving alone therefore reports both a pan and a magnification, because moving
 * one of two fingers genuinely does both. It is the total across the run that
 * matches the hand, which is what the spec asserts — a caller must apply every
 * step rather than waiting for a step it can read as "the whole gesture".
 */

/** Below this the fingers are effectively on top of each other; see `measure`. */
const minimumSpread = 4

export interface TouchGestureStep {
  /** How far the fingers' midpoint moved since the previous step, in CSS pixels. */
  panX: number
  panY: number
  /** How much the fingers spread since the previous step. Exactly 1 when unchanged. */
  scale: number
  /** The midpoint now, in client coordinates, for anchoring a zoom between the fingers. */
  centerX: number
  centerY: number
}

export interface TouchGesture {
  /** True from the second finger landing until the last one lifts. */
  engaged: Ref<boolean>
  /**
   * Takes a `pointerdown`. Returns true once the gesture owns the pointers, at
   * which point the caller abandons whatever one-finger drag it had started —
   * leaving it running underneath is what makes a pinch also rotate.
   */
  begin: (event: PointerEvent) => boolean
  /**
   * Takes a `pointermove`. Returns the movement to apply, or null when this
   * pointer is not part of an engaged gesture and the caller should handle it
   * itself.
   */
  move: (event: PointerEvent) => TouchGestureStep | null
  /** Takes a `pointerup` or `pointercancel`. Safe to call for any pointer. */
  end: (event: PointerEvent) => void
  /** Drops every finger, for a viewer that stops accepting the gesture mid-way. */
  cancel: () => void
}

export function useTouchGesture(): TouchGesture {
  const engaged = ref(false)
  const pointers = new Map<number, { x: number; y: number }>()
  let previous: { centerX: number; centerY: number; spread: number } | null = null

  /**
   * The midpoint, and the mean distance from it. Mean distance rather than the
   * separation of two named fingers so that a third one resting on the glass
   * neither ends the gesture nor makes the magnification jump: for exactly two
   * fingers it is half the separation, and half of a ratio is the same ratio.
   */
  function measure(): { centerX: number; centerY: number; spread: number } {
    const count = Math.max(1, pointers.size)
    let sumX = 0
    let sumY = 0
    for (const point of pointers.values()) {
      sumX += point.x
      sumY += point.y
    }
    const centerX = sumX / count
    const centerY = sumY / count
    let spread = 0
    for (const point of pointers.values()) {
      spread += Math.hypot(point.x - centerX, point.y - centerY)
    }
    return { centerX, centerY, spread: spread / count }
  }

  function isTouch(event: PointerEvent): boolean {
    return event.pointerType === 'touch'
  }

  function begin(event: PointerEvent): boolean {
    if (!isTouch(event)) return false
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size >= 2) engaged.value = true
    previous = measure()
    return engaged.value
  }

  function move(event: PointerEvent): TouchGestureStep | null {
    if (!isTouch(event) || !engaged.value) return null
    const tracked = pointers.get(event.pointerId)
    if (!tracked) return null
    tracked.x = event.clientX
    tracked.y = event.clientY
    const next = measure()
    const before = previous
    previous = next
    if (!before) return null
    // A spread this small is two fingers on the same spot, where the ratio of
    // one frame's spread to the next says nothing about what the hand did.
    const scale =
      before.spread > minimumSpread && next.spread > minimumSpread ? next.spread / before.spread : 1
    return {
      panX: next.centerX - before.centerX,
      panY: next.centerY - before.centerY,
      scale,
      centerX: next.centerX,
      centerY: next.centerY,
    }
  }

  function end(event: PointerEvent): void {
    if (!pointers.delete(event.pointerId)) return
    if (pointers.size === 0) {
      cancel()
      return
    }
    previous = measure()
  }

  function cancel(): void {
    pointers.clear()
    previous = null
    engaged.value = false
  }

  return { engaged, begin, move, end, cancel }
}
