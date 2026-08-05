<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'

/**
 * The chrome for a whole-surface OS file drop: a dimmed, dashed-outline
 * scrim with the affordance repeated in a centered box, so the surface reads
 * as a drop target no matter where on it the drag is being watched. Paired
 * with `useExternalFileDrop`, whose `isActive` controls this with `v-if`.
 * The host element needs `position: relative` for this to lay over it
 * rather than the page.
 */
defineProps<{ message: string }>()
</script>

<template>
  <div class="file-drop-overlay" aria-hidden="true">
    <div class="file-drop-overlay__box">
      <AppIcon name="fileUpload" class="size-6" aria-hidden="true" />
      <p>{{ message }}</p>
    </div>
  </div>
</template>
