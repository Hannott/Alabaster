<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import MovementCardSettingsFields from '@/components/dashboard/modules/MovementCardSettingsFields.vue'
import MovementStepSettingsFields from '@/components/dashboard/modules/MovementStepSettingsFields.vue'
import { configBoolean, useDashboardModule } from '@/dashboard/context'

/**
 * Movement's full configuration, shown in the settings surface with the card
 * docked beside it — so changing a step scale relabels the jog buttons under
 * the user's eye rather than being judged blind.
 *
 * The first two sections live in fields components shared with the card's own
 * quick layer, so the two can never drift; each row carries the pin that
 * decides whether it also appears there. The confirmation settings below have
 * no pin on purpose: each is decided once and then forgotten, and a card's
 * disclosure layer is for what the user reaches for while working. Alabaster's
 * one global "skip all confirmations" override, on the Settings page, still
 * reaches these — see `docs/design/dialog-system.md`.
 */
const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('movement')

const skipMotorsOffWarning = computed(() =>
  configBoolean(config.value, 'skipMotorsOffWarning', false),
)
const skipLevelingWarning = computed(() =>
  configBoolean(config.value, 'skipLevelingWarning', false),
)
</script>

<template>
  <SurfaceSection :title="t('dashboard.surface.cardSection')">
    <MovementCardSettingsFields mode="pane" />
  </SurfaceSection>

  <SurfaceSection
    :title="t('dashboard.movement.stepsTitle')"
    :hint="t('dashboard.movement.stepsHint')"
    divided
  >
    <MovementStepSettingsFields mode="pane" />
  </SurfaceSection>

  <!--
    No pin on any of these — decided once and then forgotten, the test
    `settings-surface.md` sets for the card's quick layer — but still
    `.settings-row` rather than a bare `.check-row`, so Confirmations shares
    the one seam with the sections above it instead of sitting tighter for no
    reason anyone chose.
  -->
  <SurfaceSection :title="t('dashboard.movement.confirmationsTitle')" divided>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="skipMotorsOffWarning"
          @change="updateConfig({ skipMotorsOffWarning: !skipMotorsOffWarning })"
        />
        <span>{{ t('dashboard.movement.skipMotorsOffWarning') }}</span>
      </label>
    </div>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="skipLevelingWarning"
          @change="updateConfig({ skipLevelingWarning: !skipLevelingWarning })"
        />
        <span>{{ t('dashboard.movement.skipLevelingWarning') }}</span>
      </label>
    </div>
  </SurfaceSection>
</template>
