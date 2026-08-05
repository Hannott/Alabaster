<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'

/**
 * Marks one setting as reachable from the card's own gear-opened quick layer,
 * without moving it out of its logical group in the full settings pane — see
 * `docs/design/settings-surface.md`. The setting stays exactly where it is;
 * this only decides whether the same bound control also renders there.
 *
 * `label` is the setting's own already-localized name, so the aria-label and
 * title can name it without this component owning a second translation of it.
 */
defineProps<{
  shown: boolean
  label: string
}>()

const emit = defineEmits<{ toggle: [shown: boolean] }>()

const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <button
    type="button"
    class="button button--quiet button--xs button--icon"
    :aria-pressed="shown"
    :aria-label="
      shown
        ? t('dashboard.surface.quickToggleRemove', { setting: label })
        : t('dashboard.surface.quickToggleAdd', { setting: label })
    "
    :title="
      shown
        ? t('dashboard.surface.quickToggleRemove', { setting: label })
        : t('dashboard.surface.quickToggleAdd', { setting: label })
    "
    @click="emit('toggle', !shown)"
  >
    <AppIcon name="pin" class="size-4" aria-hidden="true" />
  </button>
</template>
