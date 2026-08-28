<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import type { ToastEntry } from '@/stores/toasts'

const props = defineProps<{ toast: ToastEntry }>()
const emit = defineEmits<{ dismiss: [] }>()

const { t } = useI18n({ useScope: 'global' })

let timer: ReturnType<typeof window.setTimeout> | null = null

onMounted(() => {
  timer = window.setTimeout(() => emit('dismiss'), props.toast.durationMs)
})

onBeforeUnmount(() => {
  if (timer !== null) window.clearTimeout(timer)
})
</script>

<template>
  <div class="toast" role="alert">
    <p class="toast__message">{{ toast.message }}</p>
    <AppButton
      variant="quiet"
      size="xs"
      icon-only
      icon="close"
      class="toast__dismiss"
      :aria-label="t('toast.dismiss')"
      @click="emit('dismiss')"
    />
    <div
      class="toast__progress"
      :style="{ animationDuration: `${toast.durationMs}ms` }"
      aria-hidden="true"
    />
  </div>
</template>
