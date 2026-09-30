<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppSelect from '@/components/AppSelect.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import DisclosureReveal from '@/components/DisclosureReveal.vue'
import {
  axisCrossCheck,
  beltKinematics,
  beltsFor,
  beltVerdict,
  modelTolerance,
  parsePeaks,
  type AxisCheck,
} from '@/features/calibration/beltGuide'
import { useBeltGuideStore, type BeltGuideValues } from '@/stores/beltGuide'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * The belt comparison, read: what the graph can and cannot say, and a verdict
 * from the peaks the reader types off it.
 *
 * Shut until asked for, because a reader who already knows how to read the
 * graph has no use for it, and it sits under the graph rather than above it
 * because its inputs are read off that graph. Nothing here is sent to the
 * printer: the peaks are the reader's own reading of a PNG, kept with the
 * masses per printer by `stores/beltGuide.ts`, and the verdicts are the pure
 * functions in `features/calibration/beltGuide.ts`.
 */

const { locale, t } = useI18n({ useScope: 'global' })
const printerConfig = usePrinterConfigStore()
const beltGuide = useBeltGuideStore()

const kinematics = computed(() => {
  const value = printerConfig.section('printer')?.kinematics
  return beltKinematics(typeof value === 'string' ? value : null)
})
const belts = computed(() => (kinematics.value ? beltsFor(kinematics.value) : null))

const open = ref(false)

function field<K extends keyof BeltGuideValues>(key: K) {
  return computed<BeltGuideValues[K]>({
    get: () => beltGuide.values[key],
    set: (value) => beltGuide.update({ [key]: value }),
  })
}

const firstText = field('firstPeaks')
const secondText = field('secondPeaks')
const unpaired = field('unpaired')
const toolheadGrams = field('toolheadGrams')
const gantryGrams = field('gantryGrams')
const measuredX = field('xPeak')
const measuredY = field('yPeak')
const atTarget = computed<string>({
  get: () => (beltGuide.values.atTarget === null ? '' : String(beltGuide.values.atTarget)),
  set: (value) => beltGuide.update({ atTarget: value === '0' ? 0 : value === '1' ? 1 : null }),
})

const firstPeaks = computed(() => parsePeaks(firstText.value))
const secondPeaks = computed(() => parsePeaks(secondText.value))

const verdict = computed(() =>
  beltVerdict({
    first: firstPeaks.value ?? [],
    second: secondPeaks.value ?? [],
    unpaired: unpaired.value,
    atTarget: atTarget.value === '0' ? 0 : atTarget.value === '1' ? 1 : null,
  }),
)

const targetOptions = computed(() => [
  { value: '', label: t('calibration.beltGuide.atTargetNone') },
  ...(belts.value ?? []).map((belt, index) => ({
    value: String(index),
    label: t('calibration.beltGuide.atTargetBelt', { name: belt.name }),
  })),
])

const percent = computed(
  () => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }),
)
const hertz = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }))
// A prediction good to 15% has no business showing a tenth of a hertz.
const wholeHertz = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }))

function signedPercent(value: number): string {
  return new Intl.NumberFormat(locale.value, {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  }).format(value)
}

function beltName(index: 0 | 1): string {
  return belts.value?.[index].name ?? ''
}

const verdictText = computed(() => {
  const v = verdict.value
  if (v.kind === 'incomplete') return null
  if (v.kind === 'beltPath') {
    return {
      title: t('calibration.beltGuide.verdict.beltPathTitle'),
      body: t('calibration.beltGuide.verdict.beltPath', { count: v.unpaired }),
      icon: 'warning' as const,
    }
  }
  if (v.kind === 'disagree') {
    return {
      title: t('calibration.beltGuide.verdict.disagreeTitle'),
      body: t('calibration.beltGuide.verdict.disagree', {
        first: beltName(0),
        second: beltName(1),
      }),
      icon: 'warning' as const,
    }
  }
  if (v.kind === 'matched') {
    return {
      title: t('calibration.beltGuide.verdict.matchedTitle'),
      body: t('calibration.beltGuide.verdict.matched', {
        offset: percent.value.format(v.offset),
      }),
      icon: 'check' as const,
    }
  }
  const names = { looser: beltName(v.looser), tighter: beltName(v.looser === 0 ? 1 : 0) }
  return {
    title: t('calibration.beltGuide.verdict.looserTitle', { name: names.looser }),
    body: [
      t('calibration.beltGuide.verdict.looser', { offset: percent.value.format(v.offset) }),
      t(`calibration.beltGuide.verdict.${v.action}`, names),
    ].join(' '),
    icon: 'adjust' as const,
  }
})

const pairs = computed(() => {
  const v = verdict.value
  return v.kind === 'matched' || v.kind === 'looser' || v.kind === 'disagree' ? v.pairs : []
})

const lowestPair = computed(() => pairs.value[0] ?? null)

const crossCheck = computed(() => {
  if (!lowestPair.value || toolheadGrams.value === null || gantryGrams.value === null) return null
  return axisCrossCheck({
    pair: lowestPair.value,
    toolheadGrams: toolheadGrams.value,
    gantryGrams: gantryGrams.value,
    measuredX: measuredX.value,
    measuredY: measuredY.value,
  })
})

const crossRows = computed(() => {
  const check = crossCheck.value
  if (!check) return []
  return (
    [
      ['X', check.x],
      ['Y', check.y],
    ] as const
  ).map(([axis, row]: readonly [string, AxisCheck]) => ({ axis, ...row }))
})

const crossVerdicts = computed(() =>
  crossRows.value.flatMap((row) => (row.verdict ? [{ axis: row.axis, verdict: row.verdict }] : [])),
)
const crossMessage = computed(() => {
  if (!lowestPair.value) return t('calibration.beltGuide.cross.needsPair')
  if (!crossCheck.value) return t('calibration.beltGuide.cross.needsMasses')
  return null
})
</script>

<template>
  <CalibrationCard v-if="belts" :title="t('calibration.beltGuide.title')" flush>
    <template #aside>
      <AppButton
        variant="quiet"
        size="xs"
        icon-only
        :icon="open ? 'collapse' : 'expand'"
        :aria-expanded="open"
        aria-controls="belt-guide-body"
        :title="open ? t('calibration.beltGuide.collapse') : t('calibration.beltGuide.expand')"
        :aria-label="open ? t('calibration.beltGuide.collapse') : t('calibration.beltGuide.expand')"
        @click="open = !open"
      />
    </template>

    <DisclosureReveal :open="open">
      <div id="belt-guide-body" class="calibration-belt-guide">
        <ul class="calibration-belt-guide__notes">
          <li>{{ t('calibration.beltGuide.toothCount') }}</li>
          <li>{{ t('calibration.beltGuide.unpairedSource') }}</li>
          <li>{{ t('calibration.beltGuide.lowerIsLooser') }}</li>
          <li>{{ t('calibration.beltGuide.notTension') }}</li>
        </ul>

        <p class="calibration-belt-guide__steppers">
          <span v-for="belt in belts" :key="belt.name" class="calibration-belt-guide__stepper">
            {{ t('calibration.beltGuide.beltStepper', { name: belt.name, stepper: belt.stepper }) }}
          </span>
        </p>

        <div class="calibration-params">
          <div>
            <AppField
              v-model="firstText"
              type="text"
              size="sm"
              :label="t('calibration.beltGuide.peaks', { name: belts[0].name })"
              :unit="t('calibration.unit.hertz')"
              :placeholder="t('calibration.beltGuide.peaksPlaceholderFirst')"
            />
            <p v-if="firstPeaks === null" class="calibration-panel__hint" role="alert">
              {{ t('calibration.beltGuide.peaksInvalid') }}
            </p>
          </div>
          <div>
            <AppField
              v-model="secondText"
              type="text"
              size="sm"
              :label="t('calibration.beltGuide.peaks', { name: belts[1].name })"
              :unit="t('calibration.unit.hertz')"
              :placeholder="t('calibration.beltGuide.peaksPlaceholderSecond')"
            />
            <p v-if="secondPeaks === null" class="calibration-panel__hint" role="alert">
              {{ t('calibration.beltGuide.peaksInvalid') }}
            </p>
          </div>
          <AppField
            v-model="unpaired"
            type="number"
            size="sm"
            :label="t('calibration.beltGuide.unpaired')"
            :min="0"
            :max="99"
            :step="1"
          />
          <AppSelect
            v-model="atTarget"
            :options="targetOptions"
            :label="t('calibration.beltGuide.atTarget')"
          />
        </div>

        <div v-if="verdictText" class="calibration-result" role="status" aria-live="polite">
          <div class="calibration-result__head">
            <h3 class="calibration-result__title calibration-belt-guide__verdict">
              <AppIcon :name="verdictText.icon" class="size-4 shrink-0" aria-hidden="true" />
              {{ verdictText.title }}
            </h3>
          </div>
          <p class="calibration-belt-guide__body">{{ verdictText.body }}</p>
          <table v-if="pairs.length > 0" class="calibration-result__table">
            <thead>
              <tr>
                <th scope="col">{{ t('calibration.beltGuide.belt', { name: belts[0].name }) }}</th>
                <th scope="col">{{ t('calibration.beltGuide.belt', { name: belts[1].name }) }}</th>
                <th scope="col">{{ t('calibration.beltGuide.gap') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pair in pairs" :key="`${pair.first}-${pair.second}`">
                <td class="calibration-result__number">{{ hertz.format(pair.first) }}</td>
                <td class="calibration-result__number">{{ hertz.format(pair.second) }}</td>
                <td class="calibration-result__number">
                  {{ hertz.format(Math.abs(pair.second - pair.first)) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="calibration-panel__hint">
          {{ t('calibration.beltGuide.verdict.incomplete') }}
        </p>

        <section
          v-if="kinematics === 'corexy'"
          class="calibration-belt-guide__cross"
          :aria-label="t('calibration.beltGuide.cross.title')"
        >
          <h3 class="calibration-result__title">{{ t('calibration.beltGuide.cross.title') }}</h3>
          <p class="calibration-panel__hint">{{ t('calibration.beltGuide.cross.hint') }}</p>
          <div class="calibration-params">
            <AppField
              v-model="toolheadGrams"
              type="number"
              size="sm"
              :label="t('calibration.beltGuide.cross.toolheadMass')"
              :unit="t('calibration.unit.grams')"
              :min="1"
              :max="20000"
            />
            <AppField
              v-model="gantryGrams"
              type="number"
              size="sm"
              :label="t('calibration.beltGuide.cross.gantryMass')"
              :unit="t('calibration.unit.grams')"
              :min="0"
              :max="20000"
            />
            <AppField
              v-model="measuredX"
              type="number"
              size="sm"
              :label="t('calibration.beltGuide.cross.xPeak')"
              :unit="t('calibration.unit.hertz')"
              :min="1"
              :max="1000"
            />
            <AppField
              v-model="measuredY"
              type="number"
              size="sm"
              :label="t('calibration.beltGuide.cross.yPeak')"
              :unit="t('calibration.unit.hertz')"
              :min="1"
              :max="1000"
            />
          </div>

          <p v-if="crossMessage" class="calibration-panel__hint">{{ crossMessage }}</p>
          <div v-else class="calibration-result" role="status" aria-live="polite">
            <table class="calibration-result__table">
              <thead>
                <tr>
                  <th scope="col">{{ t('calibration.beltGuide.cross.axis') }}</th>
                  <th scope="col">{{ t('calibration.beltGuide.cross.expected') }}</th>
                  <th scope="col">{{ t('calibration.beltGuide.cross.measured') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in crossRows" :key="row.axis">
                  <th scope="row">{{ row.axis }}</th>
                  <td class="calibration-result__number">
                    {{ wholeHertz.format(row.expected) }} {{ t('calibration.unit.hertz') }}
                  </td>
                  <td class="calibration-result__number">
                    <template v-if="row.measured !== null && row.offset !== null">
                      {{ hertz.format(row.measured) }} {{ t('calibration.unit.hertz') }} ({{
                        signedPercent(row.offset)
                      }})
                    </template>
                    <template v-else>—</template>
                  </td>
                </tr>
              </tbody>
            </table>
            <p
              v-for="row in crossVerdicts"
              :key="row.axis"
              class="calibration-belt-guide__body calibration-belt-guide__verdict"
            >
              <AppIcon
                :name="row.verdict === 'belts' ? 'check' : 'warning'"
                class="size-4 shrink-0"
                aria-hidden="true"
              />
              <span>{{ t(`calibration.beltGuide.cross.${row.verdict}`, { axis: row.axis }) }}</span>
            </p>
            <p class="calibration-panel__hint">
              {{
                t('calibration.beltGuide.cross.accuracy', {
                  tolerance: percent.format(modelTolerance),
                })
              }}
            </p>
          </div>
        </section>
      </div>
    </DisclosureReveal>
  </CalibrationCard>
</template>
