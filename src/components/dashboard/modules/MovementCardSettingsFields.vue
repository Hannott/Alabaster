<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import { readMovementCardSetting } from '@/components/dashboard/modules/movementCardSettings'
import { useDashboardModule } from '@/dashboard/context'
import { movementDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'

/**
 * Which blocks the Movement card draws at all, rendered once and shared
 * verbatim between the full settings pane and the card's own quick layer — see
 * `docs/design/settings-surface.md`. `mode` decides which rows show and
 * whether they carry a quick-settings toggle; it never changes what a row
 * does.
 *
 * `pane` shows every row, always, in this fixed order — promoting a setting
 * never moves it. `quick` shows only the rows the pane has flagged, and never
 * renders the toggle itself: demoting a setting is a decision made from the
 * pane, not from the dashboard.
 *
 * Every row is `.settings-row`, including the nested one: a sub-setting is
 * still a setting someone might want a tap closer, so it keeps a pin rather
 * than being the one row this component builds without one. The pin stays
 * clickable regardless of whether "Show the bed plan" is on — promoting a
 * row is a decision about where it appears, not about whether its value
 * currently means anything, and the checkbox's own `:disabled` already says
 * that part.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('movement')
const quick = useQuickSettings(config, updateConfig, movementDefaultQuickKeys, () => props.mode)

// Keys and defaults live in `movementCardSettings.ts`, shared with the card so
// a row's checkbox can never disagree with the block it controls.
const showBedPlan = computed(() => readMovementCardSetting(config.value, 'showBedPlan'))
const showBedPlanWhilePrinting = computed(() =>
  readMovementCardSetting(config.value, 'showBedPlanWhilePrinting'),
)
const showParking = computed(() => readMovementCardSetting(config.value, 'showParking'))
const showHomeXY = computed(() => readMovementCardSetting(config.value, 'showHomeXY'))
const showBedScrewsCheck = computed(() =>
  readMovementCardSetting(config.value, 'showBedScrewsCheck'),
)
const showZOffset = computed(() => readMovementCardSetting(config.value, 'showZOffset'))
const showSpeedFactor = computed(() => readMovementCardSetting(config.value, 'showSpeedFactor'))
const swapZDirection = computed(() => readMovementCardSetting(config.value, 'swapZDirection'))
</script>

<template>
  <div v-if="quick.visible('showBedPlan')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showBedPlan"
        @change="updateConfig({ showBedPlan: !showBedPlan })"
      />
      <span>{{ t('dashboard.movement.showBedPlan') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.movement.showBedPlan')"
      :shown="quick.isQuick('showBedPlan')"
      @toggle="quick.setQuick('showBedPlan', $event)"
    />
  </div>

  <!--
    Disabled rather than hidden while the bed plan itself is off: the
    dependency stays visible instead of disappearing the moment a reader
    turns the parent off and might wonder what else it affects.
  -->
  <div v-if="quick.visible('showBedPlanWhilePrinting')" class="settings-row settings-row--nested">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showBedPlanWhilePrinting"
        :disabled="!showBedPlan"
        @change="updateConfig({ showBedPlanWhilePrinting: !showBedPlanWhilePrinting })"
      />
      <span>{{ t('dashboard.movement.showBedPlanWhilePrinting') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.movement.showBedPlanWhilePrinting')"
      :shown="quick.isQuick('showBedPlanWhilePrinting')"
      @toggle="quick.setQuick('showBedPlanWhilePrinting', $event)"
    />
  </div>

  <div v-if="quick.visible('showParking')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showParking"
        @change="updateConfig({ showParking: !showParking })"
      />
      <span>{{ t('dashboard.movement.showParking') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.movement.showParking')"
      :shown="quick.isQuick('showParking')"
      @toggle="quick.setQuick('showParking', $event)"
    />
  </div>

  <div v-if="quick.visible('showHomeXY')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showHomeXY"
        @change="updateConfig({ showHomeXY: !showHomeXY })"
      />
      <span>{{ t('dashboard.movement.showHomeXY') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.movement.showHomeXY')"
      :shown="quick.isQuick('showHomeXY')"
      @toggle="quick.setQuick('showHomeXY', $event)"
    />
  </div>

  <div v-if="quick.visible('showBedScrewsCheck')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showBedScrewsCheck"
        @change="updateConfig({ showBedScrewsCheck: !showBedScrewsCheck })"
      />
      <span>{{ t('dashboard.movement.showBedScrewsCheck') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.movement.showBedScrewsCheck')"
      :shown="quick.isQuick('showBedScrewsCheck')"
      @toggle="quick.setQuick('showBedScrewsCheck', $event)"
    />
  </div>

  <div v-if="quick.visible('showZOffset')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showZOffset"
        @change="updateConfig({ showZOffset: !showZOffset })"
      />
      <span>{{ t('dashboard.movement.showZOffset') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.movement.showZOffset')"
      :shown="quick.isQuick('showZOffset')"
      @toggle="quick.setQuick('showZOffset', $event)"
    />
  </div>

  <div v-if="quick.visible('showSpeedFactor')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showSpeedFactor"
        @change="updateConfig({ showSpeedFactor: !showSpeedFactor })"
      />
      <span>{{ t('dashboard.movement.showSpeedFactor') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.movement.showSpeedFactor')"
      :shown="quick.isQuick('showSpeedFactor')"
      @toggle="quick.setQuick('showSpeedFactor', $event)"
    />
  </div>

  <div v-if="quick.visible('swapZDirection')">
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="swapZDirection"
          @change="updateConfig({ swapZDirection: !swapZDirection })"
        />
        <span>{{ t('dashboard.movement.swapZDirection') }}</span>
      </label>
      <QuickSettingToggle
        v-if="mode === 'pane'"
        :label="t('dashboard.movement.swapZDirection')"
        :shown="quick.isQuick('swapZDirection')"
        @toggle="quick.setQuick('swapZDirection', $event)"
      />
    </div>
    <p v-if="mode === 'pane'" class="surface-section__hint">
      {{ t('dashboard.movement.swapZDirectionHint') }}
    </p>
  </div>
</template>
