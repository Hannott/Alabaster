<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import type { GcodeOrbitMode } from '@/composables/useGcodeViewerSettings'

const props = defineProps<{
  open: boolean
  orbitMode: GcodeOrbitMode
  /** What the printer reports, shown as the value an empty field falls back to. */
  machineNozzleDiameter: number | null
}>()

const emit = defineEmits<{
  close: []
  select: [GcodeOrbitMode]
}>()

// Named models, not hand-rolled prop/emit pairs — `AppSelect.vue` is the
// canonical example and says why.
const snapToCenter = defineModel<boolean>('snapToCenter', { required: true })
const highlightSeams = defineModel<boolean>('highlightSeams', { required: true })
// Null means "use the machine's", which is why an empty field is a valid state
// rather than something to be corrected to a default on blur.
const nozzleDiameter = defineModel<number | null>('nozzleDiameter', { required: true })

function handleNozzleInput(event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const parsed = Number.parseFloat(input.value)
  nozzleDiameter.value = Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)

const orbitModes: Array<{ value: GcodeOrbitMode; label: string; hint: string }> = [
  {
    value: 'center',
    label: 'gcodeViewer.settings.orbitMode.center',
    hint: 'gcodeViewer.settings.orbitMode.centerHint',
  },
  {
    value: 'pointer',
    label: 'gcodeViewer.settings.orbitMode.pointer',
    hint: 'gcodeViewer.settings.orbitMode.pointerHint',
  },
]

/**
 * A native dialog gives modal focus trapping, Escape handling, and the top layer
 * without a bespoke focus manager, matching ConfirmDialog.
 */
watch(
  () => props.open,
  (isOpen) => {
    const element = dialog.value
    if (!element) return
    if (isOpen && !element.open) element.showModal()
    if (!isOpen && element.open) element.close()
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog ref="dialog" class="gcode-settings-dialog" @cancel.prevent="emit('close')">
    <header>
      <h2>{{ t('gcodeViewer.settings.title') }}</h2>
      <AppButton
        icon-only
        icon="close"
        :aria-label="t('gcodeViewer.settings.close')"
        @click="emit('close')"
      />
    </header>
    <p class="gcode-view-description">{{ t('gcodeViewer.settings.description') }}</p>

    <fieldset class="gcode-settings-group">
      <legend>{{ t('gcodeViewer.settings.orbitMode.label') }}</legend>
      <label
        v-for="mode in orbitModes"
        :key="mode.value"
        class="check-row check-row--block gcode-settings-option"
      >
        <input
          type="radio"
          name="gcode-orbit-mode"
          :value="mode.value"
          :checked="orbitMode === mode.value"
          @change="emit('select', mode.value)"
        />
        <span>
          <strong>{{ t(mode.label) }}</strong>
          <small>{{ t(mode.hint) }}</small>
        </span>
      </label>
      <label
        class="check-row check-row--block gcode-settings-option"
        :data-disabled="orbitMode !== 'pointer' || undefined"
      >
        <input v-model="snapToCenter" type="checkbox" :disabled="orbitMode !== 'pointer'" />
        <span>
          <strong>{{ t('gcodeViewer.settings.snapToCenter.label') }}</strong>
          <small>{{ t('gcodeViewer.settings.snapToCenter.hint') }}</small>
        </span>
      </label>
    </fieldset>

    <fieldset class="gcode-settings-group">
      <legend>{{ t('gcodeViewer.settings.extrusion') }}</legend>
      <label class="gcode-field" for="gcode-nozzle-diameter">
        <span>{{ t('gcodeViewer.settings.nozzle.label') }}</span>
        <input
          id="gcode-nozzle-diameter"
          class="field"
          type="number"
          min="0.1"
          max="2"
          step="0.05"
          :value="nozzleDiameter ?? ''"
          :placeholder="
            machineNozzleDiameter === null
              ? t('gcodeViewer.settings.nozzle.unknown')
              : String(machineNozzleDiameter)
          "
          autocomplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          @input="handleNozzleInput"
        />
      </label>
      <p class="gcode-view-description">
        {{
          machineNozzleDiameter === null
            ? t('gcodeViewer.settings.nozzle.hintUnknown')
            : t('gcodeViewer.settings.nozzle.hint', { value: machineNozzleDiameter })
        }}
      </p>
    </fieldset>

    <fieldset class="gcode-settings-group">
      <legend>{{ t('gcodeViewer.settings.appearance') }}</legend>
      <label class="check-row check-row--block gcode-settings-option">
        <input v-model="highlightSeams" type="checkbox" />
        <span>
          <strong>{{ t('gcodeViewer.settings.highlightSeams.label') }}</strong>
          <small>{{ t('gcodeViewer.settings.highlightSeams.hint') }}</small>
        </span>
      </label>
    </fieldset>

    <div class="mt-5 flex justify-end">
      <AppButton
        variant="primary"
        :label="t('gcodeViewer.settings.close')"
        @click="emit('close')"
      />
    </div>
  </dialog>
</template>
