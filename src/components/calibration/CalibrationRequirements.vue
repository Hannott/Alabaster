<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useAvailability } from '@/composables/useAvailability'
import {
  useProcedureRequirements,
  type RequirementFixId,
} from '@/composables/useProcedureRequirements'
import type { ProcedureRequirement } from '@/features/calibration/procedures'
import { useCalibrationStore } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'

/**
 * What a procedure needs before it runs, each with its state and the one fix
 * that meets it. The generic workspace and every guided panel list them
 * through this, so "homed" is checked, worded and fixed the same way whether
 * the procedure is one command or a sequence the reader drives.
 */
const props = defineProps<{ requires: readonly ProcedureRequirement[] }>()

const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const requirements = useProcedureRequirements()
const { availability: klipperAvailability } = useAvailability('klipper')

/*
 * A fix moves or reads the machine, so it waits for the same things a run
 * does: Klipper there, no print, and no procedure under way — a fix pressed
 * mid-run would move the toolhead out from under a probe.
 */
const canFix = computed(
  () =>
    klipperAvailability.value.isAvailable &&
    !printer.hasActivePrint &&
    calibration.activeRun === null,
)

const fixIcons: Partial<Record<RequirementFixId, 'home' | 'move'>> = {
  home: 'home',
  moveOverBed: 'move',
}

const states = computed(() => props.requires.map((requirement) => requirements.value[requirement]))
</script>

<template>
  <ul v-if="states.length > 0" class="calibration-checks">
    <li
      v-for="state in states"
      :key="state.requirement"
      class="calibration-check"
      :class="{ 'calibration-check--unmet': !state.met }"
    >
      <AppIcon :name="state.met ? 'check' : 'warning'" class="size-4 shrink-0" aria-hidden="true" />
      <span class="calibration-check__text">{{
        t(`calibration.requirement.${state.requirement}.${state.met ? 'met' : 'unmet'}`)
      }}</span>
      <AppButton
        v-if="!state.met && state.fix"
        size="xs"
        :icon="fixIcons[state.fix.id]"
        :label="t(`calibration.requirement.fix.${state.fix.id}`)"
        :pending="state.fix.pending"
        :disabled="!canFix"
        @click="state.fix.run()"
      />
    </li>
  </ul>
</template>
