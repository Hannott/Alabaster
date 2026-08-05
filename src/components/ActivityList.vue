<!--
  The recent-activity feed rendered by both the header notifications menu
  (src/App.vue) and the Activity dashboard module
  (src/components/dashboard/modules/ActivityModule.vue).

  Both surfaces show the same `printer.activities` feed and must always behave
  alike: the kind-to-icon mapping, the localized time formatting, the six-entry
  window, and the row markup drifting apart between them would be a bug, not a
  design choice. That is the bar for sharing rather than duplicating, so the
  logic lives here once. Only the surrounding chrome — empty-state styling and
  list spacing — legitimately differs per surface, and `variant` selects it.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import { createTimeFormatter } from '@/i18n/formats'
import { usePrinterStore, type PrinterActivity } from '@/stores/printer'

defineProps<{
  /**
   * The surface hosting the list: the Activity dashboard card or the header
   * notifications menu. Chooses only the chrome each surface already had —
   * the rows themselves never differ.
   */
  variant: 'card' | 'menu'
}>()

const { locale, t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const dateFormatter = computed(() => createTimeFormatter(locale.value))

function icon(activity: PrinterActivity): 'print' | 'send' | 'activity' {
  if (activity.kind === 'print') return 'print'
  if (activity.kind === 'command') return 'send'
  return 'activity'
}
</script>

<template>
  <p
    v-if="printer.activities.length === 0"
    :class="variant === 'menu' ? 'header-menu__empty' : 'py-8 text-center text-sm text-muted'"
  >
    {{ t('dashboard.activity.empty') }}
  </p>
  <component
    :is="variant === 'menu' ? 'ul' : 'ol'"
    v-else
    class="grid"
    :class="variant === 'menu' ? 'gap-0.5' : 'gap-1'"
  >
    <li v-for="activity in printer.activities.slice(0, 6)" :key="activity.id" class="activity-row">
      <span class="activity-row__icon" aria-hidden="true">
        <AppIcon :name="icon(activity)" class="size-4" />
      </span>
      <span class="min-w-0 flex-1">
        <strong class="block truncate text-xs">{{ t(activity.titleKey) }}</strong>
        <span v-if="activity.detail" class="mt-0.5 block truncate text-[0.68rem] text-muted">{{
          activity.detail
        }}</span>
      </span>
      <time
        class="font-mono text-[0.68rem] text-muted"
        :datetime="new Date(activity.createdAt).toISOString()"
      >
        {{ dateFormatter.format(activity.createdAt) }}
      </time>
    </li>
  </component>
</template>
