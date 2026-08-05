<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{ src: string; alt: string }>()

const { t } = useI18n({ useScope: 'global' })

const MIN_SCALE = 0.1
const MAX_SCALE = 16
const ZOOM_STEP = 1.2

const stage = ref<HTMLElement | null>(null)
const imageEl = ref<HTMLImageElement | null>(null)
const scale = ref(1)
const pan = reactive({ x: 0, y: 0 })
const isLoading = ref(true)
const hasError = ref(false)
const pointerDrag = ref<{ pointerId: number; x: number; y: number } | null>(null)

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

/**
 * Fits the image within the stage on load rather than resetting to scale 1, so
 * oversized photos land fully visible instead of cropped to their top-left corner.
 */
function applyFitView(): void {
  const bounds = stage.value?.getBoundingClientRect()
  const image = imageEl.value
  if (!bounds || !image || !image.naturalWidth || !image.naturalHeight) return
  const fitScale = Math.min(
    bounds.width / image.naturalWidth,
    bounds.height / image.naturalHeight,
    1,
  )
  scale.value = fitScale > 0 ? fitScale : 1
  pan.x = (bounds.width - image.naturalWidth * scale.value) / 2
  pan.y = (bounds.height - image.naturalHeight * scale.value) / 2
}

function zoomAt(pointerX: number, pointerY: number, factor: number): void {
  const nextScale = clampScale(scale.value * factor)
  const appliedFactor = nextScale / scale.value
  pan.x = pointerX + (pan.x - pointerX) * appliedFactor
  pan.y = pointerY + (pan.y - pointerY) * appliedFactor
  scale.value = nextScale
}

function zoomBy(factor: number): void {
  const bounds = stage.value?.getBoundingClientRect()
  zoomAt(bounds ? bounds.width / 2 : 0, bounds ? bounds.height / 2 : 0, factor)
}

function handleWheel(event: WheelEvent): void {
  const bounds = stage.value?.getBoundingClientRect()
  if (!bounds) return
  zoomAt(event.clientX - bounds.left, event.clientY - bounds.top, Math.exp(-event.deltaY * 0.0015))
}

function handlePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || hasError.value) return
  event.preventDefault()
  stage.value?.setPointerCapture(event.pointerId)
  pointerDrag.value = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
}

function handlePointerMove(event: PointerEvent): void {
  const drag = pointerDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  event.preventDefault()
  pan.x += event.clientX - drag.x
  pan.y += event.clientY - drag.y
  drag.x = event.clientX
  drag.y = event.clientY
}

function handlePointerEnd(event: PointerEvent): void {
  if (pointerDrag.value?.pointerId !== event.pointerId) return
  if (stage.value?.hasPointerCapture(event.pointerId)) {
    stage.value.releasePointerCapture(event.pointerId)
  }
  pointerDrag.value = null
}

function handleLoad(): void {
  isLoading.value = false
  hasError.value = false
  applyFitView()
}

function handleError(): void {
  isLoading.value = false
  hasError.value = true
}

watch(
  () => props.src,
  () => {
    isLoading.value = true
    hasError.value = false
    scale.value = 1
    pan.x = 0
    pan.y = 0
  },
)
</script>

<template>
  <div class="image-viewer">
    <div
      ref="stage"
      class="image-viewer-stage"
      :data-pending="isLoading || undefined"
      tabindex="0"
      role="img"
      :aria-label="alt"
      @wheel.prevent="handleWheel"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerEnd"
      @pointercancel="handlePointerEnd"
      @dblclick="applyFitView"
      @dragstart.prevent
    >
      <img
        v-show="!hasError"
        ref="imageEl"
        :src="props.src"
        :alt="alt"
        class="image-viewer-stage__image"
        :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }"
        draggable="false"
        @load="handleLoad"
        @error="handleError"
      />
      <p v-if="hasError" class="image-viewer-stage__error" role="alert">
        <AppIcon name="warning" class="size-5" aria-hidden="true" />
        {{ t('imageViewer.loadError') }}
      </p>
    </div>

    <div
      v-if="!hasError"
      class="image-viewer-controls"
      role="group"
      :aria-label="t('imageViewer.zoomGroupLabel')"
    >
      <button
        type="button"
        class="button button--icon button--sm button--on-strong"
        :aria-label="t('imageViewer.zoomOut')"
        :title="t('imageViewer.zoomOut')"
        @click="zoomBy(1 / ZOOM_STEP)"
      >
        <AppIcon name="zoomOut" class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="button button--sm button--quiet button--on-strong"
        @click="applyFitView"
      >
        {{ t('imageViewer.reset') }}
      </button>
      <button
        type="button"
        class="button button--icon button--sm button--on-strong"
        :aria-label="t('imageViewer.zoomIn')"
        :title="t('imageViewer.zoomIn')"
        @click="zoomBy(ZOOM_STEP)"
      >
        <AppIcon name="zoomIn" class="size-4" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
