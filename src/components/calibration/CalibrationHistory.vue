<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useProcedureText } from '@/composables/useProcedureText'
import type { ProcedureId } from '@/features/calibration/procedures'
import { useCalibrationStore, type CalibrationLogEntry } from '@/stores/calibration'

/**
 * The last few logged results of a guided panel, newest first, one line each.
 * The line is the panel's own, because what a run of it found is only that
 * panel's to say: a skew in degrees, a sensitivity, a pair of offsets.
 */
const props = defineProps<{
  id: ProcedureId
  summary: (entry: CalibrationLogEntry) => string
}>()

const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const { when } = useProcedureText()

const entries = computed(() => [...calibration.historyFor(props.id)].reverse().slice(0, 5))
</script>

<template>
  <div v-if="entries.length > 0" class="calibration-history">
    <h3 class="calibration-history__title">{{ t('calibration.bench.history') }}</h3>
    <ul class="calibration-history__list">
      <li v-for="entry in entries" :key="entry.at" class="calibration-history__entry">
        <span class="calibration-history__when">{{ when(entry.at) }}</span>
        <span class="calibration-history__summary">{{ summary(entry) }}</span>
      </li>
    </ul>
  </div>
</template>
