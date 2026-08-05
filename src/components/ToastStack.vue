<script setup lang="ts">
import ToastItem from '@/components/ToastItem.vue'
import { useToastsStore } from '@/stores/toasts'

const toasts = useToastsStore()
</script>

<template>
  <div class="toast-stack">
    <TransitionGroup name="toast" tag="div" class="toast-stack__list">
      <ToastItem
        v-for="toast in toasts.entries"
        :key="toast.id"
        :toast="toast"
        @dismiss="toasts.dismiss(toast.id)"
      />
    </TransitionGroup>
  </div>
</template>
