<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'

/*
 * A documented multi-choice dialog per docs/design/dialog-system.md: three
 * outcomes that are not a single yes/no — start anyway, defer with a snooze,
 * or go fix it — so it is hand-built markup on the shared `<dialog>` shell
 * rather than a fourth prop shape bolted onto `ConfirmDialog`. "Not now" both
 * declines to start the print and answers the prompt, so it stands in for
 * this dialog's Cancel: the last, quietest action, matching the rule that
 * one must always be present even though none of the three is a bare no-op.
 */
const props = defineProps<{
  open: boolean
  overdueNames: readonly string[]
}>()

const emit = defineEmits<{ startAnyway: []; notNow: []; openMaintenance: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    const element = dialog.value
    if (!element) return
    if (isOpen && !element.open) element.showModal()
    if (!isOpen && element.open) element.close()
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog"
    aria-labelledby="maintenance-reminder-title"
    @cancel.prevent="emit('notNow')"
  >
    <h2 id="maintenance-reminder-title" class="text-dialog-title">
      {{ t('dashboard.maintenance.reminderTitle') }}
    </h2>
    <ul class="maintenance-reminder-list">
      <li v-for="name in overdueNames" :key="name">
        <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
        <span>{{ name }}</span>
      </li>
    </ul>
    <div class="maintenance-reminder-dialog__actions">
      <button
        type="button"
        class="button button--primary button--block"
        @click="emit('startAnyway')"
      >
        {{ t('dashboard.maintenance.reminderStartAnyway') }}
      </button>
      <button type="button" class="button button--block" @click="emit('openMaintenance')">
        {{ t('dashboard.maintenance.reminderOpen') }}
      </button>
      <button type="button" class="button button--quiet button--block" @click="emit('notNow')">
        {{ t('dashboard.maintenance.reminderNotNow') }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
/*
 * A stacked multi-choice actions grid, the same shape
 * `update-recovery-dialog__actions` is — duplicated rather than shared,
 * because the two dialogs merely look alike, they are not one set that must
 * change together.
 */
.maintenance-reminder-dialog__actions {
  display: grid;
  gap: 0.5rem;
  margin-block-start: 1.25rem;
}

.maintenance-reminder-list {
  display: grid;
  gap: 0.4rem;
  margin-block-start: 0.85rem;
}

.maintenance-reminder-list > li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--status-caution-text);
  font-size: var(--text-small-size);
}
</style>
