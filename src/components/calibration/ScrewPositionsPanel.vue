<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import CalibrationHistory from '@/components/calibration/CalibrationHistory.vue'
import CalibrationRequirements from '@/components/calibration/CalibrationRequirements.vue'
import { useCalibrationSelection } from '@/composables/useCalibrationSelection'
import { useConfigWrite } from '@/composables/useConfigWrite'
import { useProcedureRequirements } from '@/composables/useProcedureRequirements'
import type { BedPoint } from '@/features/calibration/bedContext'
import { procedureById } from '@/features/calibration/procedures'
import { configuredScrews } from '@/features/calibration/screws'
import {
  isReachable,
  minimumScrews,
  nearestReachable,
  pointText,
  screwCoordinate,
  screwSections,
  screwWrite,
  type Reference,
  type ScrewTarget,
} from '@/features/calibration/toolheadPoints'
import { useCalibrationStore, type CalibrationLogEntry } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * The bed screws' coordinates, recorded by standing over each screw instead of
 * measuring the bed: jog the nozzle or the probe over a screw with the
 * Movement card, record it, and the next; the panel works out what the
 * section wants and writes every screw at once.
 *
 * Which of the two the reader stands over is theirs to choose, and the
 * conversion is the one easy thing to get backwards: `screws_tilt_adjust`
 * wants where to send the nozzle so the probe lands on the screw, and
 * `bed_screws` wants the nozzle over it. See `toolheadPoints.ts`.
 */
const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const requirements = useProcedureRequirements()
const selection = useCalibrationSelection()
const configWrite = useConfigWrite()

const requires = procedureById('screwPositions')?.requires ?? []
const ready = computed(() => requires.every((requirement) => requirements.value[requirement].met))

const targets = computed<ScrewTarget[]>(() =>
  (['screwsTilt', 'bedScrews'] as const).filter(
    (target) => printerConfig.section(screwSections[target]) !== null,
  ),
)
const chosenTarget = ref<ScrewTarget | null>(null)
const target = computed<ScrewTarget>(() =>
  chosenTarget.value !== null && targets.value.includes(chosenTarget.value)
    ? chosenTarget.value
    : (targets.value[0] ?? 'screwsTilt'),
)
const section = computed(() => screwSections[target.value])
const configured = computed(() => configuredScrews(printerConfig.section(section.value)))
/*
 * The lines the file holds, for names and for what a write removes. Klipper
 * reports "screw at x,y" as the name of a screw nobody named, so the settings
 * would prefill that as a name and write it back as if someone had chosen it.
 */
const written = computed(() => printerConfig.loadedConfig[section.value] ?? null)

// The live column draws the section being recorded, not the first one it finds.
watch(target, (value) => selection.setSubject('screwPositions', value), { immediate: true })

/* The probe is only the natural thing to stand over where the section is measured with it. */
const reference = ref<Reference>(printerConfig.hasProbe ? 'probe' : 'nozzle')
const offset = computed(() => printerConfig.probeOffset)

interface Recorded {
  toolhead: BedPoint
  name: string
}
const recorded = ref<Recorded[]>([])

watch(target, () => {
  recorded.value = []
  configWrite.forget()
})

function record(): void {
  const [x, y] = printer.motion.position
  if (typeof x !== 'number' || typeof y !== 'number') return
  const index = recorded.value.length + 1
  const name = written.value?.[`screw${index}_name`]
  recorded.value = [
    ...recorded.value,
    { toolhead: { x, y }, name: typeof name === 'string' ? name : '' },
  ]
  configWrite.forget()
}

function remove(index: number): void {
  recorded.value = recorded.value.filter((_, position) => position !== index)
  configWrite.forget()
}

const travel = computed(() => printer.buildVolume)

const screws = computed(() =>
  recorded.value.map((entry) => {
    const point = screwCoordinate(target.value, reference.value, entry.toolhead, offset.value)
    const reachable = isReachable(point, travel.value)
    return {
      point: reachable ? point : nearestReachable(point, travel.value),
      name: entry.name,
      reachable,
    }
  }),
)

const write = computed(() =>
  screwWrite(
    target.value,
    screws.value.map(({ point, name }) => ({ point, name })),
    written.value,
  ),
)

async function save(): Promise<void> {
  const outcome = await configWrite.write(
    'screws',
    section.value,
    write.value.changes,
    write.value.removes,
  )
  if (outcome === null || outcome === 'refused') return
  calibration.recordManual(
    'screwPositions',
    { section: section.value, reference: reference.value },
    screws.value.map((screw, index) => ({
      label: { literal: `screw${index + 1}` },
      before: configured.value[index] ? pointText(configured.value[index]) : null,
      after: pointText(screw.point),
    })),
    'measured',
  )
}

const saveOutcome = computed(() => configWrite.outcomeFor('screws'))

function historySummary(entry: CalibrationLogEntry): string {
  return `[${entry.values.section}] · ${t('calibration.screwPositions.count', { count: entry.rows.length })}`
}
</script>

<template>
  <CalibrationCard
    class="calibration-workspace"
    :title="t('calibration.procedure.screwPositions.name')"
  >
    <template #aside>
      <span class="calibration-workspace__command">[{{ section }}]</span>
      <span>{{ t('calibration.screwPositions.count', { count: configured.length }) }}</span>
    </template>
    <p class="calibration-workspace__description">
      {{ t('calibration.procedure.screwPositions.detail') }}
    </p>

    <CalibrationRequirements :requires="requires" />

    <div class="calibration-params">
      <fieldset v-if="targets.length > 1" class="calibration-choice">
        <legend class="calibration-choice__legend">
          {{ t('calibration.screwPositions.section') }}
        </legend>
        <label
          v-for="candidate in targets"
          :key="candidate"
          class="check-row check-row--block calibration-choice__row"
        >
          <input
            type="radio"
            name="screw-positions-section"
            :value="candidate"
            :checked="target === candidate"
            @change="chosenTarget = candidate"
          />
          <span>[{{ screwSections[candidate] }}]</span>
        </label>
      </fieldset>
      <fieldset v-if="printerConfig.hasProbe" class="calibration-choice">
        <legend class="calibration-choice__legend">
          {{ t('calibration.screwPositions.reference') }}
        </legend>
        <label class="check-row check-row--block calibration-choice__row">
          <input v-model="reference" type="radio" name="screw-positions-reference" value="nozzle" />
          <span>{{ t('calibration.screwPositions.nozzle') }}</span>
        </label>
        <label class="check-row check-row--block calibration-choice__row">
          <input v-model="reference" type="radio" name="screw-positions-reference" value="probe" />
          <span>{{ t('calibration.screwPositions.probe') }}</span>
        </label>
      </fieldset>
    </div>

    <ol class="calibration-steps">
      <li class="calibration-step">
        <span class="calibration-step__text">{{
          t(`calibration.screwPositions.stand.${reference}`, { index: recorded.length + 1 })
        }}</span>
        <div class="calibration-step__controls">
          <AppButton
            size="sm"
            icon="crosshair"
            :label="t('calibration.screwPositions.record', { index: recorded.length + 1 })"
            :disabled="!ready"
            @click="record"
          />
        </div>
      </li>
    </ol>
    <p class="calibration-panel__hint">{{ t('calibration.screwPositions.base') }}</p>

    <div v-if="screws.length > 0" class="calibration-result" role="status" aria-live="polite">
      <!--
        A list rather than a table: a name field beside four columns of values
        does not fit a phone, and each row wraps its field under its values.
      -->
      <ol class="calibration-screw-records">
        <li v-for="(screw, index) in screws" :key="index" class="calibration-screw-record">
          <span class="calibration-screw-record__values">
            <span class="calibration-workspace__command">screw{{ index + 1 }}</span>
            <span class="calibration-result__number">
              {{ configured[index] ? pointText(configured[index]!) : '—' }} →
              <span class="calibration-result__number--changed">{{ pointText(screw.point) }}</span>
            </span>
            <span v-if="!screw.reachable" class="calibration-panel__hint">
              {{ t('calibration.screwPositions.clamped') }}
            </span>
          </span>
          <span class="calibration-screw-record__controls">
            <AppField
              v-model="recorded[index]!.name"
              type="text"
              size="xs"
              :label="t('calibration.screwPositions.name')"
            />
            <AppButton
              size="xs"
              variant="quiet"
              icon-only
              icon="trash"
              :aria-label="t('calibration.screwPositions.remove', { index: index + 1 })"
              :title="t('calibration.screwPositions.remove', { index: index + 1 })"
              @click="remove(index)"
            />
          </span>
        </li>
      </ol>
      <p v-if="screws.length < minimumScrews" class="calibration-panel__hint">
        {{ t('calibration.screwPositions.tooFew', { count: minimumScrews }) }}
      </p>
      <div class="calibration-result__actions">
        <AppButton
          size="sm"
          variant="primary"
          icon="save"
          :label="t('calibration.npa.saveRestart')"
          :pending="configWrite.writing.value === 'screws'"
          :disabled="configWrite.disabled.value || screws.length < minimumScrews"
          @click="save"
        />
        <span v-if="saveOutcome" class="calibration-panel__hint">{{
          t(`calibration.result.persist.${saveOutcome}`)
        }}</span>
      </div>
    </div>

    <CalibrationHistory id="screwPositions" :summary="historySummary" />
  </CalibrationCard>
</template>
