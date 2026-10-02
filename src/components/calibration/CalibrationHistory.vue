<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { useProcedureText } from '@/composables/useProcedureText'
import type { ProcedureId } from '@/features/calibration/procedures'
import { useCalibrationStore, type CalibrationLogEntry } from '@/stores/calibration'
import { useConfirmationsStore } from '@/stores/confirmations'

/**
 * The last few logged results of a guided panel, newest first, one line each.
 * The line is the panel's own, because what a run of it found is only that
 * panel's to say: a skew in degrees, a sensitivity, a pair of offsets. A run
 * the reader has no further use for is forgotten from the printer's record,
 * after asking, the same way the generic workspace forgets one.
 */
const props = defineProps<{
  id: ProcedureId
  summary: (entry: CalibrationLogEntry) => string
}>()

const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const confirmations = useConfirmationsStore()
const { when } = useProcedureText()

const entries = computed(() => [...calibration.historyFor(props.id)].reverse().slice(0, 5))

const forgetAt = ref<number | null>(null)
const forgetGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'quiet',
  key: 'forgetCalibrationRun',
})

function requestForget(at: number): void {
  forgetGuard.request(
    () => forget(at),
    () => (forgetAt.value = at),
  )
}

function forget(at: number | null = forgetAt.value): void {
  forgetAt.value = null
  if (at !== null) calibration.forgetEntry(props.id, at)
}
</script>

<template>
  <div v-if="entries.length > 0" class="calibration-history">
    <h3 class="calibration-history__title">{{ t('calibration.bench.history') }}</h3>
    <ul class="calibration-history__list">
      <li v-for="entry in entries" :key="entry.at" class="calibration-history__entry">
        <span class="calibration-history__line">
          <span class="calibration-history__when">{{ when(entry.at) }}</span>
          <span class="calibration-history__summary">{{ summary(entry) }}</span>
        </span>
        <AppButton
          :guard="forgetGuard"
          size="xs"
          icon="trash"
          :label="t('calibration.bench.forget')"
          @click="requestForget(entry.at)"
        />
      </li>
    </ul>

    <ConfirmDialog
      :open="forgetAt !== null"
      :title="t('calibration.bench.forgetTitle')"
      :description="t('calibration.bench.forgetDescription')"
      :items="forgetAt === null ? [] : [when(forgetAt)]"
      :confirm-label="t('calibration.bench.forget')"
      tone="danger"
      show-skip-option
      @confirm="forget()"
      @cancel="forgetAt = null"
      @skip="confirmations.setSkip('forgetCalibrationRun', true)"
    />
  </div>
</template>
