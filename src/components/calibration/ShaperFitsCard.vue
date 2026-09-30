<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import { shaperFits, type AxisFits, type ShaperFit } from '@/features/calibration/shaperFits'
import { useCalibrationStore } from '@/stores/calibration'
import { useConsoleStore } from '@/stores/console'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * Klipper's own shaper calibration as the comparison it computes: every
 * shaper it fitted per axis, with the vibration each leaves and the
 * acceleration each allows, the recommended one and the one in the file
 * marked in words. The recommendation weighs those two for a generic printer;
 * the reader who prints slowly and wants the least ringing, or fast and can
 * live with a little, is the one who can choose better — and without
 * Shake&Tune this is the only picture of the calibration there is.
 *
 * Read from this sitting's run, or else the newest calibration still in the
 * console transcript. The log keeps a run's recommendation rather than its
 * fits, so an older run shows only what it recommended.
 */
const { t, locale } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const gcodeConsole = useConsoleStore()
const printerConfig = usePrinterConfigStore()

const fromRun = computed(() => shaperFits(calibration.linesFor('shaperCalibrate')))
const fromTranscript = computed(() =>
  fromRun.value.length > 0
    ? []
    : shaperFits(
        gcodeConsole.consoleEntries
          .filter((entry) => entry.kind !== 'command')
          .map((entry) => entry.raw),
      ),
)
const axes = computed(() => (fromRun.value.length > 0 ? fromRun.value : fromTranscript.value))
const isRunning = computed(() => calibration.runFor('shaperCalibrate')?.running === true)

const logged = computed(() => {
  const history = calibration.historyFor('shaperCalibrate')
  const rows = history[history.length - 1]?.rows ?? []
  return (['x', 'y'] as const).flatMap((axis) => {
    const find = (option: string) =>
      rows.find((row) => 'literal' in row.label && row.label.literal === `${option}_${axis}`)?.after
    const type = find('shaper_type')
    const frequency = find('shaper_freq')
    return type && frequency ? [{ axis, type, frequency }] : []
  })
})

function inFile(axis: 'x' | 'y', name: string): boolean {
  const settings = printerConfig.section('input_shaper')
  const configured = settings?.[`shaper_type_${axis}`] ?? settings?.shaper_type
  return typeof configured === 'string' && configured.toLowerCase() === name
}

const decimal = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)
const smoothingFormat = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
)
const whole = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }))

function share(value: number | null, of: number): string {
  if (value === null || of <= 0) return '0%'
  return `${Math.max((value / of) * 100, 2)}%`
}

function scale(axis: AxisFits): { vibrations: number; maxAccel: number } {
  return {
    vibrations: Math.max(...axis.fits.map((fit) => fit.vibrations)),
    maxAccel: Math.max(...axis.fits.map((fit) => fit.maxAccel ?? 0)),
  }
}

function recommended(axis: AxisFits): ShaperFit | undefined {
  return axis.fits.find((fit) => fit.name === axis.recommended)
}
</script>

<template>
  <CalibrationCard :title="t('calibration.context.fits.title')">
    <template v-if="axes.length === 0 && logged.length > 0" #aside>
      <span class="calibration-context__aside">{{ t('calibration.context.samples.lastRun') }}</span>
    </template>

    <template v-if="axes.length > 0">
      <section
        v-for="axis in axes"
        :key="axis.axis"
        class="calibration-fits"
        :aria-label="t('calibration.context.fits.axis', { axis: axis.axis.toUpperCase() })"
      >
        <h3 class="calibration-fits__axis">
          {{ t('calibration.context.fits.axis', { axis: axis.axis.toUpperCase() }) }}
          <span v-if="recommended(axis)" class="calibration-fits__verdict">
            {{
              t('calibration.context.fits.verdict', {
                shaper: axis.recommended,
                frequency: decimal.format(recommended(axis)!.frequency),
              })
            }}
          </span>
        </h3>
        <div class="calibration-fits__scroll">
          <table class="calibration-fits__table">
            <thead>
              <tr>
                <th scope="col">{{ t('calibration.context.fits.shaper') }}</th>
                <th scope="col">{{ t('calibration.context.fits.frequency') }}</th>
                <th scope="col">{{ t('calibration.context.fits.vibrations') }}</th>
                <th scope="col">{{ t('calibration.context.fits.smoothing') }}</th>
                <th scope="col">{{ t('calibration.context.fits.maxAccel') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="fit in axis.fits"
                :key="fit.name"
                :class="{ 'calibration-fits__row--recommended': fit.name === axis.recommended }"
              >
                <th scope="row">
                  <span class="calibration-fits__name">{{ fit.name }}</span>
                  <span
                    v-if="fit.name === axis.recommended"
                    class="calibration-fits__mark calibration-fits__mark--recommended"
                  >
                    {{ t('calibration.context.fits.recommended') }}
                  </span>
                  <span v-if="inFile(axis.axis, fit.name)" class="calibration-fits__mark">
                    {{ t('calibration.context.fits.inFile') }}
                  </span>
                </th>
                <td>
                  {{
                    t('calibration.context.fits.hertz', { value: decimal.format(fit.frequency) })
                  }}
                </td>
                <td>
                  <span class="calibration-fits__meter">
                    <span
                      class="calibration-fits__bar calibration-fits__bar--vibrations"
                      :style="{ inlineSize: share(fit.vibrations, scale(axis).vibrations) }"
                    ></span>
                    <span>{{
                      t('calibration.context.fits.percent', {
                        value: decimal.format(fit.vibrations),
                      })
                    }}</span>
                  </span>
                </td>
                <td>{{ smoothingFormat.format(fit.smoothing) }}</td>
                <td>
                  <span class="calibration-fits__meter">
                    <span
                      class="calibration-fits__bar"
                      :style="{ inlineSize: share(fit.maxAccel, scale(axis).maxAccel) }"
                    ></span>
                    <span>{{
                      fit.maxAccel === null
                        ? t('calibration.context.fits.none')
                        : t('calibration.context.fits.accel', { value: whole.format(fit.maxAccel) })
                    }}</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <dl v-else-if="logged.length > 0" class="calibration-context__facts">
      <div v-for="entry in logged" :key="entry.axis" class="calibration-context__fact">
        <dt>{{ t('calibration.context.fits.axis', { axis: entry.axis.toUpperCase() }) }}</dt>
        <dd>
          {{
            t('calibration.context.fits.verdict', {
              shaper: entry.type,
              frequency: entry.frequency,
            })
          }}
        </dd>
      </div>
    </dl>

    <p v-else class="calibration-panel__hint">
      {{ isRunning ? t('calibration.context.fits.waiting') : t('calibration.context.fits.empty') }}
    </p>
  </CalibrationCard>
</template>
