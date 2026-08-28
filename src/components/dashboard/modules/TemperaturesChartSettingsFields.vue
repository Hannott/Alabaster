<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import {
  chartHeightOptions,
  chartWindowOptions,
  readChartHeight,
  readChartWindowMinutes,
} from '@/components/dashboard/modules/temperaturesChartSettings'
import { configBoolean, useDashboardModule } from '@/dashboard/context'
import { useQuickSettings } from '@/dashboard/quickSettings'
import { temperaturesDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'

/**
 * The History chart's settings, rendered once and shared verbatim between the
 * full settings pane and the card's own quick layer — the two must never
 * drift, the way `ConsoleSettingsFields` already keeps Console's card and page
 * in step. `mode` decides which rows show and whether they carry a
 * quick-settings toggle; it never changes what a row does.
 *
 * `pane` shows every row, always, in this fixed order — promoting a setting
 * never moves it. `quick` shows only the rows the pane has flagged, and never
 * renders the toggle itself: demoting a setting is a decision made from the
 * pane, not from the dashboard.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('temperatures')
const quick = useQuickSettings(config, updateConfig, temperaturesDefaultQuickKeys, () => props.mode)

const showChart = computed(() => configBoolean(config.value, 'showChart', true))
// Option lists, fallbacks, and their validation live in
// `temperaturesChartSettings.ts`, shared with the card so a selected segment
// can never disagree with the chart it controls.
const chartHeight = computed(() => readChartHeight(config.value))
const chartWindowMinutes = computed(() => readChartWindowMinutes(config.value))
/**
 * The setpoint each trace is climbing toward. On by default and previously
 * stored with no control anywhere — `showChartTargets` was readable only by
 * hand-editing a profile, which is not a setting, it is a leak. The key keeps
 * its stored name so existing profiles are unaffected.
 */
const showChartTargets = computed(() => configBoolean(config.value, 'showChartTargets', true))
const chartAutoScale = computed(() => configBoolean(config.value, 'chartAutoScale', true))
const chartZeroBaseline = computed(() => configBoolean(config.value, 'chartZeroBaseline', false))
const chartShowPower = computed(() => configBoolean(config.value, 'chartShowPower', false))
</script>

<template>
  <div v-if="quick.visible('showChart')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showChart"
        @change="updateConfig({ showChart: !showChart })"
      />
      <span>{{ t('dashboard.temperature.showChart') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.temperature.showChart')"
      :shown="quick.isQuick('showChart')"
      @toggle="quick.setQuick('showChart', $event)"
    />
  </div>

  <template v-if="showChart">
    <div v-if="quick.visible('chartHeight')" class="settings-row">
      <span class="settings-row__label">{{ t('dashboard.temperature.chartHeight') }}</span>
      <div class="flex items-center gap-2">
        <div class="segmented">
          <AppButton
            v-for="option in chartHeightOptions"
            :key="option"
            size="sm"
            :aria-pressed="chartHeight === option"
            @click="updateConfig({ chartHeight: option })"
          >
            {{ t(`dashboard.temperature.chartHeightOption.${option}`) }}
          </AppButton>
        </div>
        <QuickSettingToggle
          v-if="mode === 'pane'"
          :label="t('dashboard.temperature.chartHeight')"
          :shown="quick.isQuick('chartHeight')"
          @toggle="quick.setQuick('chartHeight', $event)"
        />
      </div>
    </div>

    <div v-if="quick.visible('chartWindowMinutes')" class="settings-row">
      <span class="settings-row__label">{{ t('dashboard.temperature.chartWindow') }}</span>
      <div class="flex items-center gap-2">
        <div class="segmented">
          <AppButton
            v-for="option in chartWindowOptions"
            :key="option"
            size="sm"
            mono
            :aria-pressed="chartWindowMinutes === option"
            @click="updateConfig({ chartWindowMinutes: option })"
          >
            {{ t('dashboard.temperature.chartWindowOption', { minutes: option }) }}
          </AppButton>
        </div>
        <QuickSettingToggle
          v-if="mode === 'pane'"
          :label="t('dashboard.temperature.chartWindow')"
          :shown="quick.isQuick('chartWindowMinutes')"
          @toggle="quick.setQuick('chartWindowMinutes', $event)"
        />
      </div>
    </div>

    <div v-if="quick.visible('showChartTargets')" class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="showChartTargets"
          @change="updateConfig({ showChartTargets: !showChartTargets })"
        />
        <span>{{ t('dashboard.temperature.chartShowTargets') }}</span>
      </label>
      <QuickSettingToggle
        v-if="mode === 'pane'"
        :label="t('dashboard.temperature.chartShowTargets')"
        :shown="quick.isQuick('showChartTargets')"
        @toggle="quick.setQuick('showChartTargets', $event)"
      />
    </div>

    <div v-if="quick.visible('chartAutoScale')">
      <div class="settings-row">
        <label class="check-row">
          <input
            type="checkbox"
            :checked="chartAutoScale"
            @change="updateConfig({ chartAutoScale: !chartAutoScale })"
          />
          <span>{{ t('dashboard.temperature.chartAutoScale') }}</span>
        </label>
        <QuickSettingToggle
          v-if="mode === 'pane'"
          :label="t('dashboard.temperature.chartAutoScale')"
          :shown="quick.isQuick('chartAutoScale')"
          @toggle="quick.setQuick('chartAutoScale', $event)"
        />
      </div>
      <p v-if="mode === 'pane'" class="surface-section__hint">
        {{ t('dashboard.temperature.chartAutoScaleHint') }}
      </p>
    </div>

    <div v-if="quick.visible('chartShowPower')" class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="chartShowPower"
          @change="updateConfig({ chartShowPower: !chartShowPower })"
        />
        <span>{{ t('dashboard.temperature.chartShowPower') }}</span>
      </label>
      <QuickSettingToggle
        v-if="mode === 'pane'"
        :label="t('dashboard.temperature.chartShowPower')"
        :shown="quick.isQuick('chartShowPower')"
        @toggle="quick.setQuick('chartShowPower', $event)"
      />
    </div>

    <div v-if="quick.visible('chartZeroBaseline')" class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="chartZeroBaseline"
          @change="updateConfig({ chartZeroBaseline: !chartZeroBaseline })"
        />
        <span>{{ t('dashboard.temperature.chartZeroBaseline') }}</span>
      </label>
      <QuickSettingToggle
        v-if="mode === 'pane'"
        :label="t('dashboard.temperature.chartZeroBaseline')"
        :shown="quick.isQuick('chartZeroBaseline')"
        @toggle="quick.setQuick('chartZeroBaseline', $event)"
      />
    </div>
  </template>
</template>
