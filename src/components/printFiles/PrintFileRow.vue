<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import { formatHistoryDuration } from '@/features/history/format'
import { gcodeDisplayName } from '@/services/moonraker/files'
import type { GcodeFileEntry } from '@/stores/gcodeFiles'

/**
 * One file in Print files' list, a component for the reason `HistoryJobRow`
 * is one: Vue skips a child whose props did not change, so opening a file or
 * typing in the search box re-renders the rows that changed rather than every
 * file in a folder of hundreds. Every action is a declared emit for the same
 * reason — a declared listener is exempt from that props comparison, where a
 * callback prop would be a new function on every parent render.
 */
const props = defineProps<{
  file: GcodeFileEntry
  open: boolean
  thumbnailUrl: string | null
  /** The value the list is sorted by — a time, a date, or a size — which leads the row's line. */
  lead: string
  canPrint: boolean
  canQueue: boolean
}>()

defineEmits<{ toggle: []; print: []; queue: [] }>()

const { locale, t } = useI18n({ useScope: 'global' })

const name = computed(() => gcodeDisplayName(props.file.name))

const weightFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)

/** What a reader chooses a print by: the sort's own value, how long it takes, what it uses. */
const meta = computed(() => {
  const { details } = props.file
  return [
    props.lead,
    details.estimatedTime ? formatHistoryDuration(details.estimatedTime, t) : null,
    details.filamentWeight
      ? t('history.jobs.detail.weight', {
          value: weightFormatter.value.format(details.filamentWeight),
        })
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .reduce((first, second) => t('machine.updates.detailJoin', { first, second }))
})
</script>

<template>
  <div class="print-file machine-row" :class="{ 'machine-row--open': open }">
    <button
      type="button"
      class="file-select machine-row__toggle"
      :aria-expanded="open"
      :aria-controls="open ? 'print-file-details' : undefined"
      @click="$emit('toggle')"
    >
      <img
        v-if="thumbnailUrl"
        class="machine-row__thumb"
        :src="thumbnailUrl"
        alt=""
        loading="lazy"
        decoding="async"
      />
      <span v-else class="machine-row__thumb" aria-hidden="true"></span>
      <span class="machine-row__detail" :title="file.name">
        <span class="machine-row__name machine-row__name--identifier">{{ name }}</span>
        <span class="machine-row__meta">{{ meta }}</span>
      </span>
    </button>
    <span v-if="file.details.filamentType" class="machine-row__status print-file__material">
      <!-- The file's own reported color, not a theme token: the case `.filament-chip__swatch` exists for. -->
      <span
        v-if="file.details.filamentColor"
        class="filament-chip__swatch"
        :style="{ backgroundColor: file.details.filamentColor }"
        aria-hidden="true"
      ></span>
      <span class="print-file__material-label">{{ file.details.filamentType }}</span>
    </span>
    <HeaderMenu
      class="machine-row__menu"
      :label="t('printFiles.moreActions', { name })"
      align="end"
      trigger-size="sm"
      trigger-icon-only
    >
      <template #trigger>
        <AppIcon name="more" class="size-5" aria-hidden="true" />
      </template>
      <template #default="{ close }">
        <AppButton
          size="sm"
          start
          block
          icon="print"
          class="print-file__print"
          :label="t('printFiles.actions.print')"
          :disabled="!canPrint"
          @click="
            () => {
              $emit('print')
              close()
            }
          "
        />
        <AppButton
          variant="quiet"
          size="sm"
          start
          block
          icon="jobs"
          class="print-file__queue"
          :label="t('printFiles.actions.addToQueue')"
          :disabled="!canQueue"
          @click="
            () => {
              $emit('queue')
              close()
            }
          "
        />
      </template>
    </HeaderMenu>
  </div>
</template>
