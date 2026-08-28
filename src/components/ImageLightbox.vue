<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import ImageViewer from '@/components/ImageViewer.vue'

const props = defineProps<{ open: boolean; src: string; alt: string }>()

const emit = defineEmits<{ close: [] }>()

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

/**
 * The header and viewer tile the dialog's box edge to edge, so the only way a
 * click's target can be the `<dialog>` element itself is the backdrop — the
 * same trick native `<dialog>` gives Escape, extended to a pointer.
 */
function handleDialogClick(event: MouseEvent): void {
  if (event.target === dialog.value) emit('close')
}
</script>

<template>
  <dialog
    ref="dialog"
    class="image-lightbox"
    @cancel.prevent="emit('close')"
    @click="handleDialogClick"
  >
    <header class="image-lightbox__header">
      <span class="image-lightbox__title truncate">{{ props.alt }}</span>
      <AppButton
        icon-only
        icon="close"
        :aria-label="t('imageViewer.close')"
        @click="emit('close')"
      />
    </header>
    <ImageViewer :src="props.src" :alt="props.alt" class="image-lightbox__viewer" />
  </dialog>
</template>
