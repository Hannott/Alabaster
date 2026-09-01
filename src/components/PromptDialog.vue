<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'

const props = defineProps<{
  open: boolean
  title: string
  // Explicitly `| undefined` so callers may pass a possibly-absent description
  // under `exactOptionalPropertyTypes`.
  description?: string | undefined
  /** The field's visible label; a placeholder cannot stand in for it. */
  label: string
  /** Seeds and pre-selects the field, mirroring window.prompt's default-selected value. */
  initialValue?: string | undefined
  confirmLabel: string
  /** Returns a localized error for an invalid value, or undefined when it is valid. */
  validate?: ((value: string) => string | undefined) | undefined
}>()

const emit = defineEmits<{ confirm: [value: string]; cancel: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const value = ref('')
const titleId = useId()
const descriptionId = useId()
const fieldId = useId()
const errorId = useId()

/*
 * Validation runs on every input and on submit. An invalid value keeps the
 * dialog open with the reason stated under the field, so the user never loses
 * what they typed to a silent no-op.
 */
const error = computed(() => props.validate?.(value.value))

/*
 * A native dialog gives modal focus trapping, Escape handling, and the top layer
 * without a bespoke focus manager. The field is seeded and pre-selected after
 * showModal(), so a rename still supports "change one character and confirm".
 */
async function sync(isOpen: boolean): Promise<void> {
  const element = dialog.value
  if (!element) return
  if (isOpen && !element.open) {
    value.value = props.initialValue ?? ''
    element.showModal()
    await nextTick()
    input.value?.select()
  }
  if (!isOpen && element.open) element.close()
}

/** Also from mounting already open — see `ConfirmDialog` for what that costs. */
onMounted(() => void sync(props.open))
watch(() => props.open, sync, { flush: 'post' })

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})

function submit(): void {
  if (error.value !== undefined) return
  emit('confirm', value.value.trim())
}
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog"
    :aria-labelledby="titleId"
    :aria-describedby="description ? descriptionId : undefined"
    @cancel.prevent="emit('cancel')"
  >
    <h2 :id="titleId" class="text-dialog-title">{{ title }}</h2>
    <p v-if="description" :id="descriptionId" class="mt-2 text-sm leading-6 text-muted">
      {{ description }}
    </p>
    <!--
      Enter submits the way window.prompt trained users to expect: the field
      sits in a real form whose submit emits the trimmed value when it is valid.
    -->
    <form novalidate @submit.prevent="submit">
      <div class="prompt-dialog__field">
        <label class="prompt-dialog__label" :for="fieldId">{{ label }}</label>
        <!--
          The value is a file or folder name, never an identity field, but a
          text input labeled "Name" reads as one to password managers. The
          opt-out attributes keep 1Password, LastPass, and Bitwarden from
          offering to fill the user's actual name into it.
        -->
        <input
          :id="fieldId"
          ref="input"
          v-model="value"
          class="field field--sm field--block prompt-dialog__input"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          :aria-invalid="error !== undefined"
          :aria-describedby="error ? errorId : undefined"
        />
        <p v-if="error" :id="errorId" class="prompt-dialog__error">{{ error }}</p>
      </div>
      <div class="confirm-dialog__actions">
        <AppButton
          variant="primary"
          :label="confirmLabel"
          type="submit"
          :disabled="error !== undefined"
        />
        <AppButton size="sm" :label="t('dashboard.cancel')" @click="emit('cancel')" />
      </div>
    </form>
  </dialog>
</template>
