<script setup lang="ts">
/**
 * One named group of settings in a module's pane — see
 * `docs/design/settings-surface.md`.
 *
 * Every pane had written this shape by hand, and the part they got wrong was
 * never the heading: it was the rule. `--divided` separates a section from the
 * one above it, so exactly the section that happens to render *first* must not
 * carry one — and "first" is a runtime question wherever a section is
 * conditional. Print's Speed and flow section disappears with the controls it
 * configures, Console's Filters section disappears on a printer without
 * timelapse, and both left the section behind them drawing a rule against the
 * top of the pane. Passing `divided` as a value the pane computes is what makes
 * that answerable; hard-coding the class in the markup is what made it wrong.
 *
 * `bare` drops the section entirely and renders only its rows. It is for the
 * card's own quick layer, where a fields component shared with the pane renders
 * the handful of rows the user promoted: a heading over them would name a
 * section of one, and the wrapper would break the seam `.check-row` puts
 * between siblings.
 */
defineProps<{
  title?: string
  /** A caption for the whole group. Held to the same rule as any other hint. */
  hint?: string
  divided?: boolean
  bare?: boolean
}>()
</script>

<template>
  <slot v-if="bare" />
  <div v-else class="surface-section" :class="{ 'surface-section--divided': divided }">
    <p v-if="title" class="surface-section__title">{{ title }}</p>
    <p v-if="hint" class="surface-section__hint">{{ hint }}</p>
    <slot />
  </div>
</template>
