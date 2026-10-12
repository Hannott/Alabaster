<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import PageHeading from '@/components/PageHeading.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { useAvailability } from '@/composables/useAvailability'
import { createTimeFormatter } from '@/i18n/formats'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useTimelapseStore, type TimelapseVideo } from '@/stores/timelapse'

const { locale, t } = useI18n({ useScope: 'global' })
const timelapse = useTimelapseStore()
const confirmations = useConfirmationsStore()
/* Moonraker offers no undelete, so this is terminal whatever the printer is doing. */
const deleteVideoGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'deleteTimelapseVideo',
})
const { availability: moonrakerAvailability } = useAvailability('moonraker')

/*
 * "Today" and "Yesterday" move at midnight, so the day labels read a clock
 * that ticks once a minute rather than the time the page happened to render.
 */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timelapse.start()
  clock = setInterval(() => (now.value = Date.now()), 60_000)
})

onBeforeUnmount(() => {
  timelapse.stop()
  clearInterval(clock)
})

const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)
/** Follows the 12- or 24-hour choice in Settings, which a bare `Intl` formatter would not. */
const timeFormatter = computed(() => createTimeFormatter(locale.value))
const dayFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }),
)

/** A size as a value and its unit, so the player can set the unit in the muted span. */
function sizeParts(bytes: number): { value: string; unit: string } {
  const megabytes = bytes / (1024 * 1024)
  if (megabytes >= 1024)
    return { value: numberFormatter.value.format(megabytes / 1024), unit: t('timelapse.unit.gb') }
  if (megabytes >= 1)
    return { value: numberFormatter.value.format(megabytes), unit: t('timelapse.unit.mb') }
  return { value: numberFormatter.value.format(bytes / 1024), unit: t('timelapse.unit.kb') }
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return t('units.emptySize')
  const { value, unit } = sizeParts(bytes)
  return t('timelapse.sizeValue', { value, unit })
}

function formatLength(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return t('timelapse.lengthValue', {
    minutes: Math.floor(whole / 60),
    seconds: String(whole % 60).padStart(2, '0'),
  })
}

function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Videos under the day they were recorded, newest first as the store keeps them. */
const videoGroups = computed(() => {
  const today = startOfDay(now.value)
  const yesterday = today - 86_400_000
  const groups: { key: number; label: string; videos: TimelapseVideo[] }[] = []
  for (const video of timelapse.videos) {
    const day = startOfDay(video.recordedAt * 1000)
    let group = groups.at(-1)
    if (!group || group.key !== day) {
      const label =
        day === today
          ? t('history.jobs.today')
          : day === yesterday
            ? t('history.jobs.yesterday')
            : dayFormatter.value.format(day)
      group = { key: day, label, videos: [] }
      groups.push(group)
    }
    group.videos.push(video)
  }
  return groups
})

function videoMeta(video: TimelapseVideo): string {
  return t('machine.updates.detailJoin', {
    first: timeFormatter.value.format(video.recordedAt * 1000),
    second: formatSize(video.size),
  })
}

const summary = computed(() => {
  if (timelapse.failed) return t('timelapse.failed')
  if (!timelapse.hasVideos) return t('timelapse.empty')
  return t('machine.updates.detailJoin', {
    first: t('timelapse.videoCount', { count: timelapse.videos.length }),
    second: formatSize(timelapse.totalSize),
  })
})

/*
 * Length and frame size are the video's own, read from the file once the
 * player has loaded its header — the listing has neither. Kept per path, so
 * going back to a video already played does not blank them again.
 */
const videoFacts = reactive(new Map<string, { length: number; width: number; height: number }>())

function onMetadata(path: string, event: Event): void {
  const element = event.target as HTMLVideoElement
  if (!Number.isFinite(element.duration)) return
  videoFacts.set(path, {
    length: element.duration,
    width: element.videoWidth,
    height: element.videoHeight,
  })
}

const selectedFacts = computed(() =>
  timelapse.selected ? (videoFacts.get(timelapse.selected.path) ?? null) : null,
)
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
  deleteVideoGuard.request(
    () => void timelapse.remove(video),
    () => (deletingVideo.value = video),
  )
}
</script>

<template>
  <section class="standard-page timelapse-view">
    <PageHeading :title="t('timelapse.title')" />

    <AvailabilityRegion requires="moonraker">
      <div class="timelapse-grid" :class="{ 'timelapse-grid--empty': !timelapse.selected }">
        <section
          v-if="timelapse.selected"
          class="machine-status-panel timelapse-player"
          aria-labelledby="timelapse-player-heading"
        >
          <header class="machine-panel-heading">
            <AppIcon name="camera" class="size-5 text-action" aria-hidden="true" />
            <h2 id="timelapse-player-heading" class="machine-row__name--identifier">
              {{ timelapse.selected.printName }}
            </h2>
            <div class="machine-panel-heading__actions">
              <a
                v-if="selectedUrl"
                class="button button--sm"
                :href="selectedUrl"
                :download="timelapse.selected.name"
              >
                <AppIcon name="download" class="size-4 shrink-0" aria-hidden="true" />
                <span>{{ t('timelapse.download') }}</span>
              </a>
              <HeaderMenu
                :label="t('timelapse.moreActions', { name: timelapse.selected.printName })"
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
                    icon="trash"
                    class="timelapse-player__delete"
                    :guard="deleteVideoGuard"
                    :label="t('timelapse.delete')"
                    :disabled="!moonrakerAvailability.isAvailable"
                    @click="
                      () => {
                        if (timelapse.selected) requestDelete(timelapse.selected)
                        close()
                      }
                    "
                  />
                </template>
              </HeaderMenu>
            </div>
          </header>
          <div class="timelapse-stage">
            <!--
              Controls, no autoplay: a page that starts making noise when it
              opens is a page nobody opens twice. `key` forces a fresh element
              per video, since a `src` swap on a playing element keeps the old
              frame.
            -->
            <video
              v-if="selectedUrl"
              :key="timelapse.selected.path"
              controls
              preload="metadata"
              :poster="timelapse.previewUrlFor(timelapse.selected) ?? undefined"
              :src="selectedUrl"
              @loadedmetadata="onMetadata(timelapse.selected.path, $event)"
            ></video>
          </div>
          <dl class="machine-host__stats selectable">
            <div class="machine-stat">
              <dt>{{ t('timelapse.recorded') }}</dt>
              <dd class="machine-stat__value">
                <strong>{{ timeFormatter.format(timelapse.selected.recordedAt * 1000) }}</strong>
              </dd>
              <dd class="machine-stat__detail">
                {{ dayFormatter.format(timelapse.selected.recordedAt * 1000) }}
              </dd>
            </div>
            <div class="machine-stat">
              <dt>{{ t('timelapse.length') }}</dt>
              <dd class="machine-stat__value">
                <strong>{{
                  selectedFacts ? formatLength(selectedFacts.length) : t('timelapse.noValue')
                }}</strong>
              </dd>
              <dd v-if="selectedFacts && selectedFacts.width > 0" class="machine-stat__detail">
                {{
                  t('timelapse.frameSize', {
                    width: selectedFacts.width,
                    height: selectedFacts.height,
                  })
                }}
              </dd>
            </div>
            <div class="machine-stat">
              <dt>{{ t('timelapse.size') }}</dt>
              <dd class="machine-stat__value">
                <strong>{{ sizeParts(timelapse.selected.size).value }}</strong>
                <span>{{ sizeParts(timelapse.selected.size).unit }}</span>
              </dd>
              <dd class="machine-stat__detail" :title="timelapse.selected.name">
                {{ timelapse.selected.name }}
              </dd>
            </div>
          </dl>
        </section>

        <section
          class="machine-status-panel machine-list-panel timelapse-videos"
          aria-labelledby="timelapse-videos-heading"
        >
          <header class="machine-panel-heading">
            <AppIcon name="camera" class="size-5 text-action" aria-hidden="true" />
            <h2 id="timelapse-videos-heading">{{ t('timelapse.videos') }}</h2>
            <div class="machine-panel-heading__actions">
              <AppButton
                size="sm"
                icon-only
                icon="refresh"
                :pending="timelapse.isLoading"
                :disabled="!moonrakerAvailability.isAvailable"
                :aria-label="t('timelapse.refresh')"
                :title="t('timelapse.refresh')"
                @click="timelapse.refresh()"
              />
            </div>
          </header>
          <p class="machine-panel-summary" :role="timelapse.failed ? 'status' : undefined">
            {{ summary }}
          </p>
          <div v-if="timelapse.hasVideos" class="machine-list machine-list--media">
            <template v-for="group in videoGroups" :key="group.key">
              <p class="machine-list__label">{{ group.label }}</p>
              <div
                v-for="video in group.videos"
                :key="video.path"
                class="timelapse-video machine-row"
                :class="{ 'machine-row--current': video.path === timelapse.selected?.path }"
              >
                <button
                  type="button"
                  class="file-select machine-row__toggle"
                  :aria-current="video.path === timelapse.selected?.path ? 'true' : undefined"
                  @click="timelapse.select(video.path)"
                >
                  <img
                    v-if="timelapse.previewUrlFor(video)"
                    class="machine-row__thumb machine-row__thumb--frame"
                    :src="timelapse.previewUrlFor(video) ?? undefined"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span v-else class="machine-row__thumb" aria-hidden="true"></span>
                  <span class="machine-row__detail" :title="video.name">
                    <span class="machine-row__name machine-row__name--identifier">
                      {{ video.printName }}
                    </span>
                    <span class="machine-row__meta">{{ videoMeta(video) }}</span>
                  </span>
                </button>
                <HeaderMenu
                  class="machine-row__menu"
                  :label="t('timelapse.moreActions', { name: video.printName })"
                  align="end"
                  trigger-size="sm"
                  trigger-icon-only
                >
                  <template #trigger>
                    <AppIcon name="more" class="size-5" aria-hidden="true" />
                  </template>
                  <template #default="{ close }">
                    <a
                      v-if="timelapse.urlFor(video)"
                      class="button button--quiet button--sm button--block button--start"
                      :href="timelapse.urlFor(video) ?? undefined"
                      :download="video.name"
                      @click="close()"
                    >
                      <AppIcon name="download" class="size-4 shrink-0" aria-hidden="true" />
                      <span>{{ t('timelapse.download') }}</span>
                    </a>
                    <AppButton
                      size="sm"
                      start
                      block
                      icon="trash"
                      class="timelapse-video__delete"
                      :guard="deleteVideoGuard"
                      :label="t('timelapse.delete')"
                      :disabled="!moonrakerAvailability.isAvailable"
                      @click="
                        () => {
                          requestDelete(video)
                          close()
                        }
                      "
                    />
                  </template>
                </HeaderMenu>
              </div>
            </template>
          </div>
        </section>
      </div>
    </AvailabilityRegion>

    <ConfirmDialog
      :open="deletingVideo !== null"
      :title="t('timelapse.deleteTitle')"
      :description="t('timelapse.deleteConfirm', { name: deletingVideo?.name ?? '' })"
      :confirm-label="t('timelapse.delete')"
      tone="danger"
      show-skip-option
      @confirm="confirmDelete"
      @cancel="deletingVideo = null"
      @skip="confirmations.setSkip('deleteTimelapseVideo', true)"
    />
  </section>
</template>
