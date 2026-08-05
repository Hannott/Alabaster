<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import { useDashboardModule } from '@/dashboard/context'
import { useWebcamsStore } from '@/stores/webcams'

const { t } = useI18n({ useScope: 'global' })
const { isSettingsOpen } = useDashboardModule('camera')
const webcams = useWebcamsStore()
const streamFailed = ref(false)

watch(
  () => webcams.primaryStreamUrl,
  () => (streamFailed.value = false),
)

const cameraTransform = computed(() => {
  const camera = webcams.primaryWebcam
  if (!camera) return undefined
  const transforms = [
    camera.flip_horizontal ? 'scaleX(-1)' : '',
    camera.flip_vertical ? 'scaleY(-1)' : '',
    camera.rotation ? `rotate(${camera.rotation}deg)` : '',
  ].filter(Boolean)
  return transforms.length > 0 ? transforms.join(' ') : undefined
})

async function retryCamera(): Promise<void> {
  streamFailed.value = false
  await webcams.refresh()
  streamFailed.value = false
}
</script>

<template>
  <!--
    inset: the stream runs to the card's edges, so there is no shell padding
    to hold it in — the stage below is this module's own full-bleed box, the
    same arrangement Print and Console use for their own edge-to-edge
    content.
  -->
  <AppDashboardModule inset :open="isSettingsOpen">
    <div class="camera-stage">
      <img
        v-if="webcams.primaryWebcam && webcams.primaryStreamUrl && !streamFailed"
        :src="webcams.primaryStreamUrl"
        :alt="t('dashboard.camera.alt', { name: webcams.primaryWebcam.name })"
        :style="{ transform: cameraTransform }"
        class="size-full object-cover"
        @error="streamFailed = true"
      />
      <div v-else class="camera-stage__empty">
        <AppIcon name="camera" class="size-8 text-data-sky" aria-hidden="true" />
        <p class="mt-3 text-section-title">
          {{
            streamFailed || webcams.failed
              ? t('dashboard.camera.failed')
              : t('dashboard.camera.notConfigured')
          }}
        </p>
        <p class="mt-1 max-w-xs text-center text-xs leading-5 text-muted">
          {{ t('dashboard.camera.hint') }}
        </p>
        <button
          type="button"
          class="button mt-4"
          :disabled="webcams.isLoading"
          @click="retryCamera"
        >
          {{ t('dashboard.camera.retry') }}
        </button>
      </div>
      <span v-if="webcams.primaryWebcam && !streamFailed" class="camera-stage__label">
        <i aria-hidden="true"></i>{{ webcams.primaryWebcam.name }}
      </span>
    </div>
  </AppDashboardModule>
</template>
