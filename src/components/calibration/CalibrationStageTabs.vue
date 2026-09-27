<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { CalibrationStageId } from '@/features/calibration/stages'

/**
 * The strip that names the calibration jobs this machine can do.
 *
 * It is the page's answer to "what is this destination for". The page heading
 * cannot carry a standing description — `interface-standards.md` forbids one —
 * and the strip is not one: it is the work itself, listed in the order the
 * physical dependencies run, and because every entry is capability-gated it
 * lists what *this* printer can be calibrated for.
 *
 * A `tab-select` strip rather than a rail, because a rail's column is held for
 * the whole visit: five short labels cost the canvas about 14.5rem of width,
 * which is exactly what pushed stages under their own container thresholds on
 * a laptop viewport. The strip spends a band the page heading already sits on.
 * Semantics stay a group of toggles, per `button-system.md`'s `tab-select`
 * entry — a tablist would oblige a roving-tabindex keyboard contract.
 *
 * Below 48rem the strip gives way to a `<select>`, the same swap Settings' rail
 * makes. Wrapping was the alternative and fails on the pattern's own rule: the
 * selected underline sits over the band's bottom border, so on a wrapped strip
 * every first-line tab's underline would float over the second line instead.
 */
const props = defineProps<{
  stages: readonly CalibrationStageId[]
  active: CalibrationStageId
}>()

const emit = defineEmits<{ select: [stage: CalibrationStageId] }>()

const { t } = useI18n({ useScope: 'global' })

function onSelect(value: string): void {
  emit('select', value as CalibrationStageId)
}
</script>

<template>
  <div class="calibration-stages">
    <div class="calibration-stages__tabs" role="group" :aria-label="t('calibration.stagesLabel')">
      <button
        v-for="stage in props.stages"
        :key="stage"
        type="button"
        class="tab-select"
        :aria-pressed="props.active === stage"
        @click="emit('select', stage)"
      >
        {{ t(`calibration.stages.${stage}`) }}
      </button>
    </div>
    <select
      class="field field--block calibration-stages__select"
      :aria-label="t('calibration.stagesLabel')"
      :value="props.active"
      @change="onSelect(($event.target as HTMLSelectElement).value)"
    >
      <option v-for="stage in props.stages" :key="stage" :value="stage">
        {{ t(`calibration.stages.${stage}`) }}
      </option>
    </select>
  </div>
</template>
