<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import type { ActionGuardResult } from '@/composables/useActionGuard'

/**
 * An earlier run's ⋯ menu, holding Forget. A Forget button on every row
 * repeated the same word down the history, wider than the date beside it,
 * and put a terminal action one stray click from the row it sat on; the menu
 * is the shape every other list's per-row actions take.
 */
defineProps<{
  /** The run's time as the row shows it, which names the menu. */
  when: string
  guard: ActionGuardResult
  disabled?: boolean | undefined
}>()

const emit = defineEmits<{ forget: [] }>()

const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <HeaderMenu
    :label="t('calibration.bench.runActions', { when })"
    align="end"
    trigger-size="xs"
    trigger-icon-only
    trigger-class="calibration-history__menu"
  >
    <template #trigger>
      <AppIcon name="more" class="size-4" aria-hidden="true" />
    </template>
    <template #default="{ close }">
      <AppButton
        size="sm"
        start
        block
        icon="trash"
        class="calibration-history__forget"
        :guard="guard"
        :label="t('calibration.bench.forget')"
        :disabled="disabled"
        @click="
          () => {
            emit('forget')
            close()
          }
        "
      />
    </template>
  </HeaderMenu>
</template>
