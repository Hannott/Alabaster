<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'

const props = defineProps<{
  open: boolean
  /** What the printer reports, shown as the value an empty field falls back to. */
  machineNozzleDiameter: number | null
}>()

const emit = defineEmits<{ close: [] }>()

// Named models, not hand-rolled prop/emit pairs — `AppSelect.vue` is the
// canonical example and says why.
//
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
            props.machineNozzleDiameter === null
              ? t('gcodeViewer.settings.nozzle.unknown')
              : String(props.machineNozzleDiameter)
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
          props.machineNozzleDiameter === null
            ? t('gcodeViewer.settings.nozzle.hintUnknown')
            : t('gcodeViewer.settings.nozzle.hint', { value: props.machineNozzleDiameter })
        }}
      </p>
    </fieldset>

    <!--
      The stage used to carry a paragraph of pointer and keyboard instructions
      under it, which cost a line of the model's height on every screen to
      state what most people discover by dragging once. It lives here instead,
      where somebody who cannot find a gesture will look. The stage keeps the
      same words on a visually hidden element for its accessible description,
      so nothing was taken from a screen reader to save that line.
    -->
    <fieldset class="gcode-settings-group">
      <legend>{{ t('gcodeViewer.settings.controls.title') }}</legend>
      <dl class="gcode-settings-controls">
        <div>
          <dt>{{ t('gcodeViewer.settings.controls.pointerTerm') }}</dt>
          <dd>{{ t('gcodeViewer.settings.controls.pointer') }}</dd>
        </div>
        <div>
          <dt>{{ t('gcodeViewer.settings.controls.touchTerm') }}</dt>
          <dd>{{ t('gcodeViewer.settings.controls.touch') }}</dd>
        </div>
        <div>
          <dt>{{ t('gcodeViewer.settings.controls.keyboardTerm') }}</dt>
          <dd>{{ t('gcodeViewer.settings.controls.keyboard') }}</dd>
        </div>
      </dl>
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
