<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import { configBoolean, useDashboardModule } from '@/dashboard/context'
import { printDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'
import { usePrinterStore } from '@/stores/printer'

/**
 * The one promotable row of Print's progress section — see
 * `PrintCardSettingsFields` for the `mode` contract these components share.
 * It is promotable because it is the setting someone reaches for while watching
 * a job whose percentage disagrees with the slicer's, which is exactly when the
 * card is in front of them.
 *
 * The estimate sources below it in the pane carry no pin: four radio rows in
 * the card's quick layer is the balloon the two-layer split exists to prevent.
 * Neither does the drift threshold, which is a number set once.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const { config, updateConfig } = useDashboardModule('print')
const quick = useQuickSettings(config, updateConfig, printDefaultQuickKeys, () => props.mode)

const useSlicerProgress = computed(() => configBoolean(config.value, 'useSlicerProgress', false))

/**
 * Said here rather than guessed at: the file simply carries no M73 output. It
 * shows in both modes, unlike the hint above it — a hint explains the setting
 * and the pane is where that is read, but this reports what the printer is
 * doing right now, and a user who promoted the row to the card is the one who
 * most needs telling that it is having no effect.
 */
const slicerProgressMissing = computed(
  () => useSlicerProgress.value && printer.slicerProgress === null,
)
</script>

<template>
  <div v-if="quick.visible('useSlicerProgress')">
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="useSlicerProgress"
          @change="updateConfig({ useSlicerProgress: !useSlicerProgress })"
        />
        <span>{{ t('dashboard.print.useSlicerProgress') }}</span>
      </label>
      <QuickSettingToggle
        v-if="mode === 'pane'"
        :label="t('dashboard.print.useSlicerProgress')"
        :shown="quick.isQuick('useSlicerProgress')"
        @toggle="quick.setQuick('useSlicerProgress', $event)"
      />
    </div>
    <p v-if="mode === 'pane'" class="module-settings__hint">
      {{ t('dashboard.print.slicerProgressHint') }}
    </p>
    <p v-if="slicerProgressMissing" class="module-settings__hint text-caution-text">
      {{ t('dashboard.print.slicerProgressMissing') }}
    </p>
  </div>
</template>
