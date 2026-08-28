<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import {
  cameraArrangements,
  cameraCardSettings,
  cameraMaxColumns,
  cameraStackings,
  selectedCameras,
} from '@/components/dashboard/modules/cameraCardSettings'
import { useDashboardModule } from '@/dashboard/context'
import { cameraDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'
import { useWebcamsStore } from '@/stores/webcams'

/**
 * How the Camera card draws the streams it has been given, rendered once and
 * shared verbatim between the full settings pane and the card's own quick layer
 * — see `docs/design/settings-surface.md`. `mode` decides which rows show and
 * whether they carry a quick-settings toggle; it never changes what a row does.
 *
 * *Which* cameras a card shows lives in the pane instead. It is a picker over
 * two ordered lists rather than a row, and it is the one setting worth judging
 * against the card docked beside it — the point of choosing three cameras is
 * seeing whether three fit.
 *
 * The arrangement and column rows disappear below two cameras rather than
 * disabling. A card showing one camera has no arrangement to choose, and a
 * disabled control that will never be enabled unless the printer gains hardware
 * is noise rather than information — unlike a setting that depends on a sibling
 * row above it, which stays visible so its dependency is discoverable.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('camera')
const webcams = useWebcamsStore()
const quick = useQuickSettings(config, updateConfig, cameraDefaultQuickKeys, () => props.mode)

const settings = computed(() => cameraCardSettings(config.value))
const showsSeveral = computed(() => selectedCameras(settings.value, webcams.cameras).length > 1)

/**
 * Never more columns than there are cameras: offering "4" to a card holding two
 * of them is offering two empty tracks.
 */
const columnOptions = computed(() => {
  const cameras = selectedCameras(settings.value, webcams.cameras).length
  const most = Math.min(cameraMaxColumns, Math.max(2, cameras))
  return Array.from({ length: most }, (_, index) => index + 1)
})
</script>

<template>
  <div v-if="showsSeveral && quick.visible('arrangement')" class="settings-row">
    <span class="settings-row__label">{{ t('dashboard.camera.arrangement') }}</span>
    <div class="flex items-center gap-2">
      <div class="segmented">
        <AppButton
          v-for="option in cameraArrangements"
          :key="option"
          size="sm"
          :aria-pressed="settings.arrangement === option"
          @click="updateConfig({ arrangement: option })"
        >
          {{ t(`dashboard.camera.arrangementOption.${option}`) }}
        </AppButton>
      </div>
      <QuickSettingToggle
        v-if="mode === 'pane'"
        :label="t('dashboard.camera.arrangement')"
        :shown="quick.isQuick('arrangement')"
        @toggle="quick.setQuick('arrangement', $event)"
      />
    </div>
  </div>

  <div
    v-if="showsSeveral && settings.arrangement === 'grid' && quick.visible('stacking')"
    class="settings-row"
  >
    <span class="settings-row__label">{{ t('dashboard.camera.stacking') }}</span>
    <div class="flex items-center gap-2">
      <div class="segmented">
        <AppButton
          v-for="option in cameraStackings"
          :key="option"
          size="sm"
          :aria-pressed="settings.stacking === option"
          @click="updateConfig({ stacking: option })"
        >
          {{ t(`dashboard.camera.stackingOption.${option}`) }}
        </AppButton>
      </div>
      <QuickSettingToggle
        v-if="mode === 'pane'"
        :label="t('dashboard.camera.stacking')"
        :shown="quick.isQuick('stacking')"
        @toggle="quick.setQuick('stacking', $event)"
      />
    </div>
  </div>

  <div
    v-if="
      showsSeveral &&
      settings.arrangement === 'grid' &&
      settings.stacking === 'horizontal' &&
      quick.visible('columns')
    "
    class="settings-row"
  >
    <span class="settings-row__label">{{ t('dashboard.camera.columns') }}</span>
    <div class="flex items-center gap-2">
      <div class="segmented">
        <AppButton
          v-for="option in columnOptions"
          :key="option"
          size="sm"
          mono
          :label="option"
          :aria-pressed="settings.columns === option"
          @click="updateConfig({ columns: option })"
        />
      </div>
      <QuickSettingToggle
        v-if="mode === 'pane'"
        :label="t('dashboard.camera.columns')"
        :shown="quick.isQuick('columns')"
        @toggle="quick.setQuick('columns', $event)"
      />
    </div>
  </div>

  <div v-if="quick.visible('showLabels')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="settings.showLabels"
        @change="updateConfig({ showLabels: !settings.showLabels })"
      />
      <span>{{ t('dashboard.camera.showLabels') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.camera.showLabels')"
      :shown="quick.isQuick('showLabels')"
      @toggle="quick.setQuick('showLabels', $event)"
    />
  </div>

  <div v-if="quick.visible('showFrameRate')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="settings.showFrameRate"
        @change="updateConfig({ showFrameRate: !settings.showFrameRate })"
      />
      <span>{{ t('dashboard.camera.showFrameRate') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.camera.showFrameRate')"
      :shown="quick.isQuick('showFrameRate')"
      @toggle="quick.setQuick('showFrameRate', $event)"
    />
  </div>
</template>
