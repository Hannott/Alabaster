<script setup lang="ts">
/**
 * What is inside the file chip's popover: a search box, the printing file
 * pinned to the top when there is one, the printer's files newest first, and
 * a local file last.
 *
 * The old viewer spent a whole sidebar card on this — a search box, a native
 * select, Load, Refresh files, Load current print, a divider reading "or", and
 * Open local file, seven controls to open one file. Here the list *is* the
 * control: a row is a file and clicking it loads that file, so there is no
 * separate Load. Refresh is gone too, because the file list already follows
 * Moonraker's notifications and a button that re-asks for data we are
 * subscribed to only invites the user to doubt the data.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppIcon from '@/components/AppIcon.vue'
import type { MoonrakerFileInfo } from '@/services/moonraker'

const props = defineProps<{
  files: readonly MoonrakerFileInfo[]
  /** Path of the file the printer is running, if any, already normalized. */
  printingPath: string | null
  /** Path of the loaded file, so the list can mark it. */
  loadedPath: string | null
  formatSize: (bytes: number) => string
  formatModified: (modified: number | null) => string
}>()

const emit = defineEmits<{ select: [string]; local: []; close: [] }>()

const search = defineModel<string>('search', { required: true })
const { t, n } = useI18n({ useScope: 'global' })

const matches = computed(() => {
  const query = search.value.trim().toLowerCase()
  const files = query
    ? props.files.filter((file) => file.path.toLowerCase().includes(query))
    : [...props.files]
  // Newest first: the file someone wants to look at is almost always the one
  // they just sliced.
  return files.sort((left, right) => (right.modified ?? 0) - (left.modified ?? 0)).slice(0, 200)
})

const printing = computed(
  () => props.files.find((file) => file.path === props.printingPath) ?? null,
)
const others = computed(() => matches.value.filter((file) => file.path !== props.printingPath))

function choose(path: string): void {
  emit('select', path)
  emit('close')
}

/** One call, because an inline handler may not be two statements. */
function chooseLocal(): void {
  emit('local')
  emit('close')
}
</script>

<template>
  <div class="gcode-picker">
    <AppField
      v-model="search"
      class="gcode-picker__search"
      type="text"
      size="sm"
      :label="t('gcodeViewer.files.search')"
      :placeholder="t('gcodeViewer.files.searchPlaceholder', { count: n(props.files.length) })"
    />

    <div class="gcode-picker__list">
      <AppButton
        v-if="printing"
        variant="quiet"
        size="sm"
        block
        class="gcode-picker__row gcode-picker__row--printing"
        :aria-pressed="printing.path === props.loadedPath ? 'true' : 'false'"
        @click="choose(printing.path)"
      >
        <AppIcon name="print" class="size-4 shrink-0" aria-hidden="true" />
        <span class="gcode-picker__name">{{ printing.path }}</span>
        <span class="gcode-picker__meta">{{ t('gcodeViewer.files.printingNow') }}</span>
      </AppButton>

      <AppButton
        v-for="file in others"
        :key="file.path"
        variant="quiet"
        size="sm"
        block
        class="gcode-picker__row"
        :aria-pressed="file.path === props.loadedPath ? 'true' : 'false'"
        @click="choose(file.path)"
      >
        <span class="gcode-picker__name">{{ file.path }}</span>
        <span class="gcode-picker__meta">
          {{ props.formatSize(file.size ?? 0) }}
          <template v-if="file.modified">· {{ props.formatModified(file.modified) }}</template>
        </span>
      </AppButton>

      <p v-if="others.length === 0 && !printing" class="gcode-picker__empty">
        {{ t('gcodeViewer.files.noMatches') }}
      </p>
    </div>

    <AppButton
      variant="quiet"
      size="sm"
      block
      class="gcode-picker__row gcode-picker__row--local"
      @click="chooseLocal()"
    >
      <AppIcon name="fileText" class="size-4 shrink-0" aria-hidden="true" />
      <span class="gcode-picker__name">{{ t('gcodeViewer.files.openLocal') }}</span>
      <span class="gcode-picker__meta">{{ t('gcodeViewer.files.noUpload') }}</span>
    </AppButton>
  </div>
</template>
