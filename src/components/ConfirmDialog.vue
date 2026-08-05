<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  open: boolean
  title: string
  // Explicitly `| undefined` so callers may pass a possibly-absent description
  // under `exactOptionalPropertyTypes`.
  description?: string | undefined
  /** Paths or names this action will affect, listed one per line under the description. */
  items?: readonly string[] | undefined
  confirmLabel: string
  /** Overrides the shared "Cancel" label where it would read ambiguously — see the print-cancel dialog. */
  cancelLabel?: string | undefined
  tone?: 'primary' | 'danger' | undefined
  /**
   * Takes the wider `min(32rem, …)` measure `dialog-system.md` permits a
   * confirmation carrying body content — set alongside the `details` slot
   * below, per the Machine update changelog.
   */
  wide?: boolean | undefined
}>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)

/**
 * A native dialog gives modal focus trapping, Escape handling, and the top layer
 * without a bespoke focus manager.
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
  <dialog
    ref="dialog"
    class="confirm-dialog"
    :class="{ 'confirm-dialog--wide': wide }"
    @cancel.prevent="emit('cancel')"
  >
    <h2 class="text-dialog-title">{{ title }}</h2>
    <p v-if="description" class="mt-2 text-sm leading-6 text-muted">{{ description }}</p>
    <ul v-if="items?.length" class="confirm-dialog__items">
      <li v-for="item in items" :key="item">{{ item }}</li>
    </ul>
    <!--
      The changelog a single-source update confirmation shows — commits or a
      package list — is richer than the plain strings `items` renders, so it
      is a slot rather than a second prop shape on this otherwise-generic
      dialog. Unused by every other caller.
    -->
    <slot name="details" />
    <!--
      The affirmative action leads and the dismissive one follows, both on one
      equal-width track: the two buttons then read in the order the question
      was asked ("Discard changes? [Discard] [Cancel]") and neither is sized
      by how long its own label happens to be.
    -->
    <div class="confirm-dialog__actions">
      <button
        type="button"
        class="button"
        :class="tone === 'danger' ? 'button--danger' : 'button--primary'"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
      <button type="button" class="button" @click="emit('cancel')">
        {{ cancelLabel ?? t('dashboard.cancel') }}
      </button>
    </div>
  </dialog>
</template>
