<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import { useAvailability } from '@/composables/useAvailability'
import { useAxesNoiseStore } from '@/stores/axesNoise'
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
 * own `%.6f` prints, rather than judging or colouring them as good or bad on a
 * threshold nobody has confirmed.
 */
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
</script>

<template>
  <section class="page-card calibration-panel" :aria-label="t('calibration.tuning.title')">
    <header class="calibration-panel__header">
      <div>
        <h2 class="calibration-panel__title">{{ t('calibration.tuning.title') }}</h2>
        <p class="calibration-panel__hint">{{ t('calibration.tuning.hint') }}</p>
      </div>
      <AppButton
        size="xs"
        :pending="shakeTune.isLoading"
        icon="refresh"
        :label="t('calibration.tuning.refresh')"
        :disabled="!moonrakerAvailability.isAvailable || shakeTune.isLoading"
        @click="shakeTune.refresh()"
      />
    </header>

    <!--
      Before spending the several minutes a real shaper test costs: a 2-second
      read of background vibration, so a fan touching the toolhead or a loose
      mount shows up as noise here rather than as an unreadable graph afterward.
      A native Klipper command from `[resonance_tester]`, not a Shake&Tune macro
      — see `hasResonanceTester`'s own comment.
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
      <ul v-if="shakeTune.resultsByCategory[category].length > 0" class="calibration-tuning-strip">
        <li v-for="result in shakeTune.resultsByCategory[category]" :key="result.path">
          <button
            type="button"
            class="calibration-tuning-thumb"
            :aria-label="t('calibration.tuning.open', { name: result.name })"
            @click="viewingResult = result"
          >
            <img :src="result.url" :alt="result.name" loading="lazy" />
          </button>
        </li>
      </ul>
      <p v-else class="calibration-panel__hint">{{ t('calibration.tuning.empty') }}</p>
    </div>

    <ImageLightbox
      :open="viewingResult !== null"
      :src="viewingResult?.url ?? ''"
      :alt="viewingResult?.name ?? ''"
      @close="viewingResult = null"
    />
  </section>
</template>
