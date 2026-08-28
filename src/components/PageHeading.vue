<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
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
    <AppButton
      v-if="action"
      on-soft
      :icon="action.icon"
      :label="action.label"
      :aria-pressed="action.pressed"
      :disabled="action.disabled"
      :pending="action.pending"
      @click="action.onClick"
    />
  </header>
</template>
