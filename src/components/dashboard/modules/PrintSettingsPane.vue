<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppField from '@/components/AppField.vue'
import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import PrintCardSettingsFields from '@/components/dashboard/modules/PrintCardSettingsFields.vue'
import PrintProgressSettingsFields from '@/components/dashboard/modules/PrintProgressSettingsFields.vue'
import {
  printEstimateSources,
  readPrintDriftThreshold,
  readPrintEstimateSource,
} from '@/components/dashboard/modules/printCardSettings'
import { configBoolean, useDashboardModule } from '@/dashboard/context'

/**
 * Print's full configuration, in three groups the card itself explains: what it
 * draws, what happens to the speed and flow factors when a job ends, and where
 * the remaining time comes from.
 *
 * Every control here is judged against the docked card. Switch the estimate
 * source and the percentage, bar, finish time and drift figure all move
 * together beside you, which is the whole reason these left the card's own
 * layer. "Use the slicer progress (M73)" is the tiebreaker for "Best available
 * source" only; picking a specific source implies its own progress basis and no
 * longer consults it.
 *
 * The promotable rows live in fields components shared with the card's quick
 * layer, so the two can never drift; each carries the pin that decides whether
 * it also appears there. The keys, defaults, and the estimate source's
 * allow-list this pane reads directly come from `printCardSettings.ts`, shared
 * with `PrintModule.vue` for the same reason.
 */
const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('print')

const resetOnComplete = computed(() => configBoolean(config.value, 'resetOnComplete', false))
const resetOnCancelled = computed(() => configBoolean(config.value, 'resetOnCancelled', false))
const resetOnError = computed(() => configBoolean(config.value, 'resetOnError', false))
const driftThreshold = computed(() => readPrintDriftThreshold(config.value))
/**
 * `AppField` holds the draft, which this pane needs more than most: it
 * re-renders on every status push while a print is running, because it asks
 * whether the slicer is reporting progress, and a field rendered from the stored
 * value was reset mid-word during exactly the job whose drift it configures.
 * The pane binds one-way and hears the finished value here.
 */
function commitDrift(value: number | null): void {
  updateConfig({ driftThresholdPercent: Math.max(0, value ?? 0) })
}

const preferredSource = computed(() => readPrintEstimateSource(config.value))

const skipStartWarning = computed(() => configBoolean(config.value, 'skipStartWarning', false))
const skipPauseWarning = computed(() => configBoolean(config.value, 'skipPauseWarning', false))
const skipCancelWarning = computed(() => configBoolean(config.value, 'skipCancelWarning', false))
</script>

<template>
  <SurfaceSection :title="t('dashboard.surface.cardSection')">
    <PrintCardSettingsFields mode="pane" />
  </SurfaceSection>

  <!--
    Unconditional now, and it used to be hidden with a block on this card. Both
    factors moved to the cards whose commands they scale — `M220` to Movement,
    `M221` to Extruder — but *when a job ends* is a print-lifecycle policy, not
    a property of either control, so the choice stays here. There is no longer a
    block on this card for it to hide with, and a reset that silently stopped
    being configurable because an unrelated toggle was off was the worse
    outcome: Klipper never clears these itself, so a factor left away from 100%
    carries into the next job either way.
  -->
  <!--
    Three independent settings, so three `.settings-row`s — not the tighter
    `.check-row` seam, which belongs to the alternatives of one setting the way
    the estimate sources below are. Movement's confirmations set the same rule.
  -->
  <SurfaceSection :title="t('dashboard.print.resetOnFinishTitle')" divided>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="resetOnComplete"
          @change="updateConfig({ resetOnComplete: !resetOnComplete })"
        />
        <span>{{ t('dashboard.print.resetOnComplete') }}</span>
      </label>
    </div>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="resetOnCancelled"
          @change="updateConfig({ resetOnCancelled: !resetOnCancelled })"
        />
        <span>{{ t('dashboard.print.resetOnCancelled') }}</span>
      </label>
    </div>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="resetOnError"
          @change="updateConfig({ resetOnError: !resetOnError })"
        />
        <span>{{ t('dashboard.print.resetOnError') }}</span>
      </label>
    </div>
  </SurfaceSection>

  <SurfaceSection :title="t('dashboard.print.progressTitle')" divided>
    <PrintProgressSettingsFields mode="pane" />

    <p class="surface-section__subtitle">{{ t('dashboard.print.estimateSource') }}</p>
    <label class="check-row">
      <input
        type="radio"
        name="print-estimate-source"
        :checked="preferredSource === 'auto'"
        @change="updateConfig({ estimateSource: 'auto' })"
      />
      <span>{{ t('dashboard.print.estimateAuto') }}</span>
    </label>
    <label v-for="source in printEstimateSources" :key="source" class="check-row">
      <input
        type="radio"
        name="print-estimate-source"
        :checked="preferredSource === source"
        @change="updateConfig({ estimateSource: source })"
      />
      <span>{{ t(`dashboard.print.estimate.${source}`) }}</span>
    </label>

    <!--
      A settings row like every other, so the field sits on the section's own
      rhythm rather than loose after the radios. The leading margin stays: the
      four sources above it are the alternatives of one setting, and this is the
      next setting, not the fifth alternative.
    -->
    <div class="settings-row mt-3">
      <AppField
        label-pos="front"
        :label="t('dashboard.print.driftThreshold')"
        :model-value="driftThreshold"
        :min="0"
        :max="100"
        :step="1"
        @commit="commitDrift"
      />
    </div>
  </SurfaceSection>

  <SurfaceSection :title="t('dashboard.print.confirmationsTitle')" divided>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="skipStartWarning"
          @change="updateConfig({ skipStartWarning: !skipStartWarning })"
        />
        <span>{{ t('dashboard.print.skipStartWarning') }}</span>
      </label>
    </div>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="skipPauseWarning"
          @change="updateConfig({ skipPauseWarning: !skipPauseWarning })"
        />
        <span>{{ t('dashboard.print.skipPauseWarning') }}</span>
      </label>
    </div>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="skipCancelWarning"
          @change="updateConfig({ skipCancelWarning: !skipCancelWarning })"
        />
        <span>{{ t('dashboard.print.skipCancelWarning') }}</span>
      </label>
    </div>
  </SurfaceSection>
</template>
