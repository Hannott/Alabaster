<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import type { AppIconName } from '@/components/AppIcon.vue'

/**
 * The one action a route may put beside its title. Every field here maps
 * straight onto the rendered `<button>`; a route reaching for anything the
 * shape does not cover (a second action, a non-`on-soft` variant) is reaching
 * for something the page-heading contract does not allow, not something this
 * component forgot — see `interface-standards.md`'s page heading contract.
 */
export interface PageHeadingAction {
  label: string
  icon: AppIconName
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
  pending?: boolean
}

defineProps<{
  title: string
  action?: PageHeadingAction
}>()
</script>

<template>
  <header class="page-heading">
    <h1 class="page-heading__title">{{ title }}</h1>
    <button
      v-if="action"
      type="button"
      class="button button--on-soft"
      :aria-pressed="action.pressed"
      :disabled="action.disabled"
      :data-pending="action.pending ? 'true' : undefined"
      @click="action.onClick"
    >
      <AppIcon :name="action.icon" class="size-5" aria-hidden="true" />
      {{ action.label }}
    </button>
  </header>
</template>
