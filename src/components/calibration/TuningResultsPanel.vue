<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import { useAvailability } from '@/composables/useAvailability'
import {
  newestTuningResult,
  resolveTuningComparison,
  resolveTuningSelection,
} from '@/features/calibration/tuningSelection'
import {
  latestShaperRecommendations,
  type ShaperRecommendation,
} from '@/features/calibration/shaperRecommendation'
import { createDateTimeFormatter } from '@/i18n/formats'
import { useAxesNoiseStore } from '@/stores/axesNoise'
import { useConsoleStore } from '@/stores/console'
import { useMacrosStore } from '@/stores/macros'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'
import {
  shakeTuneCategories,
  shakeTuneTriggerMacros,
  useShakeTuneStore,
  type ShakeTuneCategory,
  type ShakeTuneResult,
} from '@/stores/shakeTune'

const { locale, t } = useI18n({ useScope: 'global' })
const axesNoise = useAxesNoiseStore()
const gcodeConsole = useConsoleStore()
const macros = useMacrosStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const shakeTune = useShakeTuneStore()
const { availability: klipperAvailability } = useAvailability('klipper')
const { availability: moonrakerAvailability } = useAvailability('moonraker')

/*
 * The directory read lives with the panel that renders it rather than with the
 * page: the panel is mounted only while its own stage is selected, so a printer
 * whose config root is slow to answer is not polled for graphs nobody is
 * looking at. `stop()` on unmount is what makes selecting another stage stop
 * the poll rather than leaving it running behind a rail click.
 */
onMounted(() => {
  shakeTune.start()
})

onBeforeUnmount(() => {
  shakeTune.stop()
})

const canCommand = computed(() => klipperAvailability.value.isAvailable && !printer.hasActivePrint)

/**
 * `MEASURE_AXES_NOISE` is a native Klipper command from `[resonance_tester]`,
 * not a Shake&Tune macro — it exists whenever an accelerometer is configured
 * for resonance testing, whether or not Shake&Tune itself is installed. Config
 * presence is therefore the right gate, the same way `hasProbe`/`hasBedMesh`
 * read a section directly rather than asking `macros.hasMacro` about a command
 * nothing ever wrapped in a `[gcode_macro]`.
 */
const hasResonanceTester = computed(() => printerConfig.hasSection('resonance_tester'))

/**
 * These are power-spectral-density means, not a physical unit with an
 * established "too high" threshold Klipper documents anywhere Alabaster could
 * cite — so this only formats them for reading, at the same precision Klipper's
 * own `%.6f` prints, rather than judging or coloring them as good or bad on a
 * threshold nobody has confirmed.
 */
/*
 * Shake&Tune ends every input shaper run by printing its recommendation, and
 * that was the one place a finished run's actual product — a shaper and a
 * frequency per axis — existed: somebody had to copy it by hand into a
 * `SET_INPUT_SHAPER` line. Read from the transcript the docked console already
 * holds, so a run typed into the console counts the same as one started here.
 */
const shaperRecommendations = computed(() => latestShaperRecommendations(gcodeConsole.consoleLines))

/** `SET_INPUT_SHAPER` is registered only by `[input_shaper]`. */
const canApplyShaper = computed(() => printerConfig.hasSection('input_shaper'))

const frequencyFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)

function recommendationValue(recommendation: ShaperRecommendation): string {
  return t('calibration.tuning.shaper.value', {
    axis: recommendation.axis.toUpperCase(),
    shaper: recommendation.shaperType.toUpperCase(),
    frequency: frequencyFormatter.value.format(recommendation.frequency),
  })
}

function applyLabel(recommendation: ShaperRecommendation): string {
  return t('calibration.tuning.shaper.applyLabel', {
    axis: recommendation.axis.toUpperCase(),
    shaper: recommendation.shaperType.toUpperCase(),
    frequency: frequencyFormatter.value.format(recommendation.frequency),
  })
}

const noiseFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 6, maximumFractionDigits: 6 }),
)

function formatNoise(value: number): string {
  return noiseFormatter.value.format(value)
}

/**
 * `COMPARE_BELTS_RESPONSES` only means something on a printer whose two belts
 * drive the same two axes together — Shake&Tune's own docs warn it off any
 * other kinematics — but the dummy macro is registered unconditionally by the
 * extras module, so `macros.hasMacro` alone cannot tell CoreXY/CoreXZ from
 * cartesian or delta. This is the second, narrower gate `canRunTuning` applies
 * only to that one category.
 */
const isCoreKinematics = computed(() => {
  const kinematics = printerConfig.section('printer')?.kinematics
  return typeof kinematics === 'string' && /^corexy|^corexz/i.test(kinematics)
})

function canRunTuning(category: ShakeTuneCategory): boolean {
  const macroName = shakeTuneTriggerMacros[category]
  if (macroName === undefined || !macros.hasMacro(macroName)) return false
  if (category === 'belts') return isCoreKinematics.value
  return true
}

function isTuningRunning(category: ShakeTuneCategory): boolean {
  const macroName = shakeTuneTriggerMacros[category]
  return macroName !== undefined && macros.isRunning(macroName)
}

/**
 * `macros.run`, not `printer.sendMacro` directly: `run` is what tracks
 * `runningMacros`, which `isTuningRunning` above reads. Calling `sendMacro`
 * itself dispatches the command with no pending state anything could ever
 * observe — the button would never disable and would let a second click queue
 * right on top of one still running.
 */
function triggerTuning(category: ShakeTuneCategory): void {
  const macroName = shakeTuneTriggerMacros[category]
  if (macroName !== undefined) void macros.run(macroName)
}

const viewingResult = ref<ShakeTuneResult | null>(null)

const allResults = computed(() =>
  shakeTuneCategories.flatMap((category) => shakeTune.resultsByCategory[category]),
)

/*
 * One selection for the whole panel rather than one per category: the pane
 * shows one graph, or one comparison, and the rows are what choose it. A
 * comparison may cross categories on purpose — a belts graph beside an input
 * shaper graph is how "did tensioning the belts change the shaper result"
 * gets read.
 */
const requestedPath = ref<string | null>(null)
const comparisonPath = ref<string | null>(null)
const comparing = ref(false)

const primary = computed(() => resolveTuningSelection(requestedPath.value, allResults.value))
const comparison = computed(() =>
  comparing.value
    ? resolveTuningComparison(comparisonPath.value, allResults.value, primary.value)
    : null,
)

/*
 * A run that finishes presents its own graph. Only a result *newer* than the
 * previous newest counts: deleting the newest file also changes which result
 * is newest, and that must not yank the pane away from a graph somebody chose.
 */
watch(
  () => newestTuningResult(allResults.value),
  (next, previous) => {
    if (next && previous && next.modified > previous.modified && next.path !== previous.path) {
      requestedPath.value = next.path
    }
  },
)

function pick(result: ShakeTuneResult): void {
  if (comparing.value && result.path !== primary.value?.path) {
    comparisonPath.value = result.path
    return
  }
  requestedPath.value = result.path
  if (comparisonPath.value === result.path) comparisonPath.value = null
}

function toggleComparing(): void {
  comparing.value = !comparing.value
  if (!comparing.value) comparisonPath.value = null
}

const dateFormatter = computed(() => createDateTimeFormatter(locale.value))

function formatModified(result: ShakeTuneResult): string {
  return dateFormatter.value.format(result.modified * 1000)
}

function displayName(result: ShakeTuneResult): string {
  return result.name.replace(/\.png$/i, '')
}
</script>

<template>
  <section class="page-card calibration-panel" :aria-label="t('calibration.tuning.title')">
    <header class="calibration-panel__header">
      <div>
        <h2 class="calibration-panel__title">{{ t('calibration.tuning.title') }}</h2>
        <p class="calibration-panel__hint">{{ t('calibration.tuning.hint') }}</p>
      </div>
      <div class="calibration-panel__actions">
        <AppButton
          v-if="allResults.length > 1"
          size="xs"
          :label="t('calibration.tuning.compare')"
          :aria-pressed="comparing"
          @click="toggleComparing()"
        />
        <AppButton
          size="xs"
          :pending="shakeTune.isLoading"
          icon="refresh"
          :label="t('calibration.tuning.refresh')"
          :disabled="!moonrakerAvailability.isAvailable || shakeTune.isLoading"
          @click="shakeTune.refresh()"
        />
      </div>
    </header>

    <div class="calibration-tuning" :class="{ 'calibration-tuning--reading': primary !== null }">
      <!--
        The graph leads, in the markup as well as on screen, for the reason the
        bed stage's map does: a reader tabbing through reaches the artifact
        first, and a stacked narrow viewport opens on it rather than on the
        list that chooses it. Only the graphs on screen are fetched — the rows
        carry no image, because these PNGs are several megabytes each and are
        served by the printer's own host.
      -->
      <div
        v-if="primary"
        class="calibration-tuning__pane"
        :class="{ 'calibration-tuning__pane--comparing': comparing }"
      >
        <figure class="calibration-tuning__figure">
          <button
            type="button"
            class="brand-trigger calibration-tuning__graph"
            :aria-label="t('calibration.tuning.open', { name: primary.name })"
            @click="viewingResult = primary"
          >
            <img :src="primary.url" alt="" />
          </button>
          <figcaption class="calibration-tuning__caption">{{ primary.name }}</figcaption>
        </figure>
        <figure v-if="comparison" class="calibration-tuning__figure">
          <button
            type="button"
            class="brand-trigger calibration-tuning__graph"
            :aria-label="t('calibration.tuning.open', { name: comparison.name })"
            @click="viewingResult = comparison"
          >
            <img :src="comparison.url" alt="" />
          </button>
          <figcaption class="calibration-tuning__caption">{{ comparison.name }}</figcaption>
        </figure>
        <p v-else-if="comparing" class="calibration-panel__hint calibration-tuning__pick">
          {{ t('calibration.tuning.pickComparison') }}
        </p>
      </div>

      <div class="calibration-tuning__index">
        <!--
          Before spending the several minutes a real shaper test costs: a
          2-second read of background vibration, so a fan touching the toolhead
          or a loose mount shows up as noise here rather than as an unreadable
          graph afterward. A native Klipper command from `[resonance_tester]`,
          not a Shake&Tune macro — see `hasResonanceTester`'s own comment.
        -->
        <div v-if="hasResonanceTester" class="calibration-tuning-noise">
          <p class="calibration-panel__hint">{{ t('calibration.tuning.noiseHint') }}</p>
          <AppButton
            variant="quiet"
            size="xs"
            :pending="printer.pendingCommands.measureAxesNoise"
            icon="activity"
            :label="t('calibration.tuning.checkNoise')"
            :disabled="!canCommand || printer.pendingCommands.measureAxesNoise"
            @click="printer.measureAxesNoise()"
          />
          <ul v-if="axesNoise.hasReadings" class="calibration-noise-readings">
            <li v-for="reading in axesNoise.readings" :key="reading.chipAxis">
              {{
                t('calibration.tuning.noiseReading', {
                  axis: reading.chipAxis,
                  x: formatNoise(reading.x),
                  y: formatNoise(reading.y),
                  z: formatNoise(reading.z),
                })
              }}
            </li>
          </ul>
        </div>

        <div
          v-for="category in shakeTuneCategories"
          v-show="shakeTune.resultsByCategory[category].length > 0 || canRunTuning(category)"
          :key="category"
          class="calibration-tuning-group"
        >
          <header class="calibration-tuning-group__header">
            <h3 class="calibration-tuning-group__title">
              {{ t(`calibration.tuning.category.${category}`) }}
            </h3>
            <AppButton
              v-if="canRunTuning(category)"
              variant="quiet"
              size="xs"
              :pending="isTuningRunning(category)"
              icon="play"
              :label="t('calibration.tuning.run')"
              :disabled="!canCommand || isTuningRunning(category)"
              :aria-label="
                t('calibration.tuning.runLabel', {
                  category: t(`calibration.tuning.category.${category}`),
                })
              "
              @click="triggerTuning(category)"
            />
          </header>
          <div
            v-if="category === 'inputShaper' && shaperRecommendations.length > 0"
            class="calibration-shaper"
          >
            <ul class="calibration-shaper__list">
              <li
                v-for="recommendation in shaperRecommendations"
                :key="`${recommendation.axis}:${recommendation.kind}`"
                class="calibration-shaper__item"
              >
                <span class="calibration-shaper__reading">
                  <span class="calibration-shaper__value">
                    {{ recommendationValue(recommendation) }}
                  </span>
                  <span class="calibration-shaper__kind">
                    {{ t(`calibration.tuning.shaper.kind.${recommendation.kind}`) }}
                  </span>
                </span>
                <AppButton
                  v-if="canApplyShaper"
                  variant="quiet"
                  size="xs"
                  :label="t('calibration.tuning.shaper.apply')"
                  :aria-label="applyLabel(recommendation)"
                  :pending="printer.pendingCommands.inputShaper"
                  :disabled="!canCommand || printer.pendingCommands.inputShaper"
                  @click="printer.setInputShaper(recommendation)"
                />
              </li>
            </ul>
            <p v-if="canApplyShaper" class="calibration-panel__hint">
              {{ t('calibration.tuning.shaper.untilRestart') }}
            </p>
          </div>
          <ul
            v-if="shakeTune.resultsByCategory[category].length > 0"
            class="calibration-tuning-results"
          >
            <li v-for="result in shakeTune.resultsByCategory[category]" :key="result.path">
              <button
                type="button"
                class="file-select selection-row calibration-tuning-result"
                :class="{
                  'selection-row--selected': result.path === primary?.path,
                  'selection-row--compared': result.path === comparison?.path,
                }"
                :aria-current="result.path === primary?.path ? 'true' : undefined"
                :title="result.name"
                @click="pick(result)"
              >
                <span class="calibration-tuning-result__name">{{ displayName(result) }}</span>
                <span class="calibration-tuning-result__meta">
                  {{ formatModified(result) }}
                  <template v-if="result.path === comparison?.path">
                    · {{ t('calibration.tuning.compared') }}
                  </template>
                </span>
              </button>
            </li>
          </ul>
          <p v-else class="calibration-panel__hint">{{ t('calibration.tuning.empty') }}</p>
        </div>
      </div>
    </div>

    <ImageLightbox
      :open="viewingResult !== null"
      :src="viewingResult?.url ?? ''"
      :alt="viewingResult?.name ?? ''"
      @close="viewingResult = null"
    />
  </section>
</template>
