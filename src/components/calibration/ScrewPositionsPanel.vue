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
import { useScrewRecording } from '@/composables/useScrewRecording'
import { procedureById } from '@/features/calibration/procedures'
import { configuredScrews } from '@/features/calibration/screws'
import {
  minimumScrews,
  pointText,
  screwSections,
  screwWrite,
  type ScrewTarget,
} from '@/features/calibration/toolheadPoints'
import { useCalibrationStore, type CalibrationLogEntry } from '@/stores/calibration'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * The bed screws' coordinates, recorded by standing over each screw instead of
 * measuring the bed: jog the nozzle or the probe over a screw with the
 * Movement card, or click a screw on the bed drawing to go there, and record
 * it; the panel works out what the section wants and writes every screw at
 * once.
 *
 * The list starts as the screws the file already holds, so fixing one screw is
 * standing over it and re-recording it rather than recording every screw
 * again. Which part stands over a screw is chosen per screw, and the
 * conversion is the one easy thing to get backwards: `screws_tilt_adjust`
 * wants where to send the nozzle so the probe lands on the screw, and
 * `bed_screws` wants the nozzle over it. See `toolheadPoints.ts`. The list
 * itself lives in `useScrewRecording`, which the bed drawing reads too.
 */
const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
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

const recording = useScrewRecording(target)
const { reference, screws, nearest } = recording

/*
 * The file's screws replace the list whenever nothing has been changed in it
 * yet — on opening, on switching section, when the config first arrives, and
 * after a save's restart reads back what was written. A list with changes in
 * it is never replaced under the reader.
 */
watch(
  () => [target.value, JSON.stringify(configured.value), JSON.stringify(written.value)],
  (now, before) => {
    if (now[0] !== before?.[0]) configWrite.forget()
    if (recording.isFor.value && recording.touched.value) return
    recording.seed(configured.value, written.value)
  },
  { immediate: true },
)

function record(): void {
  const name = written.value?.[`screw${screws.value.length + 1}_name`]
  recording.record(typeof name === 'string' ? name : '')
  configWrite.forget()
}

function rerecordNearest(): void {
  recording.rerecordNearest()
  configWrite.forget()
}

function remove(index: number): void {
  recording.remove(index)
  configWrite.forget()
}

function startOver(): void {
  recording.clear()
  configWrite.forget()
}

function screwLabel(index: number): string {
  return screws.value[index]?.name.trim() || `screw${index + 1}`
}

const changed = computed(() => recording.differsFrom(configured.value, written.value))

function isChanged(index: number): boolean {
  const before = configured.value[index]
  const screw = screws.value[index]
  return !before || !screw || pointText(before) !== pointText(screw.coordinate)
}

const write = computed(() =>
  screwWrite(
    target.value,
    screws.value.map(({ coordinate, name }) => ({ point: coordinate, name })),
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
  recording.settle()
  calibration.recordManual(
    'screwPositions',
    { section: section.value },
    screws.value.map((screw, index) => ({
      label: { literal: `screw${index + 1}` },
      before: configured.value[index] ? pointText(configured.value[index]) : null,
      after: pointText(screw.coordinate),
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
          t(`calibration.screwPositions.stand.${reference}`)
        }}</span>
        <!--
          Re-record names the screw it would replace — the one the chosen part
          is closest to, which the bed drawing marks too — so the press says
          what it will overwrite before it does.
        -->
        <div class="calibration-step__controls">
          <AppButton
            v-if="nearest !== null"
            size="sm"
            icon="crosshair"
            :label="t('calibration.screwPositions.rerecord', { name: screwLabel(nearest) })"
            :disabled="!ready"
            @click="rerecordNearest"
          />
          <AppButton
            size="sm"
            icon="add"
            :label="t('calibration.screwPositions.record', { index: screws.length + 1 })"
            :disabled="!ready || recording.toolhead.value === null"
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
              <span :class="{ 'calibration-result__number--changed': isChanged(index) }">{{
                pointText(screw.coordinate)
              }}</span>
            </span>
            <span v-if="screw.reference" class="calibration-panel__hint">
              {{ t(`calibration.screwPositions.stoodWith.${screw.reference}`) }}
            </span>
            <span v-if="!screw.reachable" class="calibration-panel__hint">
              {{ t('calibration.screwPositions.clamped') }}
            </span>
          </span>
          <span class="calibration-screw-record__controls">
            <AppField
              :model-value="screw.name"
              type="text"
              size="xs"
              :label="t('calibration.screwPositions.name')"
              @update:model-value="recording.rename(index, String($event))"
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
          :disabled="configWrite.disabled.value || !changed || screws.length < minimumScrews"
          @click="save"
        />
        <AppButton
          size="sm"
          variant="quiet"
          icon="reset"
          :label="t('calibration.screwPositions.startOver')"
          @click="startOver"
        />
        <span v-if="saveOutcome" class="calibration-panel__hint">{{
          t(`calibration.result.persist.${saveOutcome}`)
        }}</span>
      </div>
    </div>

    <CalibrationHistory id="screwPositions" :summary="historySummary" />
  </CalibrationCard>
</template>
