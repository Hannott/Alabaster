<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import { readControlsCardSetting } from '@/components/dashboard/modules/controlsCardSettings'
import { useDashboardModule } from '@/dashboard/context'
import { controlsDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'

/**
 * Which blocks the Controls card draws at all, rendered once and shared
 * verbatim between the full settings pane and the card's own quick layer — see
 * `docs/design/settings-surface.md`. `mode` decides which rows show and whether
 * they carry a quick-settings toggle; it never changes what a row does.
 *
 * Both rows hide a whole section, and both sections are ones a printer may have
 * plenty of and their owner may never touch: pins that switch a light nobody
 * drives from here, and fans Klipper runs by itself and only reports.
 *
 * The motion limits beside these in the pane carry no pin. They are a form with
 * four fields and a submit, which is not a row the card's quick layer can hold
 * without becoming the modal the two-layer split exists to avoid.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('controls')
const quick = useQuickSettings(config, updateConfig, controlsDefaultQuickKeys, () => props.mode)

// Keys and defaults live in `controlsCardSettings.ts`, shared with the card so
// a row's checkbox can never disagree with the section it controls.
const showOutputPins = computed(() => readControlsCardSetting(config.value, 'showOutputPins'))
const showMonitoredFans = computed(() => readControlsCardSetting(config.value, 'showMonitoredFans'))
</script>

<template>
  <div v-if="quick.visible('showOutputPins')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showOutputPins"
        @change="updateConfig({ showOutputPins: !showOutputPins })"
      />
      <span>{{ t('dashboard.controls.showOutputPins') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.controls.showOutputPins')"
      :shown="quick.isQuick('showOutputPins')"
      @toggle="quick.setQuick('showOutputPins', $event)"
    />
  </div>

  <div v-if="quick.visible('showMonitoredFans')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showMonitoredFans"
        @change="updateConfig({ showMonitoredFans: !showMonitoredFans })"
      />
      <span>{{ t('dashboard.controls.showMonitoredFans') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.controls.showMonitoredFans')"
      :shown="quick.isQuick('showMonitoredFans')"
      @toggle="quick.setQuick('showMonitoredFans', $event)"
    />
  </div>
</template>
