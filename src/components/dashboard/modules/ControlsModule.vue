<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import AppOutputRow from '@/components/AppOutputRow.vue'
import AppSlider from '@/components/AppSlider.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import ControlsQuickSettings from '@/components/dashboard/modules/ControlsQuickSettings.vue'
import { readControlsCardSetting } from '@/components/dashboard/modules/controlsCardSettings'
import { outputIcon, type OutputKind } from '@/components/dashboard/modules/controlsIcons'
import { configStringMap, useDashboardModule } from '@/dashboard/context'
import { usePrinterStore } from '@/stores/printer'
import {
  usePrinterConfigStore,
  type ConfiguredFan,
  type ConfiguredOutputPin,
} from '@/stores/printerConfig'
import { useTelemetryStore } from '@/stores/telemetry'

const { locale, t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const telemetry = useTelemetryStore()
const { config, isSettingsOpen } = useDashboardModule('controls')

const fanDrafts = reactive<Record<string, number>>({})
const pinDrafts = reactive<Record<string, number>>({})
// Keys and defaults live in `controlsCardSettings.ts`, shared with the
// settings rows so the two cannot drift.
const showOutputPins = computed(() => readControlsCardSetting(config.value, 'showOutputPins'))
const showMonitoredFans = computed(() => readControlsCardSetting(config.value, 'showMonitoredFans'))

const integerFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)

// Fans Klipper drives on its own are reported but never made adjustable here.
const controllableFans = computed(() =>
  printerConfig.fans.filter((fan) => fan.kind !== 'monitored'),
)
const monitoredFans = computed(() => printerConfig.fans.filter((fan) => fan.kind === 'monitored'))
const hasPinsShown = computed(() => showOutputPins.value && printerConfig.outputPins.length > 0)
const hasFansShown = computed(() => showMonitoredFans.value && monitoredFans.value.length > 0)

// Keyed by objectName, read and written by ControlsSettingsPane.vue's own
// "Icons" section through the same `config.outputIcons` map — see
// `controlsIcons.ts` for why this needs no per-row-kind spread the way a
// sensor's color default does.
const outputIcons = computed(() => configStringMap(config.value, 'outputIcons'))

function iconFor(objectName: string, kind: OutputKind) {
  return outputIcon(objectName, kind, outputIcons.value)
}

function fanSpeed(objectName: string): number | null {
  return telemetry.fans[objectName]?.speed ?? null
}

// The icon's rotation is a rate, not a position, so it takes its own ADR 0004
// exception rather than the moving-marker one — see "the spinning-fan
// exception". Duration only, never play state driven by a fixed clock: a
// fraction at or below 0 stays paused on `.fan-icon`'s own resting frame.
const FAN_SPIN_DURATION_AT_REST = 2.6
const FAN_SPIN_DURATION_AT_FULL = 0.4

function fanSpinDuration(fan: ConfiguredFan): number {
  const fraction = Math.min(1, Math.max(0, fanSpeed(fan.objectName) ?? 0))
  return (
    FAN_SPIN_DURATION_AT_REST - fraction * (FAN_SPIN_DURATION_AT_REST - FAN_SPIN_DURATION_AT_FULL)
  )
}

function isFanSpinning(fan: ConfiguredFan): boolean {
  return (fanSpeed(fan.objectName) ?? 0) > 0
}

function fanLabel(fan: ConfiguredFan): string {
  return fan.kind === 'part' ? t('dashboard.controls.partFan') : fan.name.replace(/[_-]+/g, ' ')
}

watch(
  () => controllableFans.value.map((fan) => [fan.objectName, fanSpeed(fan.objectName)] as const),
  (entries) => {
    for (const [objectName, speedValue] of entries) {
      if (speedValue !== null) fanDrafts[objectName] = Math.round(speedValue * 100)
      else fanDrafts[objectName] ??= 0
    }
  },
  // Not `deep`: the getter builds a fresh tuple array per evaluation, so
  // identity alone reports every change — deep only re-walked the tuples.
  { immediate: true },
)

// Output pins report their current value on the `output_pin <name>` object,
// in the same 0..scale domain `SET_PIN VALUE=` accepts — Moonraker never
// echoes it in percent, so a PWM pin's draft is converted here and a digital
// pin's is read as a plain on/off.
watch(
  () =>
    printerConfig.outputPins.map(
      (pin) => [pin.objectName, pin.isPwm, pin.scale, telemetry.pins[pin.objectName]] as const,
    ),
  (entries) => {
    for (const [objectName, isPwm, scale, rawValue] of entries) {
      if (rawValue === null || rawValue === undefined) {
        pinDrafts[objectName] ??= 0
        continue
      }
      pinDrafts[objectName] = isPwm
        ? Math.round((rawValue / (scale || 1)) * 100)
        : rawValue > 0
          ? 1
          : 0
    }
  },
  // Not `deep`: the getter builds a fresh tuple array per evaluation, so
  // identity alone reports every change — deep only re-walked the tuples.
  { immediate: true },
)

function applyFan(fan: ConfiguredFan, value: number): void {
  fanDrafts[fan.objectName] = value
  if (fan.kind === 'part') void printer.setFanSpeed(value)
  else void printer.setGenericFanSpeed(fan.objectName, value)
}

function applyPwmPin(pin: ConfiguredOutputPin): void {
  const draft = pinDrafts[pin.objectName] ?? 0
  void printer.setOutputPin(pin.objectName, (draft / 100) * pin.scale)
}

function setPinState(pin: ConfiguredOutputPin, isOn: boolean): void {
  const next = isOn ? 1 : 0
  pinDrafts[pin.objectName] = next
  void printer.setOutputPin(pin.objectName, next)
}
</script>

<template>
  <AppDashboardModule :open="isSettingsOpen">
    <template #quick-settings>
      <ControlsQuickSettings />
    </template>

    <!--
      Every row in Outputs — a fan's speed slider, a digital pin's switch, a
      PWM pin's slider, or a monitored fan's reading — shares one border
      between rows rather than each kind drawing its own boundary. A slider
      followed by a switch used to jump from a loose `gap-4` rhythm to a
      tight bordered one with a rule marking the seam, which read as two
      unrelated lists sharing a card rather than one list of a printer's
      outputs. Only the true last row of the combined list drops its
      separator (`--flush`); every row before it — slider, pin, or fan —
      carries the same one. `AppSlider` and `AppOutputRow` take the
      layout-free `output-row`/`output-row--flush` pair rather than
      `pin-row`/`pin-row--flush`: both components already manage their own
      internal layout, and `.pin-row`'s own flex rules (built for a bare
      name-plus-control div) collapse `AppSlider`'s two-row anatomy into one
      row if applied there too — see the `.output-row` comment in main.css.
    -->
    <div v-if="controllableFans.length > 0 || hasPinsShown || hasFansShown" class="grid">
      <AppSlider
        v-for="(fan, index) in controllableFans.map((fan) => ({
          ...fan,
          icon: iconFor(fan.objectName, 'fan'),
        }))"
        :key="fan.objectName"
        class="output-row"
        :class="{
          'output-row--flush':
            index === controllableFans.length - 1 && !hasPinsShown && !hasFansShown,
        }"
        :label="fanLabel(fan)"
        :label-icon="fan.icon ?? undefined"
        :model-value="fanDrafts[fan.objectName] ?? 0"
        :unit="t('dashboard.percentUnit')"
        :min="0"
        :max="100"
        :step="1"
        entry
        :disabled="printer.pendingCommands.fan"
        @commit="(value) => applyFan(fan, value)"
      />

      <template v-if="showOutputPins">
        <template
          v-for="(pin, index) in printerConfig.outputPins.map((pin) => ({
            ...pin,
            icon: iconFor(pin.objectName, 'pin'),
          }))"
          :key="pin.objectName"
        >
          <!--
          Deliberately not an `AppSlider` for the PWM case: this row holds a
          name and its control on one 2.75rem line, shared with the
          digital-switch rows and the fan rows below so a mixed list never
          steps up and down row to row (see the class-level comment in
          main.css). `AppSlider` is a fixed two-row anatomy — even at its
          smallest `xs` tier it is taller than this shared floor — so
          dropping one in would either break that floor for every sibling row
          or need its own, third row height nobody asked for. A
          name-plus-slider row this compact is the one instance that stays
          hand-rolled.
        -->
          <div
            v-if="pin.isPwm"
            class="pin-row"
            :class="{
              'pin-row--flush': index === printerConfig.outputPins.length - 1 && !hasFansShown,
            }"
          >
            <AppIcon v-if="pin.icon" :name="pin.icon" class="pin-row__icon" aria-hidden="true" />
            <span class="pin-row__label min-w-0 truncate text-xs font-bold">{{
              pin.name.replace(/[_-]+/g, ' ')
            }}</span>
            <input
              v-model.number="pinDrafts[pin.objectName]"
              type="range"
              min="0"
              max="100"
              step="1"
              :aria-label="t('dashboard.controls.pinLevel', { pin: pin.name })"
              @change="applyPwmPin(pin)"
            />
            <output class="text-value">
              {{ pinDrafts[pin.objectName] ?? 0 }}{{ t('dashboard.percentUnit') }}
            </output>
          </div>
          <AppOutputRow
            v-else
            toggle
            class="output-row"
            :class="{
              'output-row--flush': index === printerConfig.outputPins.length - 1 && !hasFansShown,
            }"
            :label="pin.name.replace(/[_-]+/g, ' ')"
            :icon="pin.icon ?? undefined"
            :aria-label="t('dashboard.controls.pinToggle', { pin: pin.name })"
            :model-value="(pinDrafts[pin.objectName] ?? 0) > 0"
            :disabled="printer.pendingCommands.pin"
            @update:model-value="(isOn) => setPinState(pin, isOn)"
          />
        </template>
      </template>

      <template v-if="hasFansShown">
        <AppOutputRow
          v-for="(fan, index) in monitoredFans.map((fan) => ({
            ...fan,
            icon: iconFor(fan.objectName, 'fan'),
          }))"
          :key="fan.objectName"
          :icon="fan.icon ?? undefined"
          class="output-row"
          :class="{ 'output-row--flush': index === monitoredFans.length - 1 }"
          :label="fan.name.replace(/[_-]+/g, ' ')"
          :value="
            fanSpeed(fan.objectName) === null
              ? t('dashboard.unavailableValue')
              : integerFormatter.format(Math.round((fanSpeed(fan.objectName) ?? 0) * 100))
          "
          :unit="fanSpeed(fan.objectName) === null ? undefined : t('dashboard.percentUnit')"
          :spin-duration-seconds="fanSpinDuration(fan)"
          :spinning="isFanSpinning(fan)"
        />
      </template>
    </div>
  </AppDashboardModule>
</template>
