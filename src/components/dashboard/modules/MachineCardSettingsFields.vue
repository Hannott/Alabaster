<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import { readMachineCardSetting } from '@/components/dashboard/modules/machineCardSettings'
import { useDashboardModule } from '@/dashboard/context'
import { machineDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'

/**
 * The one switch that changes what the Machine card lets you do — see
 * `docs/design/settings-surface.md`. Shared verbatim between the full pane and
 * the card's own quick layer; `mode` decides which rows show and whether they
 * carry the promotion toggle, never what a row does.
 *
 * The four limit fields carry no row of their own here: they are the card's
 * one and only Need, always drawn, so there is nothing about them to show or
 * hide. Whether a runtime limit resets when a job ends is a print-lifecycle
 * policy rather than something that changes what this card draws, so it lives
 * in `MachineSettingsPane.vue` directly, the same split Print uses for its own
 * reset-on-finish choices.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('machine')
const quick = useQuickSettings(config, updateConfig, machineDefaultQuickKeys, () => props.mode)

// Key and default live in `machineCardSettings.ts`, shared with the card so
// the row's checkbox can never disagree with the fields it locks.
const lockDuringPrint = computed(() => readMachineCardSetting(config.value, 'lockDuringPrint'))
</script>

<template>
  <div v-if="quick.visible('lockDuringPrint')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="lockDuringPrint"
        @change="updateConfig({ lockDuringPrint: !lockDuringPrint })"
      />
      <span>{{ t('dashboard.machine.lockDuringPrint') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.machine.lockDuringPrint')"
      :shown="quick.isQuick('lockDuringPrint')"
      @toggle="quick.setQuick('lockDuringPrint', $event)"
    />
  </div>
</template>
