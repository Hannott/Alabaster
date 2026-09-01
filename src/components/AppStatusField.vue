<script setup lang="ts">
/**
 * The one plain-content status pill: a source's "Up to date", a service's
 * "Active", any short state a reader compares against a control beside it
 * rather than clicks. `AppField`'s own box already joins the button system's
 * three-tier height and radius scale so a field and a button never need
 * nudging apart; this component makes the same join for a pill, since a `md`
 * `AppStatusField` next to a `md` button previously read as visibly shorter
 * than it, with a slightly rounder corner.
 *
 * `tone` is a closed set of semantic roles, not a color: AGENTS.md forbids a
 * color literal in a component, and a free-form color prop would be exactly
 * that with an extra step. Each tone maps to one of the semantic status
 * tokens `src/themes/tailwind.css` already exposes, so a new theme pack
 * recolors every `AppStatusField` in the product by changing those tokens
 * once rather than hunting down per-feature pill CSS. `neutral` is the
 * resting state every pill starts from and carries no border-color rule of
 * its own beyond the shared box. Per AGENTS.md's rule against communicating
 * state by color alone, `tone` is never the only thing that changes: the
 * `text` prop is what actually says what state this is, and every call site
 * must pass a label that says so on its own.
 */
export type AppStatusFieldTone =
  'neutral' | 'positive' | 'accent' | 'caution' | 'danger' | 'offline'
export type AppStatusFieldSize = 'md' | 'sm' | 'xs'

withDefaults(
  defineProps<{
    text: string
    tone?: AppStatusFieldTone
    size?: AppStatusFieldSize
  }>(),
  { tone: 'neutral', size: 'md' },
)
</script>

<template>
  <span
    class="status-field"
    :class="size === 'md' ? undefined : `status-field--${size}`"
    :data-tone="tone"
  >
    {{ text }}
  </span>
</template>
