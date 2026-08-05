<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import { readPrintCardSetting } from '@/components/dashboard/modules/printCardSettings'
import { useDashboardModule } from '@/dashboard/context'
import { printDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'

/**
 * Which blocks the Print card draws at all, rendered once and shared verbatim
 * between the full settings pane and the card's own quick layer — see
 * `docs/design/settings-surface.md`. `mode` decides which rows show and whether
 * they carry a quick-settings toggle; it never changes what a row does.
 *
 * `pane` shows every row, always, in this fixed order — promoting a setting
 * never moves it. `quick` shows only the rows the pane has flagged, and never
 * renders the toggle itself: demoting a setting is a decision made from the
 * pane, not from the dashboard.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('print')
const quick = useQuickSettings(config, updateConfig, printDefaultQuickKeys, () => props.mode)

// Keys and defaults live in `printCardSettings.ts`, shared with the card so a
// row's checkbox can never disagree with the block it controls.
const showThumbnail = computed(() => readPrintCardSetting(config.value, 'showThumbnail'))
const showFilament = computed(() => readPrintCardSetting(config.value, 'showFilament'))
const showDrift = computed(() => readPrintCardSetting(config.value, 'showDrift'))
</script>

<template>
  <div v-if="quick.visible('showThumbnail')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showThumbnail"
        @change="updateConfig({ showThumbnail: !showThumbnail })"
      />
      <span>{{ t('dashboard.print.showThumbnail') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.print.showThumbnail')"
      :shown="quick.isQuick('showThumbnail')"
      @toggle="quick.setQuick('showThumbnail', $event)"
    />
  </div>

  <div v-if="quick.visible('showFilament')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showFilament"
        @change="updateConfig({ showFilament: !showFilament })"
      />
      <span>{{ t('dashboard.print.showFilament') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.print.showFilament')"
      :shown="quick.isQuick('showFilament')"
      @toggle="quick.setQuick('showFilament', $event)"
    />
  </div>

  <div v-if="quick.visible('showDrift')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showDrift"
        @change="updateConfig({ showDrift: !showDrift })"
      />
      <span>{{ t('dashboard.print.showDrift') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.print.showDrift')"
      :shown="quick.isQuick('showDrift')"
      @toggle="quick.setQuick('showDrift', $event)"
    />
  </div>
</template>
