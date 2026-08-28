<script setup lang="ts">
/**
 * The Camera card: one or several live streams, arranged as a grid or behind a
 * tab strip.
 *
 * **Both arrangements exist because the choice is not cosmetic.** A grid runs
 * every stream at once, which is what you want while watching a first layer
 * from two angles; tabs run one, which is what you want when the printer's Pi
 * is also slicing, or on a phone over mobile data. Neither is right for
 * everyone, and guessing from the viewport would get it wrong for the person
 * with three cameras on a desktop.
 *
 * **And both arrangements exist alongside several cards.** A card holds a set
 * of cameras that belong together — "the printer" and "the filament path" —
 * while a second card is for cameras watched independently, collapsed or
 * placed in a different column. The module is `supportsMultiple`, so the two
 * ways of splitting cameras compose instead of competing.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import CameraTile from '@/components/camera/CameraTile.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import CameraQuickSettings from '@/components/dashboard/modules/CameraQuickSettings.vue'
import {
  cameraCardSettings,
  camerasOnOtherCards,
  firstUnclaimedCamera,
  selectedCameras,
} from '@/components/dashboard/modules/cameraCardSettings'
import { useDashboardModule } from '@/dashboard/context'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useWebcamsStore } from '@/stores/webcams'

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig, instanceId, isSettingsOpen } = useDashboardModule('camera')
const webcams = useWebcamsStore()
const layout = useDashboardLayoutStore()

const settings = computed(() => cameraCardSettings(config.value))
const cameras = computed(() => selectedCameras(settings.value, webcams.cameras))

/**
 * A card nobody has configured adopts the first camera no other card is showing,
 * the moment the camera list arrives.
 *
 * Written into the card's own configuration rather than resolved on the fly,
 * because "which camera is this card's" has to be a fact the pane can list and
 * the next card can avoid. Resolving it live gave a second Camera card the same
 * stream as the first and left the pane with nothing to show as chosen.
 *
 * It runs only for a card that has never been configured — `null`, not `[]` —
 * so a card whose cameras were removed on purpose stays empty.
 */
watch(
  [() => settings.value.cameraUids, () => webcams.cameras, () => layout.profile.instances],
  ([stored, available, instances]) => {
    if (stored !== null || available.length === 0) return
    const claimed = camerasOnOtherCards(instances, instanceId)
    const camera = firstUnclaimedCamera(available, claimed)
    if (camera) updateConfig({ cameras: [camera.uid] })
  },
  { immediate: true },
)

/**
 * Which tab is showing, as a UID rather than an index: a camera added, removed
 * or reordered elsewhere would otherwise silently move the selection to a
 * different camera.
 */
const selectedUid = ref<string | null>(null)

watch(
  cameras,
  (list) => {
    if (list.length === 0) {
      selectedUid.value = null
      return
    }
    if (!list.some((camera) => camera.uid === selectedUid.value)) {
      selectedUid.value = list[0]?.uid ?? null
    }
  },
  { immediate: true },
)

const isTabbed = computed(() => settings.value.arrangement === 'tabs' && cameras.value.length > 1)

/**
 * A single camera gets the card's full width and its own shape, so the whole
 * picture shows and nothing is cropped. Several tiled cameras get one
 * widescreen shape each and are cropped into it, because a portrait phone
 * beside a landscape webcam otherwise makes one cell three times the height of
 * the other.
 *
 * Decided here rather than offered as a setting. It was a setting — "Fill" and
 * "Whole frame" — and for the common case of one camera that already matches the
 * tile it changed nothing at all, which is worse than no control.
 */
const fit = computed(() => (cameras.value.length > 1 && !isTabbed.value ? 'cover' : 'contain'))

/**
 * Why the card has nothing to show, since the three answers need three different
 * things said and only one of them is worth acting on here.
 *
 * `disabled` is the case a card in working order still lands in: its camera is
 * chosen and present, and somebody switched it off. Saying "no camera on this
 * card" there would send the reader to the card's own settings to fix something
 * that is not wrong with the card.
 */
type EmptyReason = 'failed' | 'disabled' | 'unselected' | 'none'

const emptyReason = computed<EmptyReason>(() => {
  if (webcams.failed) return 'failed'
  if (webcams.cameras.length === 0) return 'none'
  const chosen = settings.value.cameraUids ?? []
  const present = chosen.filter((uid) => webcams.cameras.some((camera) => camera.uid === uid))
  if (present.length > 0) return 'disabled'
  return 'unselected'
})

const emptyIcon = computed(() => {
  if (emptyReason.value === 'failed') return 'cameraNoSignal' as const
  if (emptyReason.value === 'disabled') return 'cameraDisabled' as const
  return 'cameraOff' as const
})
</script>

<template>
  <!--
    inset: the streams run to the card's edges, so there is no shell padding to
    hold them in — the stage below is this module's own full-bleed box, the same
    arrangement Print and Console use for their own edge-to-edge content.
  -->
  <AppDashboardModule inset :open="isSettingsOpen">
    <template #quick-settings>
      <CameraQuickSettings />
    </template>

    <div v-if="cameras.length > 0" class="camera-stage">
      <div v-if="isTabbed" class="camera-tabs">
        <AppButton
          v-for="camera in cameras"
          :key="camera.uid"
          on-strong
          size="sm"
          :label="camera.name"
          :aria-current="camera.uid === selectedUid"
          @click="selectedUid = camera.uid"
        />
      </div>

      <!--
        Every tile stays mounted in the tab arrangement and only the selected
        one is `selected`. Unmounting the others would tear down and re-signal a
        WebRTC connection on every tab press — several seconds of black before a
        picture — where leaving them mounted and inactive costs nothing: an
        inactive streamer holds no connection open.
      -->
      <div v-if="isTabbed" class="camera-tab-panels">
        <CameraTile
          v-for="camera in cameras"
          :key="camera.uid"
          :camera="camera"
          :selected="camera.uid === selectedUid"
          :class="{ 'camera-tile--hidden': camera.uid !== selectedUid }"
          :show-label="settings.showLabels"
          :show-frame-rate="settings.showFrameRate"
          :fit="fit"
        />
      </div>

      <div
        v-else
        class="camera-grid"
        :class="`camera-grid--${settings.stacking}`"
        :style="{ '--camera-columns': Math.min(settings.columns, cameras.length) }"
      >
        <CameraTile
          v-for="camera in cameras"
          :key="camera.uid"
          :camera="camera"
          :show-label="settings.showLabels"
          :show-frame-rate="settings.showFrameRate"
          :fit="fit"
        />
      </div>
    </div>

    <div v-else class="camera-stage">
      <div class="camera-stage__empty">
        <AppIcon :name="emptyIcon" class="size-8" aria-hidden="true" />
        <p class="mt-3 text-section-title">
          {{ t(`dashboard.camera.empty.${emptyReason}`) }}
        </p>
        <p class="mt-1 max-w-xs text-center text-xs leading-5 text-muted">
          {{ t(`dashboard.camera.emptyHint.${emptyReason}`) }}
        </p>
        <AppButton
          v-if="webcams.failed"
          on-strong
          :label="t('dashboard.camera.retry')"
          class="mt-4"
          :disabled="webcams.isLoading"
          @click="webcams.refresh()"
        />
      </div>
    </div>
  </AppDashboardModule>
</template>
