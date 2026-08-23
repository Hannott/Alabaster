<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import BedMeshModule from '@/components/dashboard/modules/BedMeshModule.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import PageHeading from '@/components/PageHeading.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import { useAvailability } from '@/composables/useAvailability'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { profileNameIssue } from '@/features/bedMesh/profileNames'
import { probeBedPosition } from '@/features/bedMesh/probeRun'
import { createTimeFormatter } from '@/i18n/formats'
import { useAxesNoiseStore } from '@/stores/axesNoise'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useActionGuard } from '@/composables/useActionGuard'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useEndstopsStore } from '@/stores/endstops'
import { useMacrosStore } from '@/stores/macros'
import { useMeshProbeRunStore } from '@/stores/meshProbeRun'
import { useProbeAccuracyStore } from '@/stores/probeAccuracy'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'
import { useRunoutSensorsStore } from '@/stores/runoutSensors'
import {
  shakeTuneCategories,
  shakeTuneTriggerMacros,
  useShakeTuneStore,
  type ShakeTuneCategory,
  type ShakeTuneResult,
} from '@/stores/shakeTune'

const { locale, t } = useI18n({ useScope: 'global' })
const endstops = useEndstopsStore()
const axesNoise = useAxesNoiseStore()
const bedMesh = useBedMeshStore()
const macros = useMacrosStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const probeRun = useMeshProbeRunStore()
const probeAccuracy = useProbeAccuracyStore()
const runoutSensors = useRunoutSensorsStore()
const layout = useDashboardLayoutStore()
/*
 * `danger-quiet` drops its softening rather than gaining a fill, which is this
 * variant's one available step: a border adds noise in a dense row, and the row
 * is where the control lives.
 */
const deleteProfileGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'deleteMeshProfile',
})
const shakeTune = useShakeTuneStore()
const { availability: klipperAvailability } = useAvailability('klipper')
const { availability: moonrakerAvailability } = useAvailability('moonraker')

/**
 * Real, persisted settings for the mesh viewer hosted here, not the ephemeral
 * per-mount fallback `useDashboardModule` returns outside a real provider.
 * `bedMesh` never supports more than one dashboard instance — `nextInstanceId`
 * only ever suffixes an id that is already taken, and this module never asks
 * to — so its instance id is always exactly `'bedMesh'`, the same instance a
 * dashboard card would read and write, whether or not the user has ever added
 * one to their dashboard. That is what makes a setting changed from either
 * place hold in both, rather than this page growing a second, disagreeing copy.
 *
 * `canOpenSurface: false` because there is no dock to open one into here: the
 * viewer is already hosted at page size, not inside a grid of cards it could
 * leave. See `canOpenSurface`'s own comment in `dashboard/context.ts`.
 */
const meshInstanceId = 'bedMesh'
const meshSettingsOpen = ref(false)
provide(dashboardModuleContextKey, {
  instanceId: meshInstanceId,
  moduleId: 'bedMesh',
  config: computed(
    () =>
      layout.profile.instances.find((instance) => instance.instanceId === meshInstanceId)?.config ??
      {},
  ),
  updateConfig: (patch) => layout.updateConfig(meshInstanceId, patch),
  isSettingsOpen: computed(() => meshSettingsOpen.value),
  openSettings: () => {
    meshSettingsOpen.value = true
  },
  closeSettings: () => {
    meshSettingsOpen.value = false
  },
  isSurfaceOpen: computed(() => false),
  openSurface: () => {},
  closeSurface: () => {},
  canOpenSurface: false,
})

function toggleMeshSettings(): void {
  meshSettingsOpen.value = !meshSettingsOpen.value
}

onMounted(() => {
  endstops.start()
  shakeTune.start()
})

onBeforeUnmount(() => {
  endstops.stop()
  shakeTune.stop()
})

const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
)
const timeFormatter = computed(() => createTimeFormatter(locale.value))

const hasBedMesh = computed(() => printerConfig.hasBedMesh)
const hasProbe = computed(() => printerConfig.hasProbe)
const canCommand = computed(() => klipperAvailability.value.isAvailable && !printer.hasActivePrint)

/**
 * `PROBE_ACCURACY` probes at wherever the toolhead currently sits, not at a
 * coordinate Alabaster chooses — and the probe tip is not the nozzle. A probe
 * with a real `x_offset`/`y_offset` sits somewhere else entirely, so a nozzle
 * comfortably inside the bed can still carry the probe past its edge, into a
 * frame rail or simply out of the travel range Klipper will refuse to enter.
 * `probeBedPosition` is the same toolhead-plus-offset arithmetic the live mesh
 * view already uses to place the moving probe marker; `buildVolume` is
 * Klipper's own reported `axis_minimum`/`axis_maximum`, the actual legal
 * range, not a nominal bed size. Unknown position or unknown bounds do not
 * block — there is nothing to warn about yet, not evidence of a problem.
 */
const probeOutsideBed = computed(() => {
  const position = probeBedPosition(printer.toolheadPosition, printerConfig.probeOffset)
  if (!position) return false
  const [minX, minY] = printer.buildVolume.minimum
  const [maxX, maxY] = printer.buildVolume.maximum
  if (
    typeof minX !== 'number' ||
    typeof minY !== 'number' ||
    typeof maxX !== 'number' ||
    typeof maxY !== 'number'
  ) {
    return false
  }
  return position.x < minX || position.x > maxX || position.y < minY || position.y > maxY
})

function formatHeight(value: number): string {
  return t('calibration.mesh.millimetres', { value: numberFormatter.value.format(value) })
}

function formatProbeValue(value: number): string {
  return t('calibration.probe.millimetres', { value: numberFormatter.value.format(value) })
}

/**
 * `MEASURE_AXES_NOISE` is a native Klipper command from `[resonance_tester]`,
 * not a Shake&Tune macro — it exists whenever an accelerometer is configured
 * for resonance testing, whether or not Shake&Tune itself is installed. Config
 * presence is therefore the right gate, the same way `hasProbe`/`hasBedMesh`
 * read a section directly rather than asking `macros.hasMacro` about a
 * command nothing ever wrapped in a `[gcode_macro]`.
 */
const hasResonanceTester = computed(() => printerConfig.hasSection('resonance_tester'))

/**
 * These are power-spectral-density means, not a physical unit with an
 * established "too high" threshold Klipper documents anywhere Alabaster could
 * cite — so this only formats them for reading, at the same precision
 * Klipper's own `%.6f` prints, rather than judging or colouring them as good
 * or bad on a threshold nobody has confirmed.
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

/** Whether Shake&Tune is installed at all, independent of having run anything yet. */
const hasShakeTuneMacros = computed(() =>
  Object.values(shakeTuneTriggerMacros).some(
    (macroName) => macroName !== undefined && macros.hasMacro(macroName),
  ),
)

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
 * `runningMacros`, which `isTuningRunning` below reads. Calling `sendMacro`
 * itself dispatches the command with no pending state anything could ever
 * observe — the button would never disable and would let a second click
 * queue right on top of one still running.
 */
function triggerTuning(category: ShakeTuneCategory): void {
  const macroName = shakeTuneTriggerMacros[category]
  if (macroName !== undefined) void macros.run(macroName)
}

const renamingProfile = ref<string | null>(null)
const deletingProfile = ref<string | null>(null)
const savingMesh = ref(false)

async function confirmRename(name: string): Promise<void> {
  const from = renamingProfile.value
  renamingProfile.value = null
  if (from) await printer.renameBedMeshProfile(from, name)
}

async function confirmDelete(): Promise<void> {
  const profile = deletingProfile.value
  deletingProfile.value = null
  if (profile) await printer.removeBedMeshProfile(profile)
}

function requestDelete(name: string): void {
  if (deleteProfileGuard.guarded.value) deletingProfile.value = name
  else void printer.removeBedMeshProfile(name)
}

async function confirmSave(name: string): Promise<void> {
  savingMesh.value = false
  await printer.saveBedMeshProfile(name)
}

function validateMeshName(value: string, except?: string): string | undefined {
  switch (profileNameIssue(value, bedMesh.profiles, except)) {
    case 'empty':
      return t('calibration.mesh.nameEmpty')
    case 'nonAscii':
      return t('calibration.mesh.nameAscii')
    case 'taken':
      return t('calibration.mesh.nameTaken')
    default:
      return undefined
  }
}

const viewingResult = ref<ShakeTuneResult | null>(null)
</script>

<template>
  <section class="standard-page calibration-view">
    <PageHeading :title="t('calibration.title')" />

    <!--
      A grid, not the 64rem `page-column` prose measure: this content is panels
      of readings, exactly what `interface-standards.md` reserves the full
      canvas for. The map is the primary column, capped rather than left to
      fill whatever `flex-grow` hands it — its stage is a fixed 3:2 box with a
      capped block-size, so stretching the card past what that content can use
      only crowds out the columns beside it. Endstops, probe accuracy and
      runout sensors stack beside it as an independent column of their own —
      the same "each column is its own stack" rule the dashboard already
      follows — and the profile list joins the same row when a wide desktop
      leaves room for it, wrapping to its own full-width row otherwise.
    -->
    <AvailabilityRegion requires="klipper">
      <div class="calibration-grid">
        <section
          v-if="hasBedMesh"
          class="page-card calibration-map calibration-grid__main"
          :aria-label="t('calibration.map.title')"
        >
          <header class="calibration-panel__header">
            <div class="calibration-panel__actions ms-auto">
              <p v-if="probeRun.isRunning" class="calibration-map__running" role="status">
                <AppIcon name="mesh" class="size-4 shrink-0" aria-hidden="true" />
                {{ t('calibration.map.probing', { count: probeRun.points.length }) }}
              </p>
              <button
                type="button"
                class="button button--quiet button--xs button--icon"
                :aria-pressed="meshSettingsOpen"
                :aria-label="t('dashboard.layout.settings', { module: t('calibration.map.title') })"
                :title="
                  t('dashboard.layout.settingsTooltip', { module: t('calibration.map.title') })
                "
                @click="toggleMeshSettings()"
              >
                <AppIcon name="settings" class="size-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          <!--
            Said while it matters and not before: the points are plotted against
            the mean of the run so far, because Klipper reports absolute trigger
            heights and the surface is drawn as deviation. Early points move as
            that mean settles, so the panel says the shape is provisional rather
            than letting it be read as the finished mesh.
          -->
          <p v-if="probeRun.isRunning" class="calibration-panel__hint">
            {{ t('calibration.map.provisional') }}
          </p>
          <p v-else-if="probeRun.isScanning" class="calibration-notice" role="status">
            <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ t('calibration.map.scanningProbe') }}</span>
          </p>

          <!--
            The dashboard's own bed-mesh module, hosted at page size. It is the
            same component and the same renderer, not a second one — and, as of
            the settings gear above, the same saved configuration a dashboard
            card would read and write, via the real context provided in
            `<script setup>` rather than the ephemeral fallback
            `useDashboardModule` falls back to outside any provider.
          -->
          <BedMeshModule live-probing force-probe-labels />
        </section>

        <div class="calibration-grid__side">
          <section
            class="page-card calibration-panel"
            :aria-label="t('calibration.endstops.title')"
          >
            <header class="calibration-panel__header">
              <div>
                <h2 class="calibration-panel__title">{{ t('calibration.endstops.title') }}</h2>
                <p class="calibration-panel__hint">{{ t('calibration.endstops.hint') }}</p>
              </div>
              <button
                type="button"
                class="button button--xs"
                :disabled="!klipperAvailability.isAvailable || endstops.isLoading"
                :data-pending="endstops.isLoading ? 'true' : undefined"
                @click="endstops.refresh()"
              >
                <AppIcon name="refresh" class="size-4" aria-hidden="true" />
                {{ t('calibration.endstops.refresh') }}
              </button>
            </header>

            <!--
              Said once for the whole panel rather than per row: while a print runs
              the poll stops, so every reading below is equally old.
            -->
            <p v-if="endstops.isStale" class="calibration-notice" role="status">
              <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
              <span>
                {{ t('calibration.endstops.paused') }}
                <template v-if="endstops.readAt">
                  {{
                    t('calibration.endstops.readAt', {
                      time: timeFormatter.format(endstops.readAt),
                    })
                  }}
                </template>
              </span>
            </p>
            <p v-else-if="endstops.failed" class="calibration-notice" role="status">
              <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
              <span>{{ t('calibration.endstops.failed') }}</span>
            </p>

            <ul v-if="endstops.hasReadings" class="calibration-endstops">
              <li
                v-for="reading in endstops.readings"
                :key="reading.name"
                class="calibration-endstop"
              >
                <span class="calibration-endstop__name">{{ reading.name }}</span>
                <!--
                  Shape and word, never colour alone: a triggered endstop reads as
                  filled with the word beside it, an open one as an outline.
                -->
                <span
                  class="calibration-endstop__state"
                  :class="`calibration-endstop__state--${reading.state}`"
                >
                  <span class="calibration-endstop__mark" aria-hidden="true"></span>
                  {{ t(`calibration.endstops.state.${reading.state}`) }}
                </span>
              </li>
            </ul>
            <p v-else class="calibration-panel__hint">{{ t('calibration.endstops.empty') }}</p>
          </section>

          <!--
            `PROBE_ACCURACY` repeats one point ten times and answers with a
            single console line — see `stores/probeAccuracy.ts` — so this panel
            has one button and one result, not a running transcript.
          -->
          <section
            v-if="hasProbe"
            class="page-card calibration-panel"
            :aria-label="t('calibration.probe.title')"
          >
            <header class="calibration-panel__header">
              <div>
                <h2 class="calibration-panel__title">{{ t('calibration.probe.title') }}</h2>
                <p class="calibration-panel__hint">{{ t('calibration.probe.hint') }}</p>
              </div>
              <button
                type="button"
                class="button button--xs"
                :disabled="!canCommand || printer.pendingCommands.probeAccuracy || probeOutsideBed"
                :data-pending="printer.pendingCommands.probeAccuracy ? 'true' : undefined"
                @click="printer.probeAccuracy()"
              >
                <AppIcon name="play" class="size-4" aria-hidden="true" />
                {{ t('calibration.probe.run') }}
              </button>
            </header>

            <p v-if="probeOutsideBed" class="calibration-notice" role="status">
              <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
              <span>{{ t('calibration.probe.outsideBed') }}</span>
            </p>
            <p v-else-if="probeAccuracy.isRunning" class="calibration-notice" role="status">
              <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
              <span>{{ t('calibration.probe.running') }}</span>
            </p>
            <p v-else-if="!probeAccuracy.result" class="calibration-panel__hint">
              {{ t('calibration.probe.empty') }}
            </p>

            <dl v-if="probeAccuracy.result" class="calibration-probe-results">
              <div>
                <dt>{{ t('calibration.probe.maximum') }}</dt>
                <dd>{{ formatProbeValue(probeAccuracy.result.maximum) }}</dd>
              </div>
              <div>
                <dt>{{ t('calibration.probe.minimum') }}</dt>
                <dd>{{ formatProbeValue(probeAccuracy.result.minimum) }}</dd>
              </div>
              <div>
                <dt>{{ t('calibration.probe.range') }}</dt>
                <dd>{{ formatProbeValue(probeAccuracy.result.range) }}</dd>
              </div>
              <div>
                <dt>{{ t('calibration.probe.average') }}</dt>
                <dd>{{ formatProbeValue(probeAccuracy.result.average) }}</dd>
              </div>
              <div>
                <dt>{{ t('calibration.probe.median') }}</dt>
                <dd>{{ formatProbeValue(probeAccuracy.result.median) }}</dd>
              </div>
              <div>
                <dt>{{ t('calibration.probe.standardDeviation') }}</dt>
                <dd>{{ formatProbeValue(probeAccuracy.result.standardDeviation) }}</dd>
              </div>
            </dl>
          </section>

          <!--
            States only, the same split `endstops.ts` draws: arming or disarming
            a sensor belongs with the print it protects, on the Print module,
            not here.
          -->
          <section
            v-if="runoutSensors.hasSensors"
            class="page-card calibration-panel"
            :aria-label="t('calibration.sensors.title')"
          >
            <header class="calibration-panel__header">
              <div>
                <h2 class="calibration-panel__title">{{ t('calibration.sensors.title') }}</h2>
                <p class="calibration-panel__hint">{{ t('calibration.sensors.hint') }}</p>
              </div>
            </header>

            <ul class="calibration-sensors">
              <li
                v-for="sensor in runoutSensors.readings"
                :key="sensor.objectName"
                class="calibration-sensor"
              >
                <span class="calibration-sensor__name">{{ sensor.name }}</span>
                <span
                  class="calibration-sensor__state"
                  :class="`calibration-sensor__state--${sensor.filamentDetected ? 'detected' : 'empty'}`"
                >
                  <span class="calibration-sensor__mark" aria-hidden="true"></span>
                  {{
                    t(
                      sensor.filamentDetected
                        ? 'calibration.sensors.detected'
                        : 'calibration.sensors.notDetected',
                    )
                  }}
                </span>
                <span v-if="!sensor.enabled" class="calibration-sensor__armed">
                  {{ t('calibration.sensors.disarmed') }}
                </span>
              </li>
            </ul>
          </section>
        </div>

        <section
          v-if="hasBedMesh"
          class="page-card calibration-panel calibration-grid__profiles"
          :aria-label="t('calibration.mesh.title')"
        >
          <header class="calibration-panel__header">
            <div>
              <h2 class="calibration-panel__title">{{ t('calibration.mesh.title') }}</h2>
              <p class="calibration-panel__hint">{{ t('calibration.mesh.hint') }}</p>
            </div>
            <div class="calibration-panel__actions">
              <button
                type="button"
                class="button button--xs"
                :disabled="!canCommand"
                :data-pending="printer.pendingCommands.bedMesh ? 'true' : undefined"
                @click="printer.calibrateBedMesh()"
              >
                <AppIcon name="mesh" class="size-4" aria-hidden="true" />
                {{ t('calibration.mesh.calibrate') }}
              </button>
              <button
                type="button"
                class="button button--xs"
                :disabled="!canCommand || !bedMesh.isActive"
                @click="savingMesh = true"
              >
                <AppIcon name="save" class="size-4" aria-hidden="true" />
                {{ t('calibration.mesh.save') }}
              </button>
            </div>
          </header>

          <p v-if="!bedMesh.isActive" class="calibration-panel__hint">
            {{ t('calibration.mesh.noneLoaded') }}
          </p>

          <ul v-if="bedMesh.profileSummaries.length > 0" class="calibration-profiles">
            <li
              v-for="profile in bedMesh.profileSummaries"
              :key="profile.name"
              class="calibration-profile"
              :class="{ 'calibration-profile--active': profile.isActive }"
              :aria-current="profile.isActive ? 'true' : undefined"
            >
              <span class="calibration-profile__identity">
                <span class="calibration-profile__name">{{ profile.name }}</span>
              </span>
              <!--
                Each profile's own spread, read from the points Klipper reports
                with it. The alternative is loading each one in turn to look at
                it, which changes the machine to answer a question about a file.
              -->
              <span class="calibration-profile__range text-value">
                {{ t('calibration.mesh.spread', { value: formatHeight(profile.range) }) }}
              </span>
              <span class="calibration-profile__actions">
                <button
                  type="button"
                  class="button button--quiet button--xs"
                  :disabled="!canCommand || profile.isActive"
                  @click="printer.loadBedMeshProfile(profile.name)"
                >
                  {{ t('calibration.mesh.load') }}
                </button>
                <button
                  type="button"
                  class="button button--quiet button--xs"
                  :disabled="!canCommand || !profile.isActive"
                  :title="t('calibration.mesh.renameHint')"
                  @click="renamingProfile = profile.name"
                >
                  {{ t('calibration.mesh.rename') }}
                </button>
                <button
                  type="button"
                  class="button button--xs"
                  :class="deleteProfileGuard.variant.value"
                  v-bind="deleteProfileGuard.bind.value"
                  :disabled="!canCommand"
                  @click="requestDelete(profile.name)"
                >
                  {{ t('calibration.mesh.delete') }}
                </button>
              </span>
            </li>
          </ul>
          <p v-else class="calibration-panel__hint">{{ t('calibration.mesh.noProfiles') }}</p>
        </section>
      </div>
    </AvailabilityRegion>

    <!--
      A separate `moonraker`-only region rather than folding into the section
      above: these are files on disk, readable whether or not Klipper is
      connected, and a printer mid-restart is exactly when someone might want
      to check the last input-shaper run without waiting for it to come back.
    -->
    <AvailabilityRegion requires="moonraker">
      <div v-if="shakeTune.hasAnyResults || hasShakeTuneMacros" class="page-column">
        <section class="page-card calibration-panel" :aria-label="t('calibration.tuning.title')">
          <header class="calibration-panel__header">
            <div>
              <h2 class="calibration-panel__title">{{ t('calibration.tuning.title') }}</h2>
              <p class="calibration-panel__hint">{{ t('calibration.tuning.hint') }}</p>
            </div>
            <button
              type="button"
              class="button button--xs"
              :disabled="!moonrakerAvailability.isAvailable || shakeTune.isLoading"
              :data-pending="shakeTune.isLoading ? 'true' : undefined"
              @click="shakeTune.refresh()"
            >
              <AppIcon name="refresh" class="size-4" aria-hidden="true" />
              {{ t('calibration.tuning.refresh') }}
            </button>
          </header>

          <!--
            Before spending the several minutes a real shaper test costs: a
            2-second read of background vibration, so a fan touching the
            toolhead or a loose mount shows up as noise here rather than as an
            unreadable graph afterward. A native Klipper command from
            `[resonance_tester]`, not a Shake&Tune macro — see
            `hasResonanceTester`'s own comment.
          -->
          <div v-if="hasResonanceTester" class="calibration-tuning-noise">
            <p class="calibration-panel__hint">{{ t('calibration.tuning.noiseHint') }}</p>
            <button
              type="button"
              class="button button--quiet button--xs"
              :disabled="!canCommand || printer.pendingCommands.measureAxesNoise"
              :data-pending="printer.pendingCommands.measureAxesNoise ? 'true' : undefined"
              @click="printer.measureAxesNoise()"
            >
              <AppIcon name="activity" class="size-4" aria-hidden="true" />
              {{ t('calibration.tuning.checkNoise') }}
            </button>
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
              <button
                v-if="canRunTuning(category)"
                type="button"
                class="button button--quiet button--xs"
                :disabled="!canCommand || isTuningRunning(category)"
                :data-pending="isTuningRunning(category) ? 'true' : undefined"
                :aria-label="
                  t('calibration.tuning.runLabel', {
                    category: t(`calibration.tuning.category.${category}`),
                  })
                "
                @click="triggerTuning(category)"
              >
                <AppIcon name="play" class="size-4" aria-hidden="true" />
                {{ t('calibration.tuning.run') }}
              </button>
            </header>
            <ul
              v-if="shakeTune.resultsByCategory[category].length > 0"
              class="calibration-tuning-strip"
            >
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
        </section>
      </div>
    </AvailabilityRegion>

    <PromptDialog
      :open="renamingProfile !== null"
      :title="t('calibration.mesh.renameTitle')"
      :label="t('calibration.mesh.renameLabel')"
      :initial-value="renamingProfile ?? ''"
      :confirm-label="t('calibration.mesh.rename')"
      @confirm="confirmRename"
      @cancel="renamingProfile = null"
    />
    <PromptDialog
      :open="savingMesh"
      :title="t('calibration.mesh.saveTitle')"
      :label="t('calibration.mesh.saveLabel')"
      :initial-value="bedMesh.suggestedProfileName"
      :confirm-label="t('calibration.mesh.save')"
      :validate="(value: string) => validateMeshName(value, bedMesh.profileName)"
      @confirm="confirmSave"
      @cancel="savingMesh = false"
    />
    <ConfirmDialog
      :open="deletingProfile !== null"
      :title="t('calibration.mesh.deleteTitle')"
      :description="t('calibration.mesh.deleteConfirm', { name: deletingProfile ?? '' })"
      :confirm-label="t('calibration.mesh.delete')"
      tone="danger"
      @confirm="confirmDelete"
      @cancel="deletingProfile = null"
    />
    <ImageLightbox
      :open="viewingResult !== null"
      :src="viewingResult?.url ?? ''"
      :alt="viewingResult?.name ?? ''"
      @close="viewingResult = null"
    />
  </section>
</template>
