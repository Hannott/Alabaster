<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import ExtruderCardSettingsFields from '@/components/dashboard/modules/ExtruderCardSettingsFields.vue'
import ExtruderMacroSettingsFields from '@/components/dashboard/modules/ExtruderMacroSettingsFields.vue'

/**
 * Extruder's full configuration: which blocks the card draws, and which of
 * this printer's macros it offers.
 *
 * What its extrude and retract buttons command — length and feedrate — used
 * to have a section here. Both are now permanent fields on the card itself,
 * beside the buttons they command, so editing them from here as well would
 * be the exact duplicate-control problem `settings-surface.md` rules out for
 * a promoted row: the same value, editable in two places, with nothing to
 * say which one is authoritative.
 *
 * The card section lives in a fields component shared with the card's own
 * quick layer, so the two can never drift; each row carries the pin that
 * decides whether it also appears there. The macro picker is pane-only — see
 * its own component for why.
 */
const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <SurfaceSection :title="t('dashboard.surface.cardSection')">
    <ExtruderCardSettingsFields mode="pane" />
  </SurfaceSection>

  <SurfaceSection :title="t('dashboard.extruder.macrosTitle')" divided>
    <ExtruderMacroSettingsFields />
  </SurfaceSection>
</template>
