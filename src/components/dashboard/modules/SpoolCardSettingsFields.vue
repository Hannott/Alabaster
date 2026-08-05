<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import { configBoolean, useDashboardModule } from '@/dashboard/context'
import { spoolDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'

/**
 * Spool's one setting, rendered once and shared verbatim between the full
 * settings pane and the card's own quick layer — see
 * `docs/design/settings-surface.md`. `mode` decides whether the row shows at
 * all (the pane always does; the quick layer only once promoted) and whether
 * it carries the pin; it never changes what the row does.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('spool')
const quick = useQuickSettings(config, updateConfig, spoolDefaultQuickKeys, () => props.mode)

const autoPauseOnEmpty = computed(() => configBoolean(config.value, 'autoPauseOnEmpty', false))
</script>

<template>
  <div v-if="quick.visible('autoPauseOnEmpty')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="autoPauseOnEmpty"
        @change="updateConfig({ autoPauseOnEmpty: !autoPauseOnEmpty })"
      />
      <span>{{ t('dashboard.spool.autoPauseOnEmpty') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.spool.autoPauseOnEmpty')"
      :shown="quick.isQuick('autoPauseOnEmpty')"
      @toggle="quick.setQuick('autoPauseOnEmpty', $event)"
    />
  </div>
</template>
