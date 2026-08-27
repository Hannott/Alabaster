<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { CalibrationStageId } from '@/features/calibration/stages'

/**
 * The rail that names the calibration jobs this machine can do.
 *
 * It is the page's answer to "what is this destination for". The page heading
 * cannot carry a standing description — `interface-standards.md` forbids one,
 * and rightly: permanent copy explaining a named route is an introduction the
 * reader has to walk past every visit. A rail is not that. It is the work
 * itself, listed, in the order the physical dependencies run — and because
 * every entry is capability-gated, what it lists is what *this* printer can be
 * calibrated for, not a menu of everything Klipper can do.
 *
 * Same shape as Settings' category rail, down to the `<select>` swap on narrow
 * screens, and for the same reason: `button--block` rail buttons never wrap
 * into a compact strip, they just reproduce the tall vertical list through
 * `flex-wrap`. See `.settings-rail`'s own comment in main.css.
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
  <nav class="calibration-rail" :aria-label="t('calibration.stagesLabel')">
    <button
      v-for="stage in props.stages"
      :key="stage"
      type="button"
      class="button button--quiet button--sm button--start button--block calibration-rail-button"
      :aria-current="props.active === stage ? 'true' : undefined"
      @click="emit('select', stage)"
    >
      {{ t(`calibration.stages.${stage}`) }}
    </button>
    <select
      class="field field--block calibration-rail-select"
      :aria-label="t('calibration.stagesLabel')"
      :value="props.active"
      @change="onSelect(($event.target as HTMLSelectElement).value)"
    >
      <option v-for="stage in props.stages" :key="stage" :value="stage">
        {{ t(`calibration.stages.${stage}`) }}
      </option>
    </select>
  </nav>
</template>
