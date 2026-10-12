<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ReleaseNoteInlines from '@/components/ReleaseNoteInlines'
import type { ReleaseNote } from '@/features/machine/releaseNotes'
import { createDateFormatter } from '@/i18n/formats'

/**
 * The release-notes counterpart of `UpdateCommitList`: what a `web` or `zip`
 * source's update contains, one release per entry, newest first, in the same
 * capped, scrolling box so a source several releases behind never pushes the
 * confirmation's actions off-screen.
 */
const props = defineProps<{ releases: readonly ReleaseNote[] }>()

const { locale } = useI18n({ useScope: 'global' })
const dateFormatter = computed(() => createDateFormatter(locale.value))

function publishedDate(value: string | null): string | null {
  if (value === null) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : dateFormatter.value.format(date)
}
</script>

<template>
  <ol class="update-recovery-commits release-notes selectable">
    <li v-for="release in props.releases" :key="release.tag">
      <p class="update-recovery-commit__subject">{{ release.name }}</p>
      <p v-if="publishedDate(release.publishedAt)" class="update-recovery-commit__meta">
        <span>{{ publishedDate(release.publishedAt) }}</span>
      </p>
      <template v-for="(block, index) in release.blocks" :key="index">
        <p v-if="block.kind === 'heading'" class="release-notes__heading">
          <ReleaseNoteInlines :inlines="block.inlines" />
        </p>
        <ul v-else-if="block.kind === 'list'" class="release-notes__list">
          <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
            <ReleaseNoteInlines :inlines="item" />
          </li>
        </ul>
        <p v-else class="release-notes__paragraph">
          <ReleaseNoteInlines :inlines="block.inlines" />
        </p>
      </template>
    </li>
  </ol>
</template>
