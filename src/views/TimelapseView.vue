<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PageHeading from '@/components/PageHeading.vue'
import type { PageHeadingAction } from '@/components/PageHeading.vue'
import { useAvailability } from '@/composables/useAvailability'
import { createDateTimeFormatter } from '@/i18n/formats'
import { useActionGuard } from '@/composables/useActionGuard'
import { useTimelapseStore, type TimelapseVideo } from '@/stores/timelapse'

const { locale, t } = useI18n({ useScope: 'global' })
const timelapse = useTimelapseStore()
/* Moonraker offers no undelete, so this is terminal whatever the printer is doing. */
const deleteVideoGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'deleteTimelapseVideo',
})
const { availability: moonrakerAvailability } = useAvailability('moonraker')

const refreshAction = computed<PageHeadingAction>(() => ({
  label: t('timelapse.refresh'),
  icon: 'refresh',
  onClick: () => timelapse.refresh(),
  disabled: !moonrakerAvailability.value.isAvailable,
  pending: timelapse.isLoading,
}))

onMounted(() => {
  timelapse.start()
})

onBeforeUnmount(() => {
  timelapse.stop()
})

const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)
const dateFormatter = computed(() => createDateTimeFormatter(locale.value))

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return t('units.emptySize')
  if (bytes < 1024 * 1024)
    return t('units.size.kilobytes', { value: numberFormatter.value.format(bytes / 1024) })
  return t('units.size.megabytes', {
    value: numberFormatter.value.format(bytes / (1024 * 1024)),
  })
}

function formatWhen(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return t('timelapse.noValue')
  return dateFormatter.value.format(seconds * 1000)
}

const selectedUrl = computed(() =>
  timelapse.selected ? timelapse.urlFor(timelapse.selected) : null,
)

const deletingVideo = ref<TimelapseVideo | null>(null)

async function confirmDelete(): Promise<void> {
  const video = deletingVideo.value
  deletingVideo.value = null
  if (video) await timelapse.remove(video)
}

function requestDelete(video: TimelapseVideo): void {
  if (deleteVideoGuard.guarded.value) deletingVideo.value = video
  else void timelapse.remove(video)
}
</script>

<template>
  <section class="standard-page timelapse-view">
    <PageHeading :title="t('timelapse.title')" :action="refreshAction" />

    <!--
      `flex-1` without `min-h-0` for the same reason as HistoryView: the region
      must grow with a long video list so it stays in-flow and the page shell's
      bottom padding lands after it, while still stretching to fill the page
      when the unavailable placeholder is all there is.
    -->
    <AvailabilityRegion requires="moonraker" class="flex-1">
      <div class="page-column">
        <section
          v-if="timelapse.selected && selectedUrl"
          class="page-card timelapse-player"
          :aria-label="timelapse.selected.name"
        >
          <header class="calibration-panel__header">
            <h2 class="calibration-panel__title">{{ timelapse.selected.name }}</h2>
            <div class="calibration-panel__actions">
              <a class="button button--xs" :href="selectedUrl" download>
                <AppIcon name="download" class="size-4" aria-hidden="true" />
                {{ t('timelapse.download') }}
              </a>
              <AppButton
                variant="quiet"
                size="xs"
                :label="t('timelapse.close')"
                @click="timelapse.select(null)"
              />
            </div>
          </header>
          <!--
            Controls, no autoplay: a page that starts making noise when it opens
            is a page nobody opens twice. `key` forces a fresh element per video,
            since a `src` swap on a playing element keeps the old frame.
          -->
          <video
            :key="timelapse.selected.path"
            class="timelapse-player__video"
            controls
            preload="metadata"
            :src="selectedUrl"
          ></video>
        </section>

        <section class="page-card timelapse-panel" :aria-label="t('timelapse.list')">
          <p v-if="timelapse.failed" class="calibration-notice" role="status">
            <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
            <span>{{ t('timelapse.failed') }}</span>
          </p>

          <ul v-if="timelapse.hasVideos" class="timelapse-list">
            <li v-for="video in timelapse.videos" :key="video.path" class="timelapse-item">
              <button
                type="button"
                class="file-select timelapse-item__open"
                :aria-current="video.path === timelapse.selectedPath ? 'true' : undefined"
                @click="timelapse.select(video.path)"
              >
                <AppIcon name="camera" class="size-4 shrink-0" aria-hidden="true" />
                <span class="timelapse-item__name">{{ video.name }}</span>
              </button>
              <span class="timelapse-item__facts">
                <span>{{ formatWhen(video.modified) }}</span>
                <span>{{ formatSize(video.size) }}</span>
              </span>
              <AppButton
                size="xs"
                :guard="deleteVideoGuard"
                :label="t('timelapse.delete')"
                :disabled="!moonrakerAvailability.isAvailable"
                @click="requestDelete(video)"
              />
            </li>
          </ul>
          <p v-else-if="!timelapse.isLoading" class="calibration-panel__hint">
            {{ t('timelapse.empty') }}
          </p>
        </section>
      </div>
    </AvailabilityRegion>

    <ConfirmDialog
      :open="deletingVideo !== null"
      :title="t('timelapse.deleteTitle')"
      :description="t('timelapse.deleteConfirm', { name: deletingVideo?.name ?? '' })"
      :confirm-label="t('timelapse.delete')"
      tone="danger"
      @confirm="confirmDelete"
      @cancel="deletingVideo = null"
    />
  </section>
</template>
