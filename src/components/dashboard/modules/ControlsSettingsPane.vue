<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'
import IconPickerDialog from '@/components/IconPickerDialog.vue'
import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import ControlsCardSettingsFields from '@/components/dashboard/modules/ControlsCardSettingsFields.vue'
import {
  noneOutputIconOverride,
  outputIcon,
  outputIconTokens,
  type OutputIconToken,
  type OutputKind,
} from '@/components/dashboard/modules/controlsIcons'
import { configStringMap, useDashboardModule } from '@/dashboard/context'
import { usePrinterConfigStore } from '@/stores/printerConfig'

/**
 * Outputs' full configuration: what the card draws. Motion limits used to
 * live here too — they moved to their own Machine card on the dashboard,
 * reachable directly rather than through this second layer.
 *
 * The "Icons" section goes last, per `settings-surface.md`'s ordering rule —
 * a picker is the tallest thing in a pane and the least often wanted. It
 * carries no `QuickSettingToggle`: an icon choice is decided once and rarely
 * revisited, the same reasoning that already leaves Bed mesh's thresholds
 * and Console's line count without one.
 *
 * Lists every fan and pin regardless of `showOutputPins`/`showMonitoredFans`
 * — hiding a section from the card is not the same as not wanting its icon
 * configured for whenever it comes back, and Temperatures' own sensor-colour
 * section makes the same choice (gated only on sensors existing at all, not
 * on any card-visibility toggle).
 */
const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('controls')
const printerConfig = usePrinterConfigStore()

interface IconRow {
  objectName: string
  label: string
  kind: OutputKind
  /** Resolved once here, not re-read per template binding — see `pick`/`chooseIcon`. */
  icon: OutputIconToken | null
}

const iconRows = computed<IconRow[]>(() => {
  const overrides = configStringMap(config.value, 'outputIcons')
  return [
    ...printerConfig.fans.map((fan) => ({
      objectName: fan.objectName,
      label:
        fan.kind === 'part' ? t('dashboard.controls.partFan') : fan.name.replace(/[_-]+/g, ' '),
      kind: 'fan' as const,
      icon: outputIcon(fan.objectName, 'fan', overrides),
    })),
    ...printerConfig.outputPins.map((pin) => ({
      objectName: pin.objectName,
      label: pin.name.replace(/[_-]+/g, ' '),
      kind: 'pin' as const,
      icon: outputIcon(pin.objectName, 'pin', overrides),
    })),
  ]
})

const iconOptions = computed(() =>
  outputIconTokens.map((name) => ({ name, label: t(`dashboard.controls.icon.${name}`) })),
)

const pickerTarget = ref<IconRow | null>(null)

function openPicker(row: IconRow): void {
  pickerTarget.value = row
}

function closePicker(): void {
  pickerTarget.value = null
}

/**
 * Every row — fan or pin — can choose "None". A fan's default is `fan`, so
 * its "None" has to be a stored fact (`noneOutputIconOverride()`), not just
 * an absent key; a pin's default is already no icon, but it writes the same
 * sentinel rather than one rule for fans and another for pins.
 */
function chooseIcon(name: AppIconName | null): void {
  const row = pickerTarget.value
  if (!row) return
  updateConfig({
    outputIcons: {
      ...configStringMap(config.value, 'outputIcons'),
      [row.objectName]: name ?? noneOutputIconOverride(),
    },
  })
  closePicker()
}
</script>

<template>
  <SurfaceSection :title="t('dashboard.surface.cardSection')">
    <ControlsCardSettingsFields mode="pane" />
  </SurfaceSection>

  <SurfaceSection v-if="iconRows.length > 0" :title="t('dashboard.controls.iconsTitle')" divided>
    <div v-for="row in iconRows" :key="row.objectName" class="settings-row">
      <span class="settings-row__label">{{ row.label }}</span>
      <AppButton
        icon-only
        size="sm"
        :aria-label="t('dashboard.controls.chooseIcon', { label: row.label })"
        @click="openPicker(row)"
      >
        <AppIcon v-if="row.icon" :name="row.icon" class="size-4" aria-hidden="true" />
        <span v-else class="icon-none-mark size-4" aria-hidden="true">–</span>
      </AppButton>
    </div>
  </SurfaceSection>

  <IconPickerDialog
    :open="pickerTarget !== null"
    :title="
      pickerTarget ? t('dashboard.controls.chooseIconTitle', { label: pickerTarget.label }) : ''
    "
    :options="iconOptions"
    :selected="pickerTarget?.icon ?? null"
    allow-none
    @select="chooseIcon"
    @cancel="closePicker"
  />
</template>
