<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppSlider from '@/components/AppSlider.vue'
import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import { configBoolean, configNumber, useDashboardModule } from '@/dashboard/context'
import { bedMeshDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'

/**
 * What the height map's colors are measured against — see
 * `BedMeshViewSettingsFields` for the `mode` contract these two share.
 *
 * The two rows are one decision taken in two steps, which is why they sit
 * together and in this order: scaling to the mesh reads every bed against
 * itself, and the fixed limit below is the span used when it does not. Before
 * this they were in different halves of the interface — the switch on the card,
 * the limit it overrides in the pane — and neither said anything about the
 * other.
 *
 * The limit takes no pin: it is a slider with its own header and reset button,
 * two rows tall, and it does nothing at all while the switch above it is on.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('bedMesh')
const quick = useQuickSettings(config, updateConfig, bedMeshDefaultQuickKeys, () => props.mode)

/** The literal default the reset button restores, and the slider's own span. */
const fixedLimitDefault = 0.1
const fixedLimitSliderMax = 0.5

const scaleToMesh = computed(() => configBoolean(config.value, 'scaleToMesh', false))
const fixedLimit = computed(() => configNumber(config.value, 'fixedLimit', fixedLimitDefault))
</script>

<template>
  <div v-if="quick.visible('scaleToMesh')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="scaleToMesh"
        @change="updateConfig({ scaleToMesh: !scaleToMesh })"
      />
      <span>{{ t('dashboard.bedMesh.scaleToMesh') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.bedMesh.scaleToMesh')"
      :shown="quick.isQuick('scaleToMesh')"
      @toggle="quick.setQuick('scaleToMesh', $event)"
    />
  </div>

  <template v-if="mode === 'pane'">
    <AppSlider
      :label="t('dashboard.bedMesh.fixedLimit')"
      :model-value="fixedLimit"
      :min="0.01"
      :max="2"
      :step="0.01"
      :track-max="fixedLimitSliderMax"
      entry
      can-reset
      :reset-value="fixedLimitDefault"
      commit-on-drag
      @commit="(value) => updateConfig({ fixedLimit: value })"
    />
  </template>
</template>
