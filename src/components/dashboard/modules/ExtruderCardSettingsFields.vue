<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import { readExtruderCardSetting } from '@/components/dashboard/modules/extruderCardSettings'
import { useDashboardModule } from '@/dashboard/context'
import { extruderDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'

/**
 * Which blocks the Extruder card draws at all, rendered once and shared
 * verbatim between the full settings pane and the card's own quick layer — see
 * `docs/design/settings-surface.md`. `mode` decides which rows show and whether
 * they carry a quick-settings toggle; it never changes what a row does.
 *
 * Extrude and retract are the module's job and are never optional; these two
 * sections are not. Load macros belong to a printer that has them and an owner
 * who uses them, pressure advance is a tuning control that earns its space
 * during a tuning session and loses it afterwards — which is why it defaults
 * off — and the extrusion factor is a row someone who never strays from 100%
 * would rather give back to the manual extrusion block beneath it. Each
 * switch's key and default live in `extruderCardSettings.ts`, read here and
 * by `ExtruderModule.vue` from the same place, so a row's checkbox can never
 * disagree with the card it controls.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('extruder')
const quick = useQuickSettings(config, updateConfig, extruderDefaultQuickKeys, () => props.mode)

const showManualExtrusion = computed(() =>
  readExtruderCardSetting(config.value, 'showManualExtrusion'),
)
const showLoadMacros = computed(() => readExtruderCardSetting(config.value, 'showLoadMacros'))
const showPressureAdvance = computed(() =>
  readExtruderCardSetting(config.value, 'showPressureAdvance'),
)
const showRetraction = computed(() => readExtruderCardSetting(config.value, 'showRetraction'))
const showExtrusionFactor = computed(() =>
  readExtruderCardSetting(config.value, 'showExtrusionFactor'),
)
</script>

<template>
  <div v-if="quick.visible('showExtrusionFactor')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showExtrusionFactor"
        @change="updateConfig({ showExtrusionFactor: !showExtrusionFactor })"
      />
      <span>{{ t('dashboard.extruder.showExtrusionFactor') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.extruder.showExtrusionFactor')"
      :shown="quick.isQuick('showExtrusionFactor')"
      @toggle="quick.setQuick('showExtrusionFactor', $event)"
    />
  </div>

  <div v-if="quick.visible('showManualExtrusion')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showManualExtrusion"
        @change="updateConfig({ showManualExtrusion: !showManualExtrusion })"
      />
      <span>{{ t('dashboard.extruder.showManualExtrusion') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.extruder.showManualExtrusion')"
      :shown="quick.isQuick('showManualExtrusion')"
      @toggle="quick.setQuick('showManualExtrusion', $event)"
    />
  </div>

  <div v-if="quick.visible('showLoadMacros')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showLoadMacros"
        @change="updateConfig({ showLoadMacros: !showLoadMacros })"
      />
      <span>{{ t('dashboard.extruder.showLoadMacros') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.extruder.showLoadMacros')"
      :shown="quick.isQuick('showLoadMacros')"
      @toggle="quick.setQuick('showLoadMacros', $event)"
    />
  </div>

  <!--
    The row renders whether or not this printer has `[firmware_retraction]`: a
    setting that appears and disappears with the machine is one the user cannot
    find twice. The card's own block is what the printer's configuration gates.
  -->
  <div v-if="quick.visible('showRetraction')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showRetraction"
        @change="updateConfig({ showRetraction: !showRetraction })"
      />
      <span>{{ t('dashboard.extruder.showRetraction') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.extruder.showRetraction')"
      :shown="quick.isQuick('showRetraction')"
      @toggle="quick.setQuick('showRetraction', $event)"
    />
  </div>

  <div v-if="quick.visible('showPressureAdvance')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showPressureAdvance"
        @change="updateConfig({ showPressureAdvance: !showPressureAdvance })"
      />
      <span>{{ t('dashboard.extruder.showPressureAdvance') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.extruder.showPressureAdvance')"
      :shown="quick.isQuick('showPressureAdvance')"
      @toggle="quick.setQuick('showPressureAdvance', $event)"
    />
  </div>
</template>
