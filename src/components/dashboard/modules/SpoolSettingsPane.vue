<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import SpoolCardSettingsFields from '@/components/dashboard/modules/SpoolCardSettingsFields.vue'

/**
 * Spool's full configuration — currently just the one automation setting,
 * shared with the card's quick layer via `SpoolCardSettingsFields`.
 */
const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <SurfaceSection
    :title="t('dashboard.spool.automationTitle')"
    :hint="t('dashboard.spool.autoPauseHint')"
  >
    <SpoolCardSettingsFields mode="pane" />
  </SurfaceSection>
</template>
