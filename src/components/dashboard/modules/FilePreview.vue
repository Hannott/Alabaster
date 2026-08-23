<script setup lang="ts">
import { useI18n } from 'vue-i18n'

/**
 * A queued or selectable G-code file's own column — Print's "Up next" job
 * and each expanded Recent files row — beside a thumbnail that fills
 * whatever width is left over. Takes display-ready strings rather than raw
 * metadata so both call sites keep sharing `PrintModule`'s own locale-aware
 * formatters (`formatDuration`, `weightFormatter`) instead of a second copy
 * living here.
 *
 * The default slot holds whatever identifies the file — "Up next"'s eyebrow
 * and filename, nothing for a Recent files row, which already names the file
 * on the button that expanded this — stacked above the estimated-time/
 * filament stats, all inside the one column the thumbnail sits beside.
 *
 * The thumbnail's frame is a flex sibling of that column with no basis of
 * its own (`flex: 1 1 auto`), so it absorbs whatever width the column
 * doesn't need rather than reserving a fixed size — "fill the available
 * space" was the point once a fixed-width preview read as too small for how
 * much room a card actually had. Its height is never its own: the frame has
 * no explicit height, so in this row's default `align-items: stretch` it
 * takes exactly the column's content height, and the image inside is
 * absolutely positioned to fill that frame — never the reverse, where the
 * thumbnail's own intrinsic size could grow the row (and the card) past what
 * the column needed.
 */
defineProps<{
  estimatedTimeLabel: string | null
  filamentLabel: string | null
  thumbnailUrl: string | null
}>()

const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <div class="flex min-w-0 gap-4">
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

    <div v-if="thumbnailUrl" class="file-preview-thumbnail-frame">
      <img :src="thumbnailUrl" alt="" class="file-preview-thumbnail" />
    </div>
  </div>
</template>
