<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useTooltipPreferences } from '@/composables/useTooltipPreferences'
import { claimTooltipText, releaseTooltipText, tooltipOwner } from '@/features/tooltip/owner'
import { placeTooltip } from '@/features/tooltip/placement'

/**
 * The one tooltip. Mounted once in `App.vue`; every `title` in the product is
 * its text, picked up by one document-level listener for the reason
 * `useContextMenuGuard` is one listener: a per-component opt-in only ever
 * covers the components somebody remembered. The browser's own tooltip is
 * unreliable — it waits on a timer the page cannot see, and it never shows at
 * all for a control that was just clicked — so the title is taken off the
 * element while it is hovered (see `features/tooltip/owner.ts`).
 *
 * It is a popover, which puts it in the top layer: a tooltip over a button in a
 * modal `dialog` would otherwise sit behind the dialog's backdrop whatever its
 * z-index. The reveal itself is CSS (`app-tooltip.css`); this only measures the
 * finished box, because its stages animate towards a size.
 */
const { preferences } = useTooltipPreferences()

interface ShownTooltip {
  key: number
  text: string
  side: 'above' | 'below'
  x: number
  y: number
  width: number
  height: number
  shift: number
  mode: 'staged' | 'fade'
  leaving: boolean
}

const LEAVE_MS = 80
const MEASURE_SLACK_PX = 2

const tooltip = ref<ShownTooltip | null>(null)
const element = ref<HTMLElement | null>(null)
const id = 'app-tooltip'

let key = 0
let owner: HTMLElement | null = null
let describedByBefore: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let leaveTimer: ReturnType<typeof setTimeout> | null = null
let pointer = { x: 0, y: 0 }
let dismissed = false

function measure(text: string): { width: number; height: number } {
  const probe = document.createElement('div')
  probe.className = 'app-tooltip__text app-tooltip__text--probe'
  probe.textContent = text
  document.body.append(probe)
  const rect = probe.getBoundingClientRect()
  probe.remove()
  return {
    width: Math.ceil(rect.width) + MEASURE_SLACK_PX,
    height: Math.ceil(rect.height) + MEASURE_SLACK_PX,
  }
}

function clearTimers(): void {
  if (timer !== null) clearTimeout(timer)
  if (leaveTimer !== null) clearTimeout(leaveTimer)
  timer = null
  leaveTimer = null
}

function show(text: string, x: number, y: number): void {
  if (leaveTimer !== null) clearTimeout(leaveTimer)
  leaveTimer = null
  const box = measure(text)
  const placement = placeTooltip({ x, y }, box, window.innerWidth)
  key += 1
  tooltip.value = {
    key,
    text,
    side: placement.side,
    x: placement.anchorX,
    y: placement.anchorY,
    width: box.width,
    height: box.height,
    shift: placement.shift,
    mode: preferences.value.animate ? 'staged' : 'fade',
    leaving: false,
  }
}

function hide(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  const current = tooltip.value
  if (!current || current.leaving) return
  current.leaving = true
  leaveTimer = setTimeout(() => {
    if (tooltip.value === current) tooltip.value = null
  }, LEAVE_MS)
}

function claim(next: HTMLElement): string {
  owner = next
  describedByBefore = next.getAttribute('aria-describedby')
  next.setAttribute('aria-describedby', id)
  return claimTooltipText(next)
}

function release(): void {
  hide()
  if (owner) {
    releaseTooltipText(owner)
    if (describedByBefore === null) owner.removeAttribute('aria-describedby')
    else owner.setAttribute('aria-describedby', describedByBefore)
  }
  owner = null
  describedByBefore = null
  dismissed = false
}

function onPointerOver(event: PointerEvent): void {
  if (event.pointerType === 'touch') return
  const next = tooltipOwner(event.target)
  if (next === owner) return
  release()
  if (!next) return
  const text = claim(next)
  pointer = { x: event.clientX, y: event.clientY }
  timer = setTimeout(() => {
    timer = null
    if (!owner?.isConnected || dismissed) return
    show(text, pointer.x, pointer.y)
  }, preferences.value.delayMs)
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerType === 'touch') return
  pointer = { x: event.clientX, y: event.clientY }
  if (owner && !owner.isConnected) release()
}

function dismiss(): void {
  dismissed = true
  hide()
}

function onFocusIn(event: FocusEvent): void {
  const next = tooltipOwner(event.target)
  if (!next || !next.matches(':focus-visible')) return
  release()
  const text = claim(next)
  const rect = next.getBoundingClientRect()
  show(text, rect.left + rect.width / 2, rect.top)
}

function onFocusOut(event: FocusEvent): void {
  if (owner && event.target === owner) release()
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') dismiss()
}

function onVisibility(): void {
  if (document.visibilityState === 'hidden') release()
}

watch(tooltip, async (next) => {
  if (!next) return
  await nextTick()
  if (element.value?.isConnected) element.value.showPopover?.()
})

onMounted(() => {
  document.addEventListener('pointerover', onPointerOver)
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerdown', dismiss, true)
  document.addEventListener('wheel', dismiss, { capture: true, passive: true })
  document.addEventListener('scroll', dismiss, true)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('blur', dismiss)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerover', onPointerOver)
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerdown', dismiss, true)
  document.removeEventListener('wheel', dismiss, true)
  document.removeEventListener('scroll', dismiss, true)
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('focusout', onFocusOut)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('blur', dismiss)
  clearTimers()
  release()
})
</script>

<template>
  <div
    v-if="tooltip"
    :id="id"
    :key="tooltip.key"
    ref="element"
    class="app-tooltip"
    popover="manual"
    role="tooltip"
    :data-side="tooltip.side"
    :data-mode="tooltip.mode"
    :data-leaving="tooltip.leaving"
    :style="{
      left: `${tooltip.x}px`,
      top: `${tooltip.y}px`,
      '--tip-w': `${tooltip.width}px`,
      '--tip-h': `${tooltip.height}px`,
      '--tip-shift': `${tooltip.shift}px`,
      '--tip-t': `${preferences.durationMs}ms`,
    }"
  >
    <div class="app-tooltip__shape">
      <div class="app-tooltip__text">{{ tooltip.text }}</div>
    </div>
  </div>
</template>
