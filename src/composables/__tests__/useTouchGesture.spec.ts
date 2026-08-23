import { describe, expect, it } from 'vitest'

import { useTouchGesture, type TouchGesture } from '@/composables/useTouchGesture'

/**
 * jsdom has no PointerEvent, and the composable only ever reads four fields of
 * one, so the events are built rather than constructed.
 */
function pointer(pointerId: number, clientX: number, clientY: number): PointerEvent {
  return { pointerId, clientX, clientY, pointerType: 'touch' } as PointerEvent
}

function mouse(pointerId: number, clientX: number, clientY: number): PointerEvent {
  return { pointerId, clientX, clientY, pointerType: 'mouse' } as PointerEvent
}

/**
 * A browser reports one pointer per `pointermove`, so a two-finger movement
 * arrives as a run of single-finger events and the gesture is what each of them
 * did to the pair. The camera therefore sees several small steps rather than
 * one, and it is their total that has to match the hand — which is what these
 * assertions are made against.
 */
function total(
  gesture: TouchGesture,
  moves: readonly PointerEvent[],
): { panX: number; panY: number; scale: number } {
  let panX = 0
  let panY = 0
  let scale = 1
  for (const event of moves) {
    const step = gesture.move(event)
    if (!step) continue
    panX += step.panX
    panY += step.panY
    scale *= step.scale
  }
  return { panX, panY, scale }
}

describe('two-finger pan and pinch', () => {
  it('leaves a single finger to the caller', () => {
    const gesture = useTouchGesture()

    expect(gesture.begin(pointer(1, 100, 100))).toBe(false)
    expect(gesture.engaged.value).toBe(false)
    expect(gesture.move(pointer(1, 140, 100))).toBeNull()
  })

  it('never claims a mouse, which comes one pointer at a time', () => {
    const gesture = useTouchGesture()

    expect(gesture.begin(mouse(1, 100, 100))).toBe(false)
    expect(gesture.begin(mouse(2, 200, 100))).toBe(false)
    expect(gesture.engaged.value).toBe(false)
    expect(gesture.move(mouse(1, 140, 100))).toBeNull()
  })

  it('takes the gesture over on the second finger', () => {
    const gesture = useTouchGesture()

    gesture.begin(pointer(1, 100, 100))

    expect(gesture.begin(pointer(2, 200, 100))).toBe(true)
    expect(gesture.engaged.value).toBe(true)
  })

  it('reports the midpoint travel as the pan', () => {
    const gesture = useTouchGesture()
    gesture.begin(pointer(1, 100, 100))
    gesture.begin(pointer(2, 200, 100))

    // Both fingers 20 right and 10 down: the shape between them ends where it
    // started, so this is a pan and nothing else.
    const step = total(gesture, [pointer(1, 120, 110), pointer(2, 220, 110)])

    expect(step.panX).toBeCloseTo(20)
    expect(step.panY).toBeCloseTo(10)
    expect(step.scale).toBeCloseTo(1)
  })

  it('reports the fingers spreading as the magnification', () => {
    const gesture = useTouchGesture()
    gesture.begin(pointer(1, 100, 100))
    gesture.begin(pointer(2, 200, 100))

    // 100 px apart to 200 px apart, ending on the same midpoint.
    const step = total(gesture, [pointer(1, 50, 100), pointer(2, 250, 100)])

    expect(step.scale).toBeCloseTo(2)
    // The midpoint ends where it started, so a pinch is not also a pan.
    expect(step.panX).toBeCloseTo(0)
    expect(step.panY).toBeCloseTo(0)
  })

  it('keeps panning on the finger left down as a pinch is released', () => {
    // Fingers never leave the glass at the same instant. Handing the last one
    // back to the caller made every pinch end by orbiting a few degrees.
    const gesture = useTouchGesture()
    gesture.begin(pointer(1, 100, 100))
    gesture.begin(pointer(2, 200, 100))
    gesture.end(pointer(2, 200, 100))

    expect(gesture.engaged.value).toBe(true)
    const step = gesture.move(pointer(1, 130, 100))
    expect(step?.panX).toBeCloseTo(30)
    expect(step?.scale).toBe(1)

    gesture.end(pointer(1, 130, 100))
    expect(gesture.engaged.value).toBe(false)
  })

  it('re-seeds rather than reporting the jump when a finger arrives or leaves', () => {
    // Adding a finger moves the midpoint by half the distance to it, which is a
    // large number the hand never made. Reported, it jumped the camera on the
    // way into and out of every gesture.
    const gesture = useTouchGesture()
    gesture.begin(pointer(1, 100, 100))
    gesture.begin(pointer(2, 200, 100))
    gesture.begin(pointer(3, 600, 100))

    const afterArrival = gesture.move(pointer(1, 100, 100))
    expect(afterArrival?.panX).toBeCloseTo(0)
    expect(afterArrival?.scale).toBeCloseTo(1)

    gesture.end(pointer(3, 600, 100))
    const afterDeparture = gesture.move(pointer(1, 100, 100))
    expect(afterDeparture?.panX).toBeCloseTo(0)
    expect(afterDeparture?.scale).toBeCloseTo(1)
  })

  it('holds the magnification at 1 while the fingers are on the same spot', () => {
    const gesture = useTouchGesture()
    gesture.begin(pointer(1, 100, 100))
    gesture.begin(pointer(2, 101, 100))

    const step = gesture.move(pointer(2, 140, 100))

    expect(step?.scale).toBe(1)
  })

  it('drops every finger when cancelled', () => {
    const gesture = useTouchGesture()
    gesture.begin(pointer(1, 100, 100))
    gesture.begin(pointer(2, 200, 100))

    gesture.cancel()

    expect(gesture.engaged.value).toBe(false)
    expect(gesture.move(pointer(1, 140, 100))).toBeNull()
  })

  it('ignores an end for a finger it never tracked', () => {
    const gesture = useTouchGesture()
    gesture.begin(pointer(1, 100, 100))
    gesture.begin(pointer(2, 200, 100))

    gesture.end(pointer(9, 0, 0))

    expect(gesture.engaged.value).toBe(true)
  })
})
