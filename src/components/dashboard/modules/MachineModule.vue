<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppField from '@/components/AppField.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import MachineQuickSettings from '@/components/dashboard/modules/MachineQuickSettings.vue'
import { readMachineCardSetting } from '@/components/dashboard/modules/machineCardSettings'
import { useDashboardModule } from '@/dashboard/context'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * The machine's motion limits — commands to Klipper rather than anything a
 * card displays for reading, and values set once and then left alone. They
 * used to live behind Outputs' settings pane for exactly that reason; moved
 * here because a user asked to reach them from the dashboard directly rather
 * than through a second layer, so the card now carries the cost the pane was
 * built to avoid.
 *
 * It carried a line restating the printer's configured limits underneath, on
 * the reasoning that a limit raised for one job could then be put back without
 * opening printer.cfg. It went: those numbers are what the fields themselves
 * show on any machine whose limits have not been changed this session, so
 * almost always the card said the same values twice. AppField now preserves
 * the useful half of that idea: when a runtime limit differs, the field reveals
 * an in-box reset action whose ordinary commit handler sends the configured
 * value back to Klipper.
 *
 * Each field commits on its own — `AppField`'s one-way `:model-value` plus
 * `@commit`, the same as Extruder's firmware retraction and Movement's axis
 * boxes — rather than a batch of drafts an Apply button reads. Unlike
 * `SET_RETRACTION`, `SET_VELOCITY_LIMIT` takes each parameter independently
 * and leaves the ones it was not given alone, so a committed field is sent by
 * itself and nothing this card holds is re-asserted over a value the console
 * or another browser changed in the meantime.
 *
 * What that buys, and what the Apply button cost: the fields render straight
 * from what the machine reports rather than from a draft copy of it, so
 * leaving a field without pressing Enter puts the machine's own value back
 * (`AppField` restores what it last committed on blur). A typed-but-unsent
 * number can no longer sit in the card looking like the printer's state, which
 * is what an Apply button that nobody pressed left behind.
 */
const { t } = useI18n({ useScope: 'global' })
const { config, isSettingsOpen } = useDashboardModule('machine')
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()

/*
 * Off by default — see `machineCardSettings.ts` for why locking is an opt-in
 * rather than the ordinary behavior. Not stated in a sentence on the card:
 * the fields simply go `disabled`, the same posture Extruder's own
 * printing-gated buttons take, where "a sentence repeating a fact the buttons
 * already show is noise, not information."
 */
const lockDuringPrint = computed(() => readMachineCardSetting(config.value, 'lockDuringPrint'))
const limitsLocked = computed(() => lockDuringPrint.value && printer.isPrinting)

/**
 * Rounded for display, since Klipper reports a velocity as `320.4` and
 * `setVelocityLimits` rounds it to whole units on the way out anyway — a field
 * showing a precision the command does not carry invites an edit that appears
 * to be ignored.
 *
 * `null` until the machine reports one, which draws an empty box rather than a
 * zero: nothing here has a meaningful zero, and a limit of 0 is a value
 * somebody could commit by pressing Enter on a field they only looked at.
 */
const velocity = computed(() =>
  printer.motion.maxVelocity === null ? null : Math.round(printer.motion.maxVelocity),
)
const accel = computed(() =>
  printer.motion.maxAccel === null ? null : Math.round(printer.motion.maxAccel),
)
const configuredVelocity = computed(() => {
  const value = printerConfig.motionLimits.maxVelocity
  return value === null ? null : Math.round(value)
})
const configuredAccel = computed(() => {
  const value = printerConfig.motionLimits.maxAccel
  return value === null ? null : Math.round(value)
})
const configuredSquareCornerVelocity = computed(
  () => printerConfig.motionLimits.squareCornerVelocity,
)

/**
 * Every other ratio in this app reads as a percentage — a fan's speed, a
 * print's progress — and the minimum cruise ratio was the one field still
 * asking for a raw 0–1 fraction. Only this field's own display and step are in
 * percent; `SET_VELOCITY_LIMIT` takes the fraction, so the conversion happens
 * here and at the commit below rather than anywhere in between.
 */
const minimumCruiseRatioPercent = computed(() =>
  printer.motion.minimumCruiseRatio === null
    ? null
    : Math.round(printer.motion.minimumCruiseRatio * 100),
)
const configuredMinimumCruiseRatioPercent = computed(() => {
  const value = printerConfig.motionLimits.minimumCruiseRatio
  return value === null ? null : Math.round(value * 100)
})

function commitVelocity(value: number | null): void {
  if (value === null) return
  void printer.setVelocityLimits({ velocity: value })
}

function commitAccel(value: number | null): void {
  if (value === null) return
  void printer.setVelocityLimits({ accel: value })
}

function commitSquareCornerVelocity(value: number | null): void {
  if (value === null) return
  void printer.setVelocityLimits({ squareCornerVelocity: value })
}

function commitMinimumCruiseRatio(value: number | null): void {
  if (value === null) return
  void printer.setVelocityLimits({ minimumCruiseRatio: Math.min(100, Math.max(0, value)) / 100 })
}
</script>

<template>
  <AppDashboardModule :open="isSettingsOpen">
    <template #quick-settings>
      <MachineQuickSettings />
    </template>
    <div class="grid grid-cols-1 gap-y-1 min-[100rem]:grid-cols-2 gap-x-4">
      <AppField
        :model-value="velocity"
        :label="t('dashboard.controls.velocity')"
        :unit="t('dashboard.controls.velocityUnit')"
        :placeholder="t('dashboard.unavailableValue')"
        :min="1"
        :step="1"
        :disabled="printer.pendingCommands.limits || limitsLocked"
        :reset-value="configuredVelocity"
        :can-reset="configuredVelocity !== null"
        align="end"
        steppers
        @commit="commitVelocity"
      />
      <AppField
        :model-value="printer.motion.squareCornerVelocity"
        :label="t('dashboard.controls.squareCornerVelocity')"
        :unit="t('dashboard.controls.squareCornerVelocityUnit')"
        :placeholder="t('dashboard.unavailableValue')"
        :min="0"
        :step="0.5"
        :disabled="printer.pendingCommands.limits || limitsLocked"
        :reset-value="configuredSquareCornerVelocity"
        :can-reset="configuredSquareCornerVelocity !== null"
        align="end"
        steppers
        @commit="commitSquareCornerVelocity"
      />
      <AppField
        :model-value="accel"
        :label="t('dashboard.controls.accel')"
        :unit="t('dashboard.controls.accelUnit')"
        :placeholder="t('dashboard.unavailableValue')"
        :min="1"
        :step="1"
        :disabled="printer.pendingCommands.limits || limitsLocked"
        :reset-value="configuredAccel"
        :can-reset="configuredAccel !== null"
        align="end"
        steppers
        @commit="commitAccel"
      />
      <AppField
        :model-value="minimumCruiseRatioPercent"
        :label="t('dashboard.controls.minimumCruiseRatio')"
        :unit="t('dashboard.percentUnit')"
        :placeholder="t('dashboard.unavailableValue')"
        :min="0"
        :max="100"
        :step="1"
        :disabled="printer.pendingCommands.limits || limitsLocked"
        :reset-value="configuredMinimumCruiseRatioPercent"
        :can-reset="configuredMinimumCruiseRatioPercent !== null"
        align="end"
        steppers
        @commit="commitMinimumCruiseRatio"
      />
    </div>
  </AppDashboardModule>
</template>
