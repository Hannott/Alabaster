<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import { configBoolean, useDashboardModule } from '@/dashboard/context'
import { macrosDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'

/**
 * What the Macros card draws, rendered once and shared verbatim between the
 * full settings pane and the card's own quick layer — see
 * `docs/design/settings-surface.md`. `mode` decides which rows show and whether
 * they carry a quick-settings toggle; it never changes what a row does.
 *
 * A macro this printer no longer defines stays on the card by default, disabled
 * and marked, because a card that quietly drops a button is a card that hides a
 * configuration mistake — but a group edited against one printer and carried to
 * another can be mostly dead buttons, and then saying so once is enough.
 *
 * The picker beside this in the pane carries no pin. Choosing macros is a
 * filing job over two lists, not a row, and the card's quick layer opens inside
 * the card the picker would be filling.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('macros')
const quick = useQuickSettings(config, updateConfig, macrosDefaultQuickKeys, () => props.mode)

const hideMissing = computed(() => configBoolean(config.value, 'hideMissing', false))
</script>

<template>
  <div v-if="quick.visible('hideMissing')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="hideMissing"
        @change="updateConfig({ hideMissing: !hideMissing })"
      />
      <span>{{ t('dashboard.macros.hideMissing') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.macros.hideMissing')"
      :shown="quick.isQuick('hideMissing')"
      @toggle="quick.setQuick('hideMissing', $event)"
    />
  </div>
</template>
