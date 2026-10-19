import { readonly, ref } from 'vue'

/**
 * How `AppTooltipHost` behaves for this reader: whether the reveal is drawn
 * as four stages or only fades in, how long the stages take, and how long a
 * control has to be hovered before one shows. In the settings bundle, like
 * text weight, because the answer is the same on every screen someone owns.
 */
export interface TooltipPreferences {
  animate: boolean
  durationMs: number
  delayMs: number
}

export const defaultTooltipPreferences: TooltipPreferences = {
  animate: true,
  durationMs: 280,
  delayMs: 300,
}

export const tooltipDurationRange = { min: 60, max: 5000 } as const
export const tooltipDelayRange = { min: 0, max: 2000 } as const

const storageKey = 'alabaster.tooltips'

function clamp(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(range.max, Math.max(range.min, Math.round(value)))
}

function normalize(input: unknown): TooltipPreferences {
  const record =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  return {
    animate:
      typeof record.animate === 'boolean' ? record.animate : defaultTooltipPreferences.animate,
    durationMs: clamp(
      record.durationMs,
      tooltipDurationRange,
      defaultTooltipPreferences.durationMs,
    ),
    delayMs: clamp(record.delayMs, tooltipDelayRange, defaultTooltipPreferences.delayMs),
  }
}

function load(): TooltipPreferences {
  try {
    const raw = localStorage.getItem(storageKey)
    return normalize(raw === null ? null : JSON.parse(raw))
  } catch {
    return { ...defaultTooltipPreferences }
  }
}

const preferences = ref<TooltipPreferences>(load())

function commit(next: TooltipPreferences): void {
  preferences.value = next
  try {
    localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    // Storage can be unavailable (private windows); the choice still holds until reload.
  }
}

function setAnimate(animate: boolean): void {
  commit({ ...preferences.value, animate })
}

function setDurationMs(value: unknown): void {
  commit({
    ...preferences.value,
    durationMs: clamp(value, tooltipDurationRange, preferences.value.durationMs),
  })
}

function setDelayMs(value: unknown): void {
  commit({
    ...preferences.value,
    delayMs: clamp(value, tooltipDelayRange, preferences.value.delayMs),
  })
}

function replace(input: unknown): void {
  commit(normalize(input))
}

function reset(): void {
  commit({ ...defaultTooltipPreferences })
}

export function useTooltipPreferences() {
  return {
    preferences: readonly(preferences),
    setAnimate,
    setDurationMs,
    setDelayMs,
    replace,
    reset,
  }
}
