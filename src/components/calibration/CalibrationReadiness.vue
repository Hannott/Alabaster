<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import { useProcedureRequirements } from '@/composables/useProcedureRequirements'
import type { CalibrationProcedure, ProcedureRequirement } from '@/features/calibration/procedures'
import { usePrinterStore } from '@/stores/printer'

/**
 * What this stage's procedures need, live, in one band: each condition says in
 * words whether it holds. A precondition used to be discovered by pressing a
 * button that then refused. The action that meets one sits in the selected
 * procedure's own checklist, beside the Run it blocks, rather than twice.
 *
 * It also counts what calibrations have staged for `SAVE_CONFIG` — as a fact,
 * never as a second way to write it. The header's save stays the one
 * printer-wide action for that.
 */
const props = defineProps<{ procedures: readonly CalibrationProcedure[] }>()

const { t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const requirements = useProcedureRequirements()

const order: readonly ProcedureRequirement[] = ['homed', 'notPrinting', 'accelerometer']

/** Only the conditions some procedure on this stage asks for; the band says nothing else. */
const relevant = computed(() => {
  const asked = new Set<ProcedureRequirement>()
  for (const procedure of props.procedures) {
    for (const requirement of procedure.requires) asked.add(requirement)
  }
  // A probe position, and a cleared mesh before a Z calibration, are one
  // procedure's concern each; its own checklist says it.
  asked.delete('probeInBed')
  asked.delete('zeroedForZ')
  // A fixed order, so the band reads the same on every stage.
  return order
    .filter((requirement) => asked.has(requirement))
    .map((requirement) => requirements.value[requirement])
})

const stagedCount = computed(() =>
  Object.values(printer.saveConfigPendingItems).reduce(
    (total, options) => total + Object.keys(options ?? {}).length,
    0,
  ),
)
const hasStaged = computed(() => printer.saveConfigPending || stagedCount.value > 0)
</script>

<template>
  <div v-if="relevant.length > 0 || hasStaged" class="calibration-readiness" role="status">
    <span class="calibration-readiness__title">{{ t('calibration.bench.readiness') }}</span>
    <span
      v-for="state in relevant"
      :key="state.requirement"
      class="calibration-pill"
      :class="state.met ? 'calibration-pill--met' : 'calibration-pill--unmet'"
    >
      <AppIcon :name="state.met ? 'check' : 'warning'" class="size-4 shrink-0" aria-hidden="true" />
      {{ t(`calibration.requirement.${state.requirement}.${state.met ? 'met' : 'unmet'}`) }}
    </span>
    <span v-if="hasStaged" class="calibration-pill">
      <AppIcon name="save" class="size-4 shrink-0" aria-hidden="true" />
      {{
        stagedCount > 0
          ? t('calibration.bench.staged', { count: stagedCount })
          : t('calibration.bench.stagedUnknown')
      }}
    </span>
  </div>
</template>
