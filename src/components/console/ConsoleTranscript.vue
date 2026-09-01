<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { createTimeFormatter } from '@/i18n/formats'
import type { ConsoleEntry, ConsoleEntryKind } from '@/services/console/transcript'

/**
 * The transcript both console surfaces render: the dashboard card and the
 * console page. One component because the two must scroll, wrap, anchor and
 * follow identically — a card that behaves unlike the page it links to is the
 * defect this shares code to prevent. What differs is only how tall it is.
 *
 * It is a log, not a console: no input lives here, `role="log"` announces
 * arriving lines, and the box is focusable so it can be scrolled from the
 * keyboard. Text stays selectable, because a transcript is content to copy out
 * of rather than clickable chrome.
 */
const props = withDefaults(
  defineProps<{
    entries: readonly ConsoleEntry[]
    /**
     * How many rows tall. `null` fills whatever height the parent gives it,
     * which is what the page does; the card states a count so its height is
     * derived from its own line height rather than from a magic pixel value.
     */
    lines?: number | null
    showTimestamps?: boolean
    compact?: boolean
    /** Show Klipper's own text, prefixes intact, rather than the cleaned message. */
    rawOutput?: boolean
    /** Jump to the newest line as it arrives, while the reader is at that edge. */
    follow?: boolean
    /**
     * Newest line first, at the top. Paired with a prompt above the transcript:
     * typing in one place and watching the answer appear at the far end of the box
     * is what makes the other combination unusable, which is why this follows the
     * prompt's position rather than being a setting of its own.
     */
    newestFirst?: boolean
    label?: string
  }>(),
  {
    lines: 12,
    showTimestamps: false,
    compact: false,
    rawOutput: false,
    follow: true,
    newestFirst: false,
  },
)

const emit = defineEmits<{ command: [command: string] }>()

const { t, locale } = useI18n({ useScope: 'global' })
const transcript = ref<HTMLElement | null>(null)
/**
 * Whether the reader is parked at the end the newest line arrives at. Which end
 * that is depends on `newestFirst`, so this is "at the following edge" rather
 * than "at the bottom".
 */
const isAtFollowEdge = ref(true)

/**
 * Rendered order. Reversed rather than sorted: `entries` is already in arrival
 * order, and re-sorting would need a tiebreak for the many lines that share a
 * millisecond.
 */
const rendered = computed(() => (props.newestFirst ? [...props.entries].reverse() : props.entries))

const timeFormat = computed(() => createTimeFormatter(locale.value, { seconds: true }))

/*
 * The gutter marker is what keeps a line's kind readable without relying on its
 * color, which Alabaster forbids as the only signal. It reuses Klipper's own
 * vocabulary — `>` for what was sent, `!` for a failure — so the transcript
 * reads the way the printer's log does.
 */
const kindMarkers: Record<ConsoleEntryKind, string> = {
  command: '>',
  error: '!',
  response: '',
  action: '',
  debug: '',
}

/**
 * Only the kinds that change what a line means are announced. A plain response
 * needs no label — it is the default — and prefixing every one of them would
 * make a long transcript unbearable to listen to.
 */
const kindLabels: Partial<Record<ConsoleEntryKind, string>> = {
  command: 'console.kind.command',
  error: 'console.kind.error',
}

function kindLabel(kind: ConsoleEntryKind): string | undefined {
  return kindLabels[kind]
}

/**
 * A pixel threshold rather than an exact comparison: sub-pixel scroll heights
 * mean a box scrolled fully to the bottom rarely reports a distance of exactly
 * zero, and an exact test would silently stop following.
 */
const followThresholdPx = 24

/**
 * How far this box still has to travel before it reaches the given edge, in the
 * one place both the follow test and the overscroll test read it from.
 *
 * The top edge is free: `scrollTop` **is** the distance, exactly, and a box
 * parked at the top reports a true zero.
 *
 * The bottom edge has to be derived. `scrollHeight` and `clientHeight` are
 * integers the browser rounds from a fractional layout, while `scrollTop` stays
 * fractional, so subtracting a fractional offset from two rounded totals mixes
 * the two domains: a box parked hard against its floor can report a leftover
 * fraction of a pixel instead of zero. Rounding `scrollTop` into the same
 * integer domain as the terms it is subtracted from makes the bottom edge as
 * exact as the top one, rather than widening a threshold until the noise
 * happens to fit under it.
 *
 * The transcript's own geometry is snapped to whole pixels in `main.css`, which
 * removes the fraction at its source for this card; this keeps the arithmetic
 * honest for any box whose height is not ours to round, such as the console
 * page's, where the height comes from the viewport.
 *
 * Only the downward paths ever went through this — the bottom-fed follow edge
 * and the bottom overscroll pin — while every upward one read `scrollTop`
 * directly. Both directions now come from here, so neither can drift without
 * the other.
 */
function distanceFromEdge(element: HTMLElement, edge: 'top' | 'bottom'): number {
  if (edge === 'top') return element.scrollTop
  return element.scrollHeight - element.clientHeight - Math.round(element.scrollTop)
}

/**
 * Following is a statement of the reader's intent, so **only the reader may end
 * it**. A `scroll` event alone does not say who moved the box: re-parenting the
 * element — which is what docking the card into the settings surface does —
 * resets `scrollTop` to zero and fires `scroll`, and so does the box getting its
 * height for the first time. Treating those as the reader scrolling away marked
 * them as having left the bottom, after which every catch-up politely refused to
 * move: the transcript stuck at the oldest line, and closing the surface did it
 * again.
 *
 * So position is only *consulted* while a real input gesture is in flight. Layout
 * can move the box as much as it likes; it will not be mistaken for a decision.
 */
const gestureGraceMs = 700
let gestureUntil = 0

function noteGesture(): void {
  gestureUntil = performance.now() + gestureGraceMs
}

function trackScroll(): void {
  const element = transcript.value
  if (!element || performance.now() > gestureUntil) return
  const distance = distanceFromEdge(element, props.newestFirst ? 'top' : 'bottom')
  isAtFollowEdge.value = distance <= followThresholdPx
}

/**
 * How far the pointer has to travel, while pinned at either end of the
 * transcript, before a further wheel tick is let through to the page behind
 * it. Below this the reader is still working through the last few lines and
 * a hand tremor on the wheel must not leak into a page scroll; at or above
 * it, they have visibly aimed the mouse elsewhere and are asking to keep
 * scrolling past the box rather than to read further into it. Kept small: this
 * is an escape hatch, not a gesture the reader has to aim.
 */
const edgeEscapeDistancePx = 6

/**
 * Same sub-pixel slack as `followThresholdPx` above, for the same reason: a
 * box scrolled fully to an edge rarely reports a distance of exactly zero.
 * Without it the pin flickers on and off across that rounding noise as a
 * gesture nears the edge, toggling `overscroll-behavior` mid-gesture and
 * reading as a stutter right when the reader expects the last bit of
 * scrolling to feel the same as the rest.
 *
 * It is slack against a *measured* edge, not a substitute for measuring it:
 * `distanceFromEdge` is what makes both edges report a true zero, and widening
 * this to paper over a distance that never reaches zero would arm the pin
 * early, several pixels short of the floor.
 */
const edgeSlackPx = 2

/** Which physical edge the transcript is currently overscrolling against, if any. */
const edgeReleased = ref(false)
let pinnedEdge: 'top' | 'bottom' | null = null
let escapeOrigin: { x: number; y: number } | null = null

function overscrollingEdge(element: HTMLElement, deltaY: number): 'top' | 'bottom' | null {
  if (deltaY < 0 && distanceFromEdge(element, 'top') <= edgeSlackPx) return 'top'
  if (deltaY > 0 && distanceFromEdge(element, 'bottom') <= edgeSlackPx) return 'bottom'
  return null
}

/*
 * A wheel tick that would overscroll pins the edge and records where the
 * pointer was when it arrived there. Containment (`overscroll-behavior: none`,
 * lifted to `auto` by `edgeReleased`) does the actual blocking; this only
 * decides when that block is allowed to lift. `none` rather than `contain`
 * because the two behave identically about chaining while `contain` keeps the
 * local overscroll affordance — an elastic bounce on Windows, animating a
 * gesture that has no effect. See the rule in `main.css` beside the property
 * itself. Scrolling back off the edge —
 * or hitting the *other* edge — clears the pin, so escaping once does not
 * leave the far end permanently open too.
 */
function handleWheel(event: WheelEvent): void {
  noteGesture()
  const element = transcript.value
  if (!element) return
  const edge = overscrollingEdge(element, event.deltaY)
  if (!edge) {
    pinnedEdge = null
    escapeOrigin = null
    edgeReleased.value = false
    return
  }
  if (pinnedEdge !== edge) {
    pinnedEdge = edge
    escapeOrigin = { x: event.clientX, y: event.clientY }
    edgeReleased.value = false
  }
}

function handlePointerMove(event: PointerEvent): void {
  if (!pinnedEdge || !escapeOrigin || edgeReleased.value) return
  const distance = Math.hypot(event.clientX - escapeOrigin.x, event.clientY - escapeOrigin.y)
  if (distance >= edgeEscapeDistancePx) edgeReleased.value = true
}

function scrollToNewest(): void {
  const element = transcript.value
  if (element) element.scrollTop = props.newestFirst ? 0 : element.scrollHeight
}

function reanchor(): void {
  if (!props.follow || !isAtFollowEdge.value) return
  scrollToNewest()
}

/*
 * Following the newest line is only helpful while the reader is already at that
 * edge; scrolling back to read an earlier failure must not be undone by the next
 * line of print chatter. The jump is instant rather than smooth, so it needs no
 * reduced-motion fallback and cannot lag behind a fast printer.
 */
watch(
  () => props.entries.length,
  async () => {
    await nextTick()
    reanchor()
  },
)

// Turning following back on, or flipping which end is newest, catches up once
// rather than waiting for a line that may not arrive for minutes on an idle
// printer.
watch(
  () => [props.follow, props.newestFirst],
  async ([enabled]) => {
    if (!enabled) return
    isAtFollowEdge.value = true
    await nextTick()
    scrollToNewest()
  },
)

/*
 * A freshly mounted transcript starts at the newest line: the entries are already
 * in the store, so no length change fires the watcher, and the reader is looking
 * for what the printer just said rather than what it said at boot.
 *
 * The resize observer covers the cases where the box gets its height *after* this
 * runs — the disclosure reveal growing from zero, the card expanding, a column
 * changing width — any of which would otherwise leave the mount-time scroll having
 * been applied to a box with no content in it yet.
 *
 * It does not cover being moved in the DOM, which emits nothing at all; that is
 * restored by `cardMove.ts`, once, for every module.
 */
let followObserver: ResizeObserver | null = null

onMounted(async () => {
  isAtFollowEdge.value = true
  await nextTick()
  reanchor()
  const element = transcript.value
  if (!element || typeof ResizeObserver === 'undefined') return
  followObserver = new ResizeObserver(reanchor)
  followObserver.observe(element)
})

onBeforeUnmount(() => {
  followObserver?.disconnect()
  followObserver = null
})

defineExpose({ scrollToNewest })
</script>

<template>
  <ol
    ref="transcript"
    class="gcode-console selectable"
    :class="{
      'gcode-console--compact': compact,
      'gcode-console--fill': lines === null,
      // Only a bottom-fed transcript anchors to its floor. Newest-first already
      // starts at the top, and an auto margin there would push the newest line
      // away from the prompt sitting right above it.
      'gcode-console--anchored': !newestFirst,
      'gcode-console--edge-released': edgeReleased,
      // The far edge fades — the one the prompt is not sitting against. A
      // bottom-fed transcript (the default) feeds new lines in at the bottom,
      // so history runs off the top; newest-first flips both the feed and the
      // fade to the bottom.
      'gcode-console--fade-top': !newestFirst,
      'gcode-console--fade-bottom': newestFirst,
    }"
    :style="lines === null ? undefined : { '--console-lines': lines }"
    role="log"
    tabindex="0"
    :aria-label="label ?? t('console.transcriptLabel')"
    @scroll="trackScroll"
    @wheel="handleWheel"
    @pointermove="handlePointerMove"
    @touchstart.passive="noteGesture"
    @pointerdown="noteGesture"
    @keydown="noteGesture"
  >
    <li v-if="entries.length === 0" class="gcode-console__empty">
      {{ t('console.empty') }}
    </li>
    <!--
      `v-memo`, because this is the largest keyed list in the application and
      it re-renders on every response line during a chatty print: an entry is
      created once and never mutated, so a row only needs rebuilding when the
      display settings or locale change — without the memo, appending line
      1,000 rebuilt the VNodes for the 999 lines that had not changed.
    -->
    <li
      v-for="entry in rendered"
      :key="entry.id"
      v-memo="[entry, showTimestamps, rawOutput, locale]"
      class="gcode-console__line"
      :data-kind="entry.kind"
    >
      <span v-if="showTimestamps" class="gcode-console__time">
        {{ timeFormat.format(entry.at) }}
      </span>
      <!--
        The marker is decorative, so the kind it stands for has to reach assistive
        technology some other way. Color and a glyph both fail there, and "do not
        communicate state by color alone" is as true for a screen reader as for a
        monitor — so the two kinds that change what a line *means* name themselves
        in text that is only read aloud.
      -->
      <span v-if="kindLabel(entry.kind)" class="sr-only">{{ t(kindLabel(entry.kind) ?? '') }}</span>
      <span class="gcode-console__marker" aria-hidden="true">{{ kindMarkers[entry.kind] }}</span>
      <!--
        A sent command refills the input when clicked, which is how a long macro
        invocation gets corrected and re-sent without retyping it. Only commands
        are interactive; a response is text to read.
      -->
      <button
        v-if="entry.kind === 'command'"
        type="button"
        class="text-action gcode-console__command"
        :title="t('console.reuseCommand')"
        @click="emit('command', entry.raw)"
      >
        {{ rawOutput ? entry.raw : entry.message }}
      </button>
      <span v-else class="gcode-console__message">
        {{ rawOutput ? entry.raw : entry.message }}
      </span>
    </li>
  </ol>
</template>
