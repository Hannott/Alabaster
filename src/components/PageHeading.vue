<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import { usePageHeaders } from '@/composables/usePageHeaders'

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

const { mode: pageHeaderVisibility } = usePageHeaders()
</script>

<template>
  <header
    class="page-heading"
    :class="{ 'page-heading--collapsed': pageHeaderVisibility === 'hide' }"
  >
    <h1 class="page-heading__title">{{ title }}</h1>
    <AppButton
      v-if="action && pageHeaderVisibility === 'show'"
      on-soft
      :icon="action.icon"
      :label="action.label"
      :aria-pressed="action.pressed"
      :disabled="action.disabled"
      :pending="action.pending"
      @click="action.onClick"
    />
  </header>
  <!--
    Every place the inline action would otherwise be, once "Page headers" is
    set to hide: see interface-standards.md's "Page heading contract" for why
    this reuses `HeaderMenu` — a floating action button whose one job is
    revealing the route's own action rather than being a second, bespoke
    control. `placement="above"`/`align="end"` are the mobile overflow
    navigation's own recipe for a trigger pinned to a screen corner, applied
    here to a corner of its own via `.page-heading-fab` rather than to the nav
    bar's row.
  -->
  <HeaderMenu
    v-if="action && pageHeaderVisibility === 'hide'"
    class="page-heading-fab"
    :label="action.label"
    align="end"
    placement="above"
    trigger-variant="primary"
    trigger-size="md"
    trigger-icon-only
  >
    <template #trigger="{ open }">
      <AppIcon
        :name="open ? 'minusCircleOutlined' : 'plusCircleOutlined'"
        class="size-6 page-heading-fab__icon"
        :class="{ 'page-heading-fab__icon--open': open }"
        aria-hidden="true"
      />
    </template>
    <template #default="{ close }">
      <AppButton
        size="sm"
        start
        block
        :icon="action?.icon"
        :label="action?.label"
        :aria-pressed="action?.pressed"
        :disabled="action?.disabled"
        :pending="action?.pending"
        @click="
          () => {
            action?.onClick()
            close()
          }
        "
      />
    </template>
  </HeaderMenu>
</template>
