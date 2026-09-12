<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ImageLightbox from '@/components/ImageLightbox.vue'

/**
 * A queued or selectable G-code file's own column — Print's "Up next" job
 * and each expanded Recent files row — beside the slicer's preview of it.
 * Takes display-ready strings rather than raw metadata so both call sites
 * keep sharing `PrintModule`'s own locale-aware formatters
 * (`formatDuration`, `weightFormatter`) instead of a second copy living here.
 *
 * The default slot holds whatever identifies the file — "Up next"'s eyebrow
 * and filename, nothing for a Recent files row, which already names the file
 * on the button that expanded this — stacked above the estimated-time/
 * filament stats, all inside the one column the thumbnail sits beside.
 *
 * The thumbnail sits in a square area reserved in the row's top corner, the
 * same size on every row whatever the file — see
 * `.file-preview-thumbnail-frame` for why a reserved square rather than a box
 * sized by the row. A thumbnail whose aspect ratio is not square is scaled to
 * fit inside that square and letterboxed; the card does not reshape itself
 * around one file's slicer settings.
 *
 * Clicking it opens a lightbox rather than growing it in place the way the
 * active job's own thumbnail does, because the point of a fixed area is that
 * it is fixed: a preview worth studying should not be limited to however much
 * room the stats beside it happen to leave, and the lightbox has the whole
 * window to give it.
 */
defineProps<{
  estimatedTimeLabel: string | null
  filamentLabel: string | null
  thumbnailUrl: string | null
  /** The file this preview belongs to, for the lightbox's own title. */
  fileName: string
}>()

const { t } = useI18n({ useScope: 'global' })
const isLightboxOpen = ref(false)
</script>

<template>
  <div class="flex min-w-0 items-start justify-between gap-4">
    <div class="min-w-0 flex-initial">
      <slot></slot>

      <dl v-if="estimatedTimeLabel || filamentLabel" class="mt-2 flex flex-col gap-2 text-xs">
        <div v-if="estimatedTimeLabel">
          <dt class="text-muted">{{ t('printFiles.metadata.estimatedTime') }}</dt>
          <dd class="mt-1 font-mono font-black tabular-nums">{{ estimatedTimeLabel }}</dd>
        </div>
        <div v-if="filamentLabel">
          <dt class="text-muted">{{ t('dashboard.print.filament') }}</dt>
          <dd class="mt-1 font-mono font-black tabular-nums">{{ filamentLabel }}</dd>
        </div>
      </dl>
    </div>

    <!--
      The third `brand-trigger` instance (button-system.md): its size is the
      reserved preview square, not a button-scale tier, so it opts out of
      button chrome the same way the active job's preview toggle does. The
      image stays presentational — the button's own label says what clicking
      it does, and the filename is already on the card — per that pattern's
      accessible-name rule.
    -->
    <button
      v-if="thumbnailUrl"
      type="button"
      class="brand-trigger file-preview-thumbnail-frame"
      :aria-label="t('dashboard.print.expandThumbnail')"
      @click="isLightboxOpen = true"
    >
      <img :src="thumbnailUrl" alt="" class="file-preview-thumbnail" />
    </button>

    <ImageLightbox
      :open="isLightboxOpen"
      :src="thumbnailUrl ?? ''"
      :alt="t('printFiles.metadata.thumbnailAlt', { name: fileName })"
      @close="isLightboxOpen = false"
    />
  </div>
</template>
