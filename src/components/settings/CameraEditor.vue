<script setup lang="ts">
/**
 * The form for one camera, with that camera live beside it.
 *
 * This is a real form on a page rather than a dialog, per `dialog-system.md`'s
 * own rule that a multi-field need is Settings' inline-form pattern — the same
 * pattern the Users card already uses. It matters more here than there: the
 * fields on this form are almost all guesses until you see the result. Which
 * way up the picture is, whether the URL is right, whether "adaptive" behaves
 * better than the plain stream on this network — every one of those is answered
 * by looking, and a form that covers the picture makes you close it to find out.
 *
 * Which fields exist follows the service's own traits rather than a list per
 * service, so a rotation control appears for everything that can be rotated and
 * a target frame rate only for the two services that pace themselves. Offering
 * a field the renderer ignores is the failure that avoids: a value set, saved,
 * and silently doing nothing.
 *
 * A camera declared in `moonraker.conf` is shown and not edited. Moonraker
 * refuses to modify or delete one, so a save button here would be a button that
 * always fails.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppSelect from '@/components/AppSelect.vue'
import AppSlider from '@/components/AppSlider.vue'
import CameraTile from '@/components/camera/CameraTile.vue'
import { dashboardColorTokens, type DashboardColorKey } from '@/dashboard/colorTokens'
import { cameraDefaults, normalizeCamera, type Camera } from '@/features/camera/camera'
import { cameraCrosshair, crosshairDefaultSize, resolveTokenHex } from '@/features/camera/crosshair'
import {
  cameraRotations,
  cameraServiceList,
  isCameraServiceId,
  parseAspectRatio,
  type CameraRotation,
  type CameraServiceId,
} from '@/features/camera/services'
import type { MoonrakerWebcam, MoonrakerWebcamPatch } from '@/services/moonraker'
import { useMoonrakerStore } from '@/stores/moonraker'
import { useWebcamsStore } from '@/stores/webcams'

const props = defineProps<{
  /** The camera being edited, or null when adding one. */
  camera: Camera | null
  /** Every camera's name, for the uniqueness check Moonraker enforces. */
  takenNames: readonly string[]
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n({ useScope: 'global' })
const webcams = useWebcamsStore()
const moonraker = useMoonrakerStore()

interface Draft {
  name: string
  service: CameraServiceId
  streamUrl: string
  snapshotUrl: string
  location: string
  enabled: boolean
  targetFps: number
  targetFpsIdle: number
  rotation: CameraRotation
  flipHorizontal: boolean
  flipVertical: boolean
  aspectRatio: string
  enableAudio: boolean
  hideFrameRate: boolean
  crosshair: boolean
  /**
   * One of the shared palette's seven keys, or null for "whatever the theme
   * draws". Not a hex: the stored colour follows the theme pack, and the hex
   * written alongside it for other interfaces is derived from this — see
   * `features/camera/crosshair.ts`.
   */
  crosshairColor: DashboardColorKey | null
  crosshairSize: number
}

function draftFrom(camera: Camera | null): Draft {
  const crosshair = camera ? cameraCrosshair(camera) : null
  return {
    name: camera?.name ?? '',
    service: camera?.service ?? cameraDefaults.service,
    // The raw stored value, not the resolved one: a relative path someone typed
    // has to survive a round trip through this form, or editing an unrelated
    // field would quietly pin the camera to one host.
    streamUrl: camera?.rawStreamUrl ?? '',
    snapshotUrl: camera?.rawSnapshotUrl ?? '',
    location: camera?.location ?? cameraDefaults.location,
    enabled: camera?.enabled ?? true,
    targetFps: camera?.targetFps ?? cameraDefaults.targetFps,
    targetFpsIdle: camera?.targetFpsIdle ?? cameraDefaults.targetFpsIdle,
    rotation: camera?.rotation ?? cameraDefaults.rotation,
    flipHorizontal: camera?.flipHorizontal ?? false,
    flipVertical: camera?.flipVertical ?? false,
    aspectRatio: camera?.aspectRatioText ?? cameraDefaults.aspectRatio,
    enableAudio: camera?.extraData.enableAudio === true,
    hideFrameRate: camera?.extraData.hideFps === true,
    crosshair: crosshair?.enabled ?? false,
    crosshairColor: crosshair?.colorKey ?? null,
    crosshairSize: crosshair?.size ?? crosshairDefaultSize,
  }
}

const draft = ref<Draft>(draftFrom(props.camera))

/**
 * Explicitly boolean rather than `camera?.isReadOnly`: `AppSelect` and
 * `AppSlider` both declare `disabled` as a plain optional boolean, and under
 * `exactOptionalPropertyTypes` an `undefined` from optional chaining is not the
 * same thing as the prop being absent.
 */
const isReadOnly = computed(() => props.camera?.isReadOnly === true)

// Reseeded when the editor is pointed at a different camera. Not a deep watch
// on the camera itself: a live reload from `notify_webcams_changed` — which the
// editor's own save triggers — would otherwise discard whatever else the user
// had typed since.
watch(
  () => props.camera?.uid ?? null,
  () => {
    draft.value = draftFrom(props.camera)
    testResult.value = null
  },
)

const traits = computed(
  () =>
    cameraServiceList.find((entry) => entry.id === draft.value.service) ?? cameraServiceList[0]!,
)

const serviceOptions = computed(() =>
  cameraServiceList.map((entry) => ({ value: entry.id, label: t(entry.labelKey) })),
)

function changeService(value: string): void {
  if (isCameraServiceId(value)) draft.value.service = value
}

/*
 * --- Validation ---
 *
 * Only what Moonraker itself will refuse, plus the one thing it accepts and the
 * renderer cannot use. Everything else is left to the preview: a URL that is
 * well-formed and wrong is not something a form can catch, and refusing to save
 * anything that has not proven itself would make an offline printer
 * unconfigurable.
 */
const nameError = computed(() => {
  const name = draft.value.name.trim()
  if (name === '') return t('cameras.errors.nameRequired')
  const taken = props.takenNames.some(
    (existing) =>
      existing.toLowerCase() === name.toLowerCase() &&
      existing.toLowerCase() !== (props.camera?.name ?? '').toLowerCase(),
  )
  return taken ? t('cameras.errors.nameTaken') : null
})

const urlError = computed(() => {
  const needed =
    traits.value.primaryUrl === 'snapshot' ? draft.value.snapshotUrl : draft.value.streamUrl
  return needed.trim() === '' ? t('cameras.errors.urlRequired') : null
})

const aspectRatioError = computed(() =>
  traits.value.needsDeclaredAspectRatio && parseAspectRatio(draft.value.aspectRatio) === null
    ? t('cameras.errors.aspectRatio')
    : null,
)

const canSave = computed(
  () => nameError.value === null && urlError.value === null && aspectRatioError.value === null,
)

/*
 * --- The live preview ---
 *
 * Built from the draft rather than from the stored camera, so it answers the
 * form as it is being typed. Debounced because it is a real connection: every
 * keystroke in a URL field would otherwise open and abandon a stream, and on a
 * WebRTC service each of those is a full signalling handshake against the
 * printer.
 */
const previewDraft = ref<Draft>({ ...draft.value })
let previewTimer: ReturnType<typeof setTimeout> | null = null

watch(
  draft,
  (next) => {
    if (previewTimer !== null) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
      previewDraft.value = { ...next }
    }, 600)
  },
  { deep: true },
)

function webcamFrom(source: Draft): MoonrakerWebcam {
  return {
    uid: props.camera?.uid ?? 'preview',
    name: source.name === '' ? t('cameras.previewName') : source.name,
    location: source.location,
    service: source.service,
    enabled: true,
    stream_url: source.streamUrl,
    snapshot_url: source.snapshotUrl,
    target_fps: source.targetFps,
    target_fps_idle: source.targetFpsIdle,
    flip_horizontal: source.flipHorizontal,
    flip_vertical: source.flipVertical,
    rotation: source.rotation,
    aspect_ratio: source.aspectRatio,
    extra_data: {
      enableAudio: source.enableAudio,
      hideFps: source.hideFrameRate,
      ...crosshairExtraData(source),
    },
  }
}

/**
 * The crosshair's two stored fields: Alabaster's palette key, and the hex the
 * key resolves to so a crosshair set here also shows up in Mainsail. The hex is
 * omitted rather than guessed where the token cannot be resolved, which leaves
 * whatever another interface had already stored intact.
 */
function crosshairExtraData(source: Draft): Record<string, unknown> {
  const variable = dashboardColorTokens.find(
    (token) => token.key === source.crosshairColor,
  )?.variable
  const hex = variable === undefined ? null : resolveTokenHex(variable)
  return {
    nozzleCrosshair: source.crosshair,
    nozzleCrosshairSize: source.crosshairSize,
    alabasterCrosshairColor: source.crosshairColor,
    ...(hex === null ? {} : { nozzleCrosshairColor: hex }),
  }
}

/**
 * The preview always renders as enabled, whatever the switch says: the switch
 * decides whether the dashboard streams this camera, and someone configuring a
 * camera they have not switched on yet still has to see it to configure it.
 */
const previewCamera = computed<Camera>(() =>
  normalizeCamera(webcamFrom(previewDraft.value), moonraker.endpoint),
)

/*
 * --- Saving ---
 */

function patchFrom(source: Draft): MoonrakerWebcamPatch {
  const patch: MoonrakerWebcamPatch = {
    name: source.name.trim(),
    location: source.location.trim() || cameraDefaults.location,
    service: source.service,
    enabled: source.enabled,
    stream_url: source.streamUrl.trim(),
    snapshot_url: source.snapshotUrl.trim(),
    target_fps: source.targetFps,
    target_fps_idle: source.targetFpsIdle,
    flip_horizontal: source.flipHorizontal,
    flip_vertical: source.flipVertical,
    rotation: source.rotation,
    aspect_ratio: source.aspectRatio.trim() || cameraDefaults.aspectRatio,
    // Merged over whatever was stored rather than replacing it. `extra_data` is
    // a shared scratch space between every client on this printer, and
    // overwriting it wholesale would silently discard a key Mainsail or Fluidd
    // put there.
    extra_data: {
      ...(props.camera?.extraData ?? {}),
      enableAudio: source.enableAudio,
      hideFps: source.hideFrameRate,
      ...crosshairExtraData(source),
    },
  }
  if (props.camera) patch.uid = props.camera.uid
  return patch
}

async function save(): Promise<void> {
  if (!canSave.value) return
  if (await webcams.save(patchFrom(draft.value))) emit('close')
}

/*
 * --- Reachability test ---
 *
 * Asks Moonraker to fetch the snapshot from the printer's own network, which
 * answers a question the preview cannot: a camera the printer can reach and the
 * browser cannot is a URL problem — an internal hostname, or a mixed-content
 * block on an HTTPS page — not a camera that is off.
 *
 * Only for a saved camera, because the API takes a stored UID.
 */
const testResult = ref<'reachable' | 'unreachable' | null>(null)

async function runTest(): Promise<void> {
  const uid = props.camera?.uid
  if (uid === undefined) return
  const result = await webcams.test(uid)
  testResult.value =
    result === null ? null : result.snapshot_reachable ? 'reachable' : 'unreachable'
}
</script>

<template>
  <form class="camera-editor" @submit.prevent="save">
    <div class="camera-editor__fields">
      <p v-if="camera?.isReadOnly" class="camera-editor__readonly">
        <AppIcon name="lock" class="size-4 shrink-0" aria-hidden="true" />
        {{ t('cameras.readOnly') }}
      </p>

      <label for="camera-name" class="block text-field-label text-muted">
        {{ t('cameras.name') }}
      </label>
      <input
        id="camera-name"
        v-model="draft.name"
        type="text"
        class="field field--sm field--block mt-2"
        autocomplete="off"
        maxlength="64"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        :disabled="camera?.isReadOnly"
        :aria-invalid="nameError !== null"
      />
      <p v-if="nameError" class="camera-editor__error" role="alert">{{ nameError }}</p>

      <div class="mt-4">
        <span class="block text-field-label text-muted">{{ t('cameras.service') }}</span>
        <AppSelect
          class="mt-2"
          :model-value="draft.service"
          :options="serviceOptions"
          :label="t('cameras.service')"
          :disabled="isReadOnly"
          @update:model-value="changeService"
        />
      </div>

      <label for="camera-stream-url" class="mt-4 block text-field-label text-muted">
        {{ t('cameras.streamUrl') }}
      </label>
      <input
        id="camera-stream-url"
        v-model="draft.streamUrl"
        type="text"
        inputmode="url"
        class="field field--sm field--block mt-2"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        :placeholder="t('cameras.streamUrlPlaceholder')"
        :disabled="camera?.isReadOnly"
      />

      <label for="camera-snapshot-url" class="mt-4 block text-field-label text-muted">
        {{ t('cameras.snapshotUrl') }}
      </label>
      <input
        id="camera-snapshot-url"
        v-model="draft.snapshotUrl"
        type="text"
        inputmode="url"
        class="field field--sm field--block mt-2"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        :placeholder="t('cameras.snapshotUrlPlaceholder')"
        :disabled="camera?.isReadOnly"
      />
      <p class="module-settings__hint">{{ t('cameras.snapshotUrlHint') }}</p>
      <p v-if="urlError" class="camera-editor__error" role="alert">{{ urlError }}</p>

      <div v-if="traits.needsDeclaredAspectRatio" class="mt-4">
        <label for="camera-aspect" class="block text-field-label text-muted">
          {{ t('cameras.aspectRatio') }}
        </label>
        <input
          id="camera-aspect"
          v-model="draft.aspectRatio"
          type="text"
          class="field field--sm mt-2"
          autocomplete="off"
          spellcheck="false"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          placeholder="16:9"
          :disabled="camera?.isReadOnly"
          :aria-invalid="aspectRatioError !== null"
        />
        <p v-if="aspectRatioError" class="camera-editor__error" role="alert">
          {{ aspectRatioError }}
        </p>
      </div>

      <div v-if="traits.usesTargetFps" class="mt-4 flex flex-wrap gap-4">
        <div>
          <label for="camera-fps" class="block text-field-label text-muted">
            {{ t('cameras.targetFps') }}
          </label>
          <input
            id="camera-fps"
            v-model.number="draft.targetFps"
            type="number"
            min="1"
            max="60"
            class="field field--sm mt-2"
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            :disabled="camera?.isReadOnly"
          />
        </div>
        <div>
          <label for="camera-fps-idle" class="block text-field-label text-muted">
            {{ t('cameras.targetFpsIdle') }}
          </label>
          <input
            id="camera-fps-idle"
            v-model.number="draft.targetFpsIdle"
            type="number"
            min="1"
            max="60"
            class="field field--sm mt-2"
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            :disabled="camera?.isReadOnly"
          />
        </div>
      </div>
      <p v-if="traits.usesTargetFps" class="module-settings__hint">
        {{ t('cameras.targetFpsHint') }}
      </p>

      <div class="mt-4">
        <span class="block text-field-label text-muted">{{ t('cameras.rotation') }}</span>
        <div class="segmented mt-2">
          <AppButton
            v-for="option in cameraRotations"
            :key="option"
            size="sm"
            mono
            :aria-pressed="draft.rotation === option"
            :disabled="camera?.isReadOnly"
            @click="draft.rotation = option"
          >
            {{ t('cameras.degrees', { degrees: option }) }}
          </AppButton>
        </div>
      </div>

      <div class="check-set mt-4">
        <label class="check-row">
          <input v-model="draft.flipHorizontal" type="checkbox" :disabled="camera?.isReadOnly" />
          <span>{{ t('cameras.flipHorizontal') }}</span>
        </label>
        <label class="check-row">
          <input v-model="draft.flipVertical" type="checkbox" :disabled="camera?.isReadOnly" />
          <span>{{ t('cameras.flipVertical') }}</span>
        </label>
        <label class="check-row">
          <input v-model="draft.enabled" type="checkbox" :disabled="camera?.isReadOnly" />
          <span>{{ t('cameras.enabled') }}</span>
        </label>
        <label v-if="traits.supportsAudio" class="check-row">
          <input v-model="draft.enableAudio" type="checkbox" :disabled="camera?.isReadOnly" />
          <span>{{ t('cameras.enableAudio') }}</span>
        </label>
        <label v-if="traits.reportsFrames" class="check-row">
          <input v-model="draft.hideFrameRate" type="checkbox" :disabled="camera?.isReadOnly" />
          <span>{{ t('cameras.hideFrameRate') }}</span>
        </label>
      </div>

      <div v-if="traits.canCaptureStill" class="mt-4 border-t border-subtle pt-4">
        <p class="text-group-title">{{ t('cameras.crosshairTitle') }}</p>
        <p class="module-settings__hint">{{ t('cameras.crosshairHint') }}</p>
        <label class="check-row mt-2">
          <input v-model="draft.crosshair" type="checkbox" :disabled="camera?.isReadOnly" />
          <span>{{ t('cameras.crosshairEnable') }}</span>
        </label>
        <div v-if="draft.crosshair" class="mt-3 flex flex-wrap items-center gap-4">
          <!--
            Seven swatches rather than a hex picker. `dashboard/colorTokens.ts`
            holds the reason: new chromatic colour in this product is restricted
            to the Okabe-Ito palette so every theme pack stays coherent and
            every hue keeps its measured contrast. A free picker is what the
            reference interfaces offer here, and it is exactly the thing that
            rule rules out.
          -->
          <div class="flex items-center gap-2">
            <span class="text-field-label text-muted">{{ t('cameras.crosshairColor') }}</span>
            <span class="palette-swatches">
              <button
                v-for="token in dashboardColorTokens"
                :key="token.key"
                type="button"
                class="palette-swatch"
                :style="{ '--swatch': token.variable }"
                :aria-pressed="draft.crosshairColor === token.key"
                :disabled="isReadOnly"
                :title="t(`cameras.colors.${token.key}`)"
                :aria-label="t(`cameras.colors.${token.key}`)"
                @click="draft.crosshairColor = token.key"
              >
                <AppIcon
                  v-if="draft.crosshairColor === token.key"
                  name="check"
                  class="size-4"
                  aria-hidden="true"
                />
              </button>
            </span>
          </div>
          <AppSlider
            v-model="draft.crosshairSize"
            :label="t('cameras.crosshairSize')"
            :min="0.01"
            :max="1"
            :step="0.01"
            :disabled="isReadOnly"
            live
          />
        </div>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-2">
        <AppButton
          v-if="!camera?.isReadOnly"
          variant="primary"
          :label="camera ? t('cameras.update') : t('cameras.create')"
          type="submit"
          :disabled="!canSave || webcams.pendingCommands.save"
        />
        <AppButton size="sm" :label="t('cameras.cancel')" @click="emit('close')" />
        <AppButton
          v-if="camera"
          size="sm"
          :label="t('cameras.test')"
          :disabled="webcams.pendingCommands.test"
          @click="runTest"
        />
        <p v-if="testResult" class="camera-editor__test" role="status">
          <AppIcon
            :name="testResult === 'reachable' ? 'check' : 'warning'"
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          {{
            testResult === 'reachable' ? t('cameras.testReachable') : t('cameras.testUnreachable')
          }}
        </p>
      </div>
    </div>

    <div class="camera-editor__preview">
      <p class="text-field-label text-muted">{{ t('cameras.previewTitle') }}</p>
      <CameraTile
        :key="previewCamera.service"
        class="mt-2"
        :camera="previewCamera"
        :show-label="false"
        fit="contain"
        compact
      />
    </div>
  </form>
</template>
