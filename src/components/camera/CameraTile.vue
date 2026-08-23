<script setup lang="ts">
/**
 * One camera's picture, and everything around it that is not the picture: the
 * frame box, the flips and rotation, the name, the measured frame rate, the
 * stalled badge, the crosshair, and the two actions — still capture and
 * fullscreen.
 *
 * The streamers underneath differ in every respect except that they eventually
 * put pixels in a box. Everything shared lives here so that a camera behaves
 * the same whichever service it happens to be on — which is the specific thing
 * the reference implementations cannot promise, having written the visibility
 * handling, the aspect-ratio measurement and the restart logic separately
 * inside each streamer.
 *
 * **`active` is the load-bearing prop.** A stream nobody is looking at still
 * costs the printer's CPU and the network, and a Pi encoding two 1080p streams
 * for a card that is scrolled off screen is a print quality problem, not just a
 * waste. A tile is active only while its element is on screen, the browser tab
 * is in the foreground, and — in a card arranged as tabs — it is the selected
 * one.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import CameraCrosshair from '@/components/camera/CameraCrosshair.vue'
import {
  streamerFor,
  type CameraStreamStatus,
  type CameraSurface,
} from '@/components/camera/streamers/streamer'
import { cameraBoxAspectRatio, cameraFrameLayout, type Camera } from '@/features/camera/camera'
import { captureCameraStill, cameraStillFilename } from '@/features/camera/capture'
import { cameraCrosshair } from '@/features/camera/crosshair'
import { useToastsStore } from '@/stores/toasts'

const props = withDefaults(
  defineProps<{
    camera: Camera
    /**
     * False for a tile in a tab strip that is not the one showing. A tile with
     * no tab strip around it leaves this at its default.
     */
    selected?: boolean
    showLabel?: boolean
    showFrameRate?: boolean
    /**
     * `contain` shapes the tile to the stream, so the whole picture shows at the
     * card's full width. `cover` gives every tile one widescreen shape and crops
     * the streams into it. See `boxAspectRatio` below.
     */
    fit?: 'cover' | 'contain'
    /** Suppresses the hover actions where there is no room for them. */
    compact?: boolean
  }>(),
  { selected: true, showLabel: true, showFrameRate: true, fit: 'contain', compact: false },
)

const { t } = useI18n({ useScope: 'global' })
const toasts = useToastsStore()

const root = ref<HTMLElement | null>(null)
const status = ref<CameraStreamStatus>('connecting')
const surface = ref<CameraSurface>(null)
const measuredWidth = ref<number | null>(null)
const measuredHeight = ref<number | null>(null)
const frameRate = ref<number | null>(null)
const isOnScreen = ref(false)
const isDocumentVisible = ref(!document.hidden)
const isCapturing = ref(false)

const streamer = computed(() => streamerFor(props.camera.service))

const active = computed(
  () => props.selected && isOnScreen.value && isDocumentVisible.value && props.camera.enabled,
)

const measuredAspectRatio = computed(() => {
  const width = measuredWidth.value
  const height = measuredHeight.value
  if (width === null || height === null || height === 0) return null
  return width / height
})

/**
 * What `fit` actually decides.
 *
 * `contain` gives the tile the stream's own shape, so the whole picture shows at
 * the card's full width and nothing is cropped or letterboxed — the right answer
 * for one camera, and the default.
 *
 * `cover` gives every tile the same widescreen shape and crops the streams into
 * it. That is what makes a grid of mismatched cameras — a phone in portrait
 * beside a webcam in landscape — read as a row of equal tiles instead of one
 * very tall cell beside a short one.
 *
 * Both used to derive the box from the stream, which meant `object-fit` had a
 * box already shaped exactly like its contents and the setting changed nothing
 * at all.
 */
const boxAspectRatio = computed(() =>
  props.fit === 'cover' ? 16 / 9 : cameraBoxAspectRatio(props.camera, measuredAspectRatio.value),
)

const frameStyle = computed(() => cameraFrameLayout(props.camera, measuredAspectRatio.value))

const crosshairEnabled = computed(
  () =>
    cameraCrosshair(props.camera).enabled &&
    props.camera.traits.canCaptureStill &&
    !showsFailure.value,
)

/**
 * Shown only for a camera whose service can report frames and whose owner has
 * not switched it off. The reading is intentionally the rate frames reach the
 * browser, not the camera's configured rate: the configured one is already in
 * the settings, and the arriving one is what tells you the link or the Pi is
 * struggling.
 */
const showFrameRate = computed(
  () =>
    props.showFrameRate &&
    !props.compact &&
    props.camera.traits.reportsFrames &&
    props.camera.extraData.hideFps !== true &&
    frameRate.value !== null &&
    status.value === 'live',
)

const canCapture = computed(
  () => props.camera.traits.canCaptureStill && (surface.value !== null || props.camera.snapshotUrl),
)

/*
 * --- Frame counting ---
 *
 * Counted in one-second buckets rather than smoothed: a camera dropping from 15
 * to 8 should read 8 immediately, and a rolling average would spend several
 * seconds claiming a rate the stream is no longer delivering.
 */
let frames = 0
let rateTimer: ReturnType<typeof setInterval> | null = null

function onFrame(): void {
  frames += 1
}

function startRateTimer(): void {
  if (rateTimer !== null) return
  rateTimer = setInterval(() => {
    frameRate.value = frames
    frames = 0
  }, 1000)
}

function stopRateTimer(): void {
  if (rateTimer !== null) clearInterval(rateTimer)
  rateTimer = null
  frames = 0
  frameRate.value = null
}

watch(active, (isActive) => {
  if (isActive) startRateTimer()
  else stopRateTimer()
})

/*
 * --- The connect deadline ---
 *
 * A camera that never answers is the case this exists for, and it is common:
 * a phone running a camera app that has been closed, a USB camera unplugged, a
 * host powered down. None of them produce an error — the request simply stays
 * pending — so without a deadline the card shows black indefinitely with a
 * "connecting" dot beside it, which reads as "any moment now" rather than as
 * "this camera is not there".
 *
 * It lives here rather than in each streamer so the answer is the same for all
 * eleven of them. Ten seconds is long enough for a WebRTC handshake over a slow
 * link and short enough that nobody sits watching a black box wondering.
 */
const connectTimeoutMs = 10_000
const connectTimedOut = ref(false)
let connectTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Bumped to discard a failed attempt and start a clean one. It is part of the
 * streamer's `key`, so a bump remounts it — see "Recovering on its own" below.
 */
const retryToken = ref(0)

const hasFailed = computed(() => status.value === 'error' || connectTimedOut.value)

/**
 * What the tile *shows*, as opposed to what the retry loop reacts to.
 *
 * A retry puts the stream back to `connecting`, which cleared the failure
 * notice — so a dead camera flashed "No picture from this camera", went black
 * for the length of the next attempt, and said it again. The reader cannot act
 * on that, and the flicker reads as something happening when nothing is.
 *
 * So the notice latches: raised by the first failure, and cleared only by a
 * frame actually arriving. A camera that comes back replaces it with the
 * picture; one that stays dead keeps saying the same thing, steadily.
 */
const showsFailure = ref(false)

watch(hasFailed, (failed) => {
  if (failed) showsFailure.value = true
})

watch(status, (current) => {
  if (current === 'live' || current === 'stalled') showsFailure.value = false
})

/*
 * `retryToken` is a source here, not only in the retry watcher: a retry leaves
 * `status` at `connecting`, and a watch on an unchanged value does not fire, so
 * without it the *second* attempt got no deadline of its own and a camera that
 * stayed dead sat at "connecting" for the rest of the session after one failure.
 */
watch(
  [active, status, retryToken],
  ([isActive, current]) => {
    if (connectTimer !== null) clearTimeout(connectTimer)
    connectTimer = null
    if (current !== 'connecting') connectTimedOut.value = false
    if (!isActive || current !== 'connecting') return
    connectTimer = setTimeout(() => {
      connectTimedOut.value = true
    }, connectTimeoutMs)
  },
  { immediate: true },
)

/*
 * --- Recovering on its own ---
 *
 * A camera that comes back — a phone whose app was reopened, a host that
 * finished rebooting — has to reappear without anyone doing anything. Leaving
 * the page and returning fixed it, which is a remount, so remounting is the
 * fix: the token below is part of the streamer's `key`, and bumping it discards
 * whatever state the failed attempt was holding — a dropped websocket, a peer
 * connection in `failed`, the MJPEG renderer's latch onto its `<img>` fallback —
 * and starts clean.
 *
 * Reaching every streamer through one mechanism is the point. The alternative
 * is eleven reconnect loops, most of which would be written once and never
 * exercised.
 *
 * It stops while the tile is inactive, so a card scrolled off screen is not
 * quietly reconnecting to a dead camera every few seconds for the rest of the
 * session.
 */
const retryIntervalMs = 5000
let retryTimer: ReturnType<typeof setTimeout> | null = null

/*
 * A timeout rather than an interval: clearing the failed state re-runs this
 * watcher, and the next failure arms the next wait. The resulting cadence is one
 * attempt per connect deadline plus this pause, which is what "every few
 * seconds" means for a camera that answers slowly rather than not at all.
 */
watch(
  [active, hasFailed],
  ([isActive, failed]) => {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
    if (!isActive || !failed) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      connectTimedOut.value = false
      status.value = 'connecting'
      retryToken.value += 1
    }, retryIntervalMs)
  },
  { immediate: true },
)

/*
 * --- Visibility ---
 *
 * `IntersectionObserver` rather than a scroll listener, so a dashboard with
 * several cameras does not run layout maths on every scroll frame. A browser
 * without it (or a test environment) treats the tile as on screen, which is the
 * safe direction to fail: a stream that runs when it did not have to is a
 * waste, one that never runs is a broken card.
 */
let observer: IntersectionObserver | null = null

function onDocumentVisibility(): void {
  isDocumentVisible.value = !document.hidden
}

onMounted(() => {
  document.addEventListener('visibilitychange', onDocumentVisibility)
  if (typeof IntersectionObserver === 'undefined' || !root.value) {
    isOnScreen.value = true
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (entry) isOnScreen.value = entry.isIntersecting
    },
    // A little slack, so a tile just below the fold is already streaming by the
    // time it is scrolled to rather than starting up under the user's eye.
    { rootMargin: '200px' },
  )
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onDocumentVisibility)
  observer?.disconnect()
  observer = null
  stopRateTimer()
  if (connectTimer !== null) clearTimeout(connectTimer)
  if (retryTimer !== null) clearTimeout(retryTimer)
})

// A camera reconfigured while on screen may be a different resolution
// entirely; keeping the old measurement would lay the new stream out in the
// old stream's box.
watch(
  () => [props.camera.primaryUrl, props.camera.service],
  () => {
    measuredWidth.value = null
    measuredHeight.value = null
  },
)

function onSize(width: number, height: number): void {
  measuredWidth.value = width
  measuredHeight.value = height
}

/*
 * --- Actions ---
 */

async function captureStill(): Promise<void> {
  if (isCapturing.value) return
  isCapturing.value = true
  try {
    const blob = await captureCameraStill(props.camera, surface.value)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = cameraStillFilename(props.camera, new Date())
    link.click()
    // Revoked on the next task rather than immediately: Safari has not finished
    // reading the object URL by the time `click()` returns.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch {
    toasts.push(t('cameras.captureUnavailable'))
  } finally {
    isCapturing.value = false
  }
}

async function toggleFullscreen(): Promise<void> {
  const element = root.value
  if (!element) return
  try {
    if (document.fullscreenElement === element) await document.exitFullscreen()
    else await element.requestFullscreen()
  } catch {
    // A browser or an embedding context that refuses fullscreen needs no
    // explanation the user can act on.
  }
}
</script>

<template>
  <div
    ref="root"
    class="camera-tile"
    :class="{ 'camera-tile--contain': fit === 'contain', 'camera-tile--failed': showsFailure }"
    :style="{ aspectRatio: boxAspectRatio === null ? undefined : String(boxAspectRatio) }"
  >
    <div class="camera-tile__frame" :style="frameStyle">
      <component
        :is="streamer"
        :key="retryToken"
        :camera="camera"
        :active="active"
        @status="(next: CameraStreamStatus) => (status = next)"
        @size="onSize"
        @frame="onFrame"
        @surface="(next: CameraSurface) => (surface = next)"
      />
      <CameraCrosshair v-if="crosshairEnabled" :camera="camera" />
    </div>

    <p v-if="showsFailure" class="camera-tile__notice">
      <AppIcon name="cameraNoSignal" class="size-5 shrink-0" aria-hidden="true" />
      {{ t('cameras.streamFailed') }}
    </p>

    <span v-if="showLabel" class="camera-stage__label">
      <i
        aria-hidden="true"
        :class="`camera-stage__label-dot--${showsFailure ? 'error' : status}`"
      ></i
      >{{ camera.name }}
      <em v-if="status === 'stalled'" class="camera-tile__stalled">{{ t('cameras.stalled') }}</em>
    </span>

    <span v-if="showFrameRate" class="camera-tile__rate">
      {{ t('cameras.frameRate', { rate: frameRate }) }}
    </span>

    <div v-if="!compact" class="camera-tile__actions">
      <button
        v-if="canCapture"
        type="button"
        class="button button--on-strong button--quiet button--sm button--icon"
        :disabled="isCapturing"
        :aria-label="t('cameras.capture', { name: camera.name })"
        :title="t('cameras.capture', { name: camera.name })"
        @click="captureStill"
      >
        <AppIcon name="snapshot" class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="button button--on-strong button--quiet button--sm button--icon"
        :aria-label="t('cameras.fullscreen', { name: camera.name })"
        :title="t('cameras.fullscreen', { name: camera.name })"
        @click="toggleFullscreen"
      >
        <AppIcon name="fullscreen" class="size-4" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
