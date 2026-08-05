<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
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
    <button
      type="button"
      class="button button--quiet button--xs button--icon toast__dismiss"
      :aria-label="t('toast.dismiss')"
      @click="emit('dismiss')"
    >
      <AppIcon name="close" class="size-4" aria-hidden="true" />
    </button>
    <div
      class="toast__progress"
      :style="{ animationDuration: `${toast.durationMs}ms` }"
      aria-hidden="true"
    />
  </div>
</template>
