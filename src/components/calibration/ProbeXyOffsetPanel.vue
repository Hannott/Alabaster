<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import CalibrationHistory from '@/components/calibration/CalibrationHistory.vue'
import CalibrationRequirements from '@/components/calibration/CalibrationRequirements.vue'
import { useConfigWrite } from '@/composables/useConfigWrite'
import { useProcedureRequirements } from '@/composables/useProcedureRequirements'
import type { BedPoint } from '@/features/calibration/bedContext'
import { procedureById } from '@/features/calibration/procedures'
import { coordinateText, probeOffsetFrom } from '@/features/calibration/toolheadPoints'
import { useCalibrationStore, type CalibrationLogEntry } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'
import { probeSections, usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * The probe's X and Y offset, recorded the way Klipper's probe calibration
 * guide measures it: the nozzle stood on a mark on the bed, then the probe's
 * sensing point stood on the same mark, and the difference between the two
 * toolhead positions is the offset. The reader jogs with the Movement card
 * beside this; nothing here moves the toolhead.
 *
 * The positions are the toolhead's own (`toolhead.position`), not the G-code
 * position: a `SET_GCODE_OFFSET` left from printing shifts the second and not
 * the first, and the offset is between the two machine positions.
 */
const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const requirements = useProcedureRequirements()
const configWrite = useConfigWrite()

const requires = procedureById('probeXyOffset')?.requires ?? []
const ready = computed(() => requires.every((requirement) => requirements.value[requirement].met))

const section = computed(
  () => probeSections.find((name) => printerConfig.section(name) !== null) ?? null,
)
const configured = computed(() => printerConfig.probeOffset)

function toolhead(): BedPoint | null {
  const [x, y] = printer.toolheadPosition
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null
}

const nozzleAt = ref<BedPoint | null>(null)
const probeAt = ref<BedPoint | null>(null)

function record(which: 'nozzle' | 'probe'): void {
  const position = toolhead()
  if (position === null) return
  if (which === 'nozzle') nozzleAt.value = position
  else probeAt.value = position
  configWrite.forget()
}

const measured = computed(() =>
  nozzleAt.value && probeAt.value ? probeOffsetFrom(nozzleAt.value, probeAt.value) : null,
)

const rows = computed(() => {
  if (!measured.value) return []
  return (['x', 'y'] as const).map((axis) => ({
    option: `${axis}_offset`,
    before: coordinateText(configured.value[axis]),
    after: coordinateText(measured.value![axis]),
  }))
})
const changed = computed(() => rows.value.some((row) => row.before !== row.after))

function positionText(point: BedPoint | null): string {
  return point === null ? '—' : `X ${coordinateText(point.x)} · Y ${coordinateText(point.y)}`
}

async function save(): Promise<void> {
  if (section.value === null || rows.value.length === 0) return
  const outcome = await configWrite.write(
    'offset',
    section.value,
    rows.value.map((row) => ({ option: row.option, value: row.after })),
  )
  if (outcome === null || outcome === 'refused') return
  calibration.recordManual(
    'probeXyOffset',
    { section: section.value },
    rows.value.map((row) => ({
      label: { literal: row.option },
      before: row.before,
      after: row.after,
    })),
    'measured',
  )
}

const saveOutcome = computed(() => configWrite.outcomeFor('offset'))

function historySummary(entry: CalibrationLogEntry): string {
  return entry.rows
    .map(
      (row) =>
        `${'literal' in row.label ? row.label.literal : ''} ${row.before ?? '—'} → ${row.after}`,
    )
    .join(' · ')
}
</script>

<template>
  <CalibrationCard
    class="calibration-workspace"
    :title="t('calibration.procedure.probeXyOffset.name')"
  >
    <template #aside>
      <span class="calibration-workspace__command">x_offset · y_offset</span>
      <span>{{ coordinateText(configured.x) }}, {{ coordinateText(configured.y) }}</span>
    </template>
    <p class="calibration-workspace__description">
      {{ t('calibration.procedure.probeXyOffset.detail') }}
    </p>

    <CalibrationRequirements :requires="requires" />

    <ol class="calibration-steps">
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t('calibration.probeOffset.nozzle') }}</span>
        <div class="calibration-step__controls">
          <AppButton
            size="sm"
            icon="crosshair"
            :label="t('calibration.probeOffset.recordNozzle')"
            :disabled="!ready"
            @click="record('nozzle')"
          />
          <span class="calibration-workspace__command">{{ positionText(nozzleAt) }}</span>
        </div>
      </li>
      <li class="calibration-step">
        <span class="calibration-step__text">{{ t('calibration.probeOffset.probe') }}</span>
        <div class="calibration-step__controls">
          <AppButton
            size="sm"
            icon="crosshair"
            :label="t('calibration.probeOffset.recordProbe')"
            :disabled="!ready || nozzleAt === null"
            @click="record('probe')"
          />
          <span class="calibration-workspace__command">{{ positionText(probeAt) }}</span>
        </div>
      </li>
    </ol>

    <div v-if="rows.length > 0" class="calibration-result" role="status" aria-live="polite">
      <table class="calibration-result__table">
        <thead>
          <tr>
            <th scope="col">{{ t('calibration.result.value') }}</th>
            <th scope="col">{{ t('calibration.result.before') }}</th>
            <th scope="col">{{ t('calibration.result.now') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.option">
            <th scope="row" class="calibration-workspace__command">{{ row.option }}</th>
            <td class="calibration-result__number">{{ row.before }}</td>
            <td
              class="calibration-result__number"
              :class="{ 'calibration-result__number--changed': row.before !== row.after }"
            >
              {{ row.after }}
            </td>
          </tr>
        </tbody>
      </table>
      <p class="calibration-panel__hint">{{ t('calibration.probeOffset.dependents') }}</p>
      <div class="calibration-result__actions">
        <AppButton
          size="sm"
          variant="primary"
          icon="save"
          :label="t('calibration.npa.saveRestart')"
          :pending="configWrite.writing.value === 'offset'"
          :disabled="configWrite.disabled.value || !changed || section === null"
          @click="save"
        />
        <span v-if="saveOutcome" class="calibration-panel__hint">{{
          t(`calibration.result.persist.${saveOutcome}`)
        }}</span>
        <span v-else-if="!changed" class="calibration-panel__hint">{{
          t('calibration.drive.nothingToWrite')
        }}</span>
      </div>
    </div>

    <CalibrationHistory id="probeXyOffset" :summary="historySummary" />
  </CalibrationCard>
</template>
