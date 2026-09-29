<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import PageHeading from '@/components/PageHeading.vue'
import AxesStage from '@/components/calibration/AxesStage.vue'
import BedStage from '@/components/calibration/BedStage.vue'
import CalibrationStageTabs from '@/components/calibration/CalibrationStageTabs.vue'
import ExtrusionStage from '@/components/calibration/ExtrusionStage.vue'
import HeatersStage from '@/components/calibration/HeatersStage.vue'
import ResonanceStage from '@/components/calibration/ResonanceStage.vue'
import ConsolePanel from '@/components/console/ConsolePanel.vue'
import { useCalibrationSelection } from '@/composables/useCalibrationSelection'
import {
  availableCalibrationStages,
  resolveCalibrationStage,
  type CalibrationStageId,
} from '@/features/calibration/stages'
import { useCalibrationStore } from '@/stores/calibration'
import { useEndstopsStore } from '@/stores/endstops'
import { useMacrosStore } from '@/stores/macros'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useRunoutSensorsStore } from '@/stores/runoutSensors'
import { shakeTuneTriggerMacros, useShakeTuneStore } from '@/stores/shakeTune'
import { useTelemetryStore } from '@/stores/telemetry'

/**
 * Calibration: getting the machine physically right, one job at a time.
 *
 * This page used to be every panel it owns, all mounted at once, arranged as a
 * wrapping flex row. Two things were wrong with that, and they had the same
 * cause. Nothing on the page said what the page was *for*, because a bag of
 * readouts has no order to read it in — and every panel here reported state
 * while every command that changes that state lived on another route: levelling
 * and the Z offset on the Movement card, heater models behind the Temperatures
 * card's gear, and the console text all of them answer in on the Console page.
 * A calibration sitting was therefore a tour of the application.
 *
 * So the page is a bench now. A tab strip lists the jobs this printer can be
 * calibrated for, in the order the physical dependencies run. A selected stage
 * lists its procedures — the calibrations this printer can run there, from
 * `features/calibration/procedures.ts` — opens one in a workspace that shows
 * what it needs, runs it, and reads what it found out of the console into a
 * result set against the printer's previous value; the dashboard modules those
 * procedures act on stay live beside it. One console sits under all of it,
 * because Klipper answers in console text and the raw lines are sometimes the
 * thing worth reading.
 *
 * What deliberately did *not* move here: `SAVE_CONFIG`. A calibration stages a
 * change and the header offers to write it, once, for the whole application —
 * `App.vue`'s own comment holds why that is one printer-wide fact rather than a
 * button per surface that staged something.
 */
const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const endstops = useEndstopsStore()
const macros = useMacrosStore()
const printerConfig = usePrinterConfigStore()
const runoutSensors = useRunoutSensorsStore()
const shakeTune = useShakeTuneStore()
const telemetry = useTelemetryStore()

/*
 * The endstop poll belongs to the page rather than to its panel: it is a
 * couple-of-seconds read while the printer is idle, and stopping it every time
 * the user looks at another stage would make the readings on the axes stage
 * cold the moment they came back to it.
 */
onMounted(() => {
  endstops.start()
  calibration.start()
})

onBeforeUnmount(() => {
  endstops.stop()
  calibration.stop()
})

/**
 * Whether Shake&Tune is installed at all, independent of having run anything
 * yet. The resonance stage also appears for a machine with a bare
 * `[resonance_tester]` and no Shake&Tune, and for one with graphs on disk from
 * a Shake&Tune that has since been removed.
 */
const hasShakeTuneMacros = computed(() =>
  Object.values(shakeTuneTriggerMacros).some(
    (macroName) => macroName !== undefined && macros.hasMacro(macroName),
  ),
)

const stages = computed(() =>
  availableCalibrationStages({
    hasBedMesh: printerConfig.hasBedMesh,
    hasProbe: printerConfig.hasProbe,
    hasLeveling: printerConfig.levelingMethods.length > 0,
    hasCalibratableHeater: telemetry.sensors.some(
      (sensor) =>
        sensor.isSettable &&
        ['pid', 'mpc'].includes(printerConfig.controlKindFor(sensor.objectName) ?? ''),
    ),
    hasResonance:
      printerConfig.hasSection('resonance_tester') ||
      hasShakeTuneMacros.value ||
      shakeTune.hasAnyResults,
    hasExtruder: printerConfig.hasSection('extruder'),
    hasRunoutSensors: runoutSensors.hasSensors,
  }),
)

/**
 * The selected stage is in-memory state, deliberately not a route query.
 *
 * A query would have made a stage a link somebody could keep, which is worth
 * something — but `App.vue` keys the routed component on `route.fullPath`
 * inside a crossfade, so *any* query change unmounts and remounts the whole
 * page. On this page that is the opposite of the point: the console docked
 * below would lose its scroll position and any half-typed command on every
 * stage switch, which is the same continuity Alabaster protects across a Klipper
 * restart. No route uses a query today, so this is the first place that trap
 * could have been stepped in; a stage in local state avoids it without changing
 * how every other route behaves.
 *
 * It outlives the page (see `useCalibrationSelection`), so coming back from
 * another route opens the stage that was open.
 *
 * Resolved rather than read straight back, because the stage list is live: a
 * printer that loses the component behind the selected stage mid-sitting — a
 * Shake&Tune uninstall, a config reload without `[bed_mesh]` — falls back to
 * the first available stage instead of rendering an empty canvas.
 */
const { stage: requestedStage } = useCalibrationSelection()
const activeStage = computed(() => resolveCalibrationStage(requestedStage.value, stages.value))

function selectStage(stage: CalibrationStageId): void {
  requestedStage.value = stage
}

/**
 * The console dock, closed by default. A procedure's result and its own
 * output are in its workspace now, so the transcript is what somebody opens
 * when they want the raw lines, not something every stage has to make room
 * for. The toggle is a bar on the page itself rather than the page heading's
 * action: a reader who hides page headers gets the heading's action folded
 * into a floating menu, which is easy to miss for the one control that brings
 * the console back. Held in memory rather than in the query — it is a device
 * ergonomic, not something worth putting in a shared link.
 */
const consoleOpen = ref(false)
</script>

<template>
  <section class="standard-page calibration-view">
    <PageHeading :title="t('calibration.title')" />

    <CalibrationStageTabs :stages="stages" :active="activeStage" @select="selectStage($event)" />

    <div class="calibration-canvas">
      <!--
        Klipper's own requirement, not this page's: every command on every
        stage here moves a motor, drives a heater, or reads a probe, so the
        stages live inside one `klipper` region rather than each panel
        declaring its own. The console below is deliberately outside it — see
        its own region.
      -->
      <AvailabilityRegion requires="klipper">
        <!--
          `:key` on the stage, so switching stages mounts the new one clean
          rather than letting a shared child keep the previous stage's state.
          It is also what stops a poll belonging to one stage — Shake&Tune's
          directory read — from running behind another.
        -->
        <div :key="activeStage" :aria-label="t(`calibration.stages.${activeStage}`)" role="region">
          <AxesStage v-if="activeStage === 'axes'" />
          <BedStage v-else-if="activeStage === 'bed'" />
          <HeatersStage v-else-if="activeStage === 'heaters'" />
          <ResonanceStage v-else-if="activeStage === 'resonance'" />
          <ExtrusionStage v-else-if="activeStage === 'extrusion'" />
        </div>
      </AvailabilityRegion>

      <!--
        A `moonraker`-only region rather than folding into the one above: the
        transcript is a buffer this browser already holds, and a printer
        mid-restart is exactly when somebody wants to read the line that
        preceded it. The prompt inside disables itself on its own when Klipper
        is not there to take a command.
      -->
      <AppButton
        variant="quiet"
        size="sm"
        block
        start
        icon="console"
        class="calibration-console-toggle"
        :aria-expanded="consoleOpen"
        :label="t(consoleOpen ? 'calibration.console.hide' : 'calibration.console.show')"
        @click="consoleOpen = !consoleOpen"
      >
        <AppIcon
          :name="consoleOpen ? 'up' : 'down'"
          class="calibration-console-toggle__chevron size-4"
          aria-hidden="true"
        />
      </AppButton>
      <AvailabilityRegion v-if="consoleOpen" requires="moonraker">
        <!--
          The Console route's own console, not the dashboard card. The card
          looked close enough and was not: it reads its filters from one
          dashboard instance rather than from the settings somebody set up on
          the Console page, it has no command browser, and its transcript
          carries the inset fill it needs as one panel among a card's rows —
          which standing alone here read as a box inside a box. `ConsolePanel`
          names what actually differs between the two hosts, and it is only
          the height: this page has bounded nothing, so the console states its
          own from `visibleLines` instead of filling a pane.
        -->
        <ConsolePanel />
      </AvailabilityRegion>
    </div>
  </section>
</template>
