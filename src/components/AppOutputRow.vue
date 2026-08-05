<script setup lang="ts">
/**
 * The one output row: an icon, a label, and a trailing reading or switch —
 * Controls' monitored fans and digital output pins, following `AppField` and
 * `AppSlider`'s own precedent of one component whose props describe its
 * anatomy rather than hand-rolled markup per module.
 *
 * Two rows, not one: a reading (`<output>` + optional unit) when `toggle` is
 * false, the shared `.switch` when it is true. `size` selects a shorter tier
 * than `AppField`/`AppSlider` use — 40/44/48px rather than 44/48/52px — since
 * a plain icon-and-text row needs less clearance than a bordered field box.
 * `.pin-row`'s own shared height floor moves with this component's `sm`
 * tier rather than disagreeing with it; see the CSS comment.
 *
 * The label renders Title Case via `text-transform: capitalize`, the same
 * technique `AppField`/`AppSlider` use, for the same reason: a label can be a
 * fan or pin name read straight from the printer's own config, not always an
 * `en.json` string Alabaster controls the casing of.
 *
 * `spinDurationSeconds` opts an icon into the shared `.fan-icon` rotation
 * (see `main.css`'s `@keyframes fan-spin`) without hard-coding which icon
 * name gets to spin — the caller decides by passing a duration at all.
 * `spinning` toggles `animation-play-state` rather than adding or removing
 * the animation itself, so a fan that speeds up or slows down keeps its
 * running animation and only its duration changes; restarting it on every
 * telemetry update would snap the blades back to their first frame each time.
 */
import { computed } from 'vue'

import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'

const props = withDefaults(
  defineProps<{
    /** The row's own name, already translated or read from the printer's config. */
    label: string
    /** The switch's accessible name, when a plainer sentence reads better than the visible label alone. Toggle rows only; defaults to `label`. */
    ariaLabel?: string
    /**
     * Leading icon, for either row kind — a toggle row (a digital output
     * pin) wants one exactly as much as a reading does, once the icon is a
     * user's own choice of what that pin actually switches rather than a
     * hardcoded `'fan'` only a monitored-fan reading ever passed. Optional
     * on both: an unconfigured row still renders with none.
     */
    icon?: AppIconName | undefined
    size?: 'md' | 'sm' | 'xs'
    /** Renders the shared `.switch` in place of the reading. */
    toggle?: boolean
    /** Already-formatted — the caller decides "62" vs the unavailable text. */
    value?: string | number
    /** A sibling of the value, never a character inside it. */
    unit?: string | undefined
    /** Enables the icon's rotation; the duration this row's own rate maps to. */
    spinDurationSeconds?: number
    /** Whether the (already-running) rotation is currently visible. */
    spinning?: boolean
    /** Disables the switch only — see the CSS comment for why the row itself never dims. */
    disabled?: boolean
  }>(),
  {
    size: 'sm',
    toggle: false,
    spinning: false,
    disabled: false,
  },
)

const model = defineModel<boolean>({ default: false })

const spinEnabled = computed(() => props.spinDurationSeconds !== undefined)

function onToggle(event: Event): void {
  model.value = (event.target as HTMLInputElement).checked
}
</script>

<template>
  <div class="app-output-row" :class="`app-output-row--size-${size}`">
    <!--
      `bulb` is the one icon with an on/off shape of its own (`AppIcon`'s
      `bulb`/`bulbOn` pair) — every other `outputIconTokens` entry renders
      unconditionally regardless of the switch, same as before.
    -->
    <AppIcon
      v-if="icon"
      :name="icon === 'bulb' && toggle && model ? 'bulbOn' : icon"
      class="app-output-row__icon"
      :class="{ 'fan-icon': spinEnabled, 'fan-icon--spinning': spinEnabled && spinning }"
      :style="spinEnabled ? { animationDuration: `${spinDurationSeconds}s` } : undefined"
      aria-hidden="true"
    />
    <span class="app-output-row__label">{{ label }}</span>
    <output v-if="!toggle" class="app-output-row__value"
      >{{ value }}<span v-if="unit" class="app-output-row__unit">{{ unit }}</span></output
    >
    <input
      v-else
      type="checkbox"
      role="switch"
      class="switch app-output-row__switch"
      :checked="model"
      :disabled="disabled"
      :aria-label="ariaLabel ?? label"
      @change="onToggle"
    />
  </div>
</template>
