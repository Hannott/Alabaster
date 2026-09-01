<script setup lang="ts">
/**
 * The one percent-of-completion bar. `.toast__progress` (`main.css`) is a
 * different shape on purpose: a CSS-animation-driven dismiss countdown with
 * no percentage to report, not a value display, so it stays its own thing
 * rather than pretending to share this component.
 *
 * `value` is a plain 0-100 number rather than a 0-1 fraction so a caller
 * never has to remember which convention this component picked — it forwards
 * straight into both the fill's `width` and the rounded `aria-valuenow`.
 */
defineProps<{
  /** 0-100. Not clamped: a caller passing a fraction outside that range has a bug worth seeing rather than one this component quietly hides. */
  value: number
  /** The accessible name — already localized, since a component may never own the string itself. */
  label: string
}>()
</script>

<template>
  <div
    class="app-progress-bar"
    role="progressbar"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(value)"
  >
    <span class="app-progress-bar__fill" :style="{ width: `${value}%` }" />
  </div>
</template>
