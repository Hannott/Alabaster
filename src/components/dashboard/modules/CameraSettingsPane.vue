<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import CameraCardSettingsFields from '@/components/dashboard/modules/CameraCardSettingsFields.vue'
import { camerasOnOtherCards } from '@/components/dashboard/modules/cameraCardSettings'
import { useDashboardViewport } from '@/composables/useDashboardViewport'
import {
  configOptionalStringList,
  useDashboardModule,
  useDashboardSurfaceGroupSwitch,
} from '@/dashboard/context'
import type { Camera } from '@/features/camera/camera'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'
import { useWebcamsStore } from '@/stores/webcams'

/**
 * Which cameras this card shows and in what order, plus how it draws them.
 *
 * The picker is the reason this pane exists rather than everything living in the
 * card's own layer: choosing three cameras out of five is a filing job over two
 * lists, and the only way to judge it is with the card standing beside it —
 * three tiles either fit the column or they do not, and that is not a question
 * a checkbox list can answer on its own.
 *
 * Nothing here configures a camera. A camera's URL, service, rotation and
 * crosshair belong to the printer, not to a card — two cards showing the same
 * camera cannot disagree about which way up it is — so they live on the
 * Settings route, and this pane links there rather than duplicating them.
 */
const { t } = useI18n({ useScope: 'global' })
const webcams = useWebcamsStore()
const layout = useDashboardLayoutStore()
const { viewport } = useDashboardViewport()
const { config, updateConfig, instanceId } = useDashboardModule('camera')
const switchGroup = useDashboardSurfaceGroupSwitch()

/**
 * Every Camera instance, so a set of cameras can be split across cards — one
 * card per group of angles — without leaving this pane. Mirrors the Macros
 * pane's group switcher, which is the established shape for a
 * `supportsMultiple` module's own pane.
 */
const cards = computed(() =>
  layout.profile.instances
    .filter((instance) => instance.moduleId === 'camera')
    .map((instance) => ({
      instanceId: instance.instanceId,
      title: instance.title ?? t('dashboard.modules.camera'),
    })),
)

function selectCard(targetId: string): void {
  if (targetId === instanceId) return
  switchGroup?.(targetId)
}

/**
 * A new card starts empty rather than as a copy of this one: it exists to hold
 * *other* cameras, and an empty selection falls back to the printer's first
 * enabled camera so it is never a blank card.
 */
function createCard(): void {
  const newId = layout.duplicateInstance(viewport.value, instanceId, { emptyConfig: true })
  if (newId) switchGroup?.(newId)
}

/**
 * Seeded once per mount rather than bound to the stored title: typing commits
 * on `change`, the same draft pattern every other type-while-live field uses.
 * `SettingsSurface` remounts this component when the docked card changes, so
 * there is nothing to resync.
 */
const titleDraft = ref(cards.value.find((card) => card.instanceId === instanceId)?.title ?? '')

function commitTitle(): void {
  layout.renameInstance(instanceId, titleDraft.value)
}

/*
 * --- The picker ---
 *
 * The stored list is UIDs; the rows are the cameras they resolve to. A UID that
 * resolves to nothing is a camera deleted from the printer, and it is shown as
 * such rather than dropped silently: this is the one surface where a stale
 * selection is both visible and removable, so hiding it here would leave it
 * stored forever with nothing to reveal it.
 */
interface SelectedRow {
  uid: string
  camera: Camera | null
  label: string
}

const selection = computed(() => configOptionalStringList(config.value, 'cameras') ?? [])

/**
 * A camera on another Camera card is not offered here. Two cards streaming one
 * camera costs the printer twice for the same picture, and the two cards are
 * then indistinguishable — see `camerasOnOtherCards`.
 */
const claimedElsewhere = computed(() => camerasOnOtherCards(layout.profile.instances, instanceId))

const selectedRows = computed<SelectedRow[]>(() =>
  selection.value.map((uid) => {
    const camera = webcams.cameras.find((entry) => entry.uid === uid) ?? null
    return { uid, camera, label: camera?.name ?? t('dashboard.camera.missingCamera') }
  }),
)

const availableCameras = computed(() =>
  webcams.cameras.filter(
    (camera) => !selection.value.includes(camera.uid) && !claimedElsewhere.value.has(camera.uid),
  ),
)

function select(uid: string): void {
  updateConfig({ cameras: [...selection.value, uid] })
}

function deselect(uid: string): void {
  updateConfig({ cameras: selection.value.filter((entry) => entry !== uid) })
}

function move(uid: string, offset: number): void {
  const order = [...selection.value]
  const index = order.indexOf(uid)
  const target = index + offset
  if (index === -1 || target < 0 || target >= order.length) return
  const [moved] = order.splice(index, 1)
  if (moved === undefined) return
  order.splice(target, 0, moved)
  updateConfig({ cameras: order })
}
</script>

<template>
  <SurfaceSection :title="t('dashboard.camera.cardsTitle')">
    <div class="camera-cards">
      <AppButton
        v-for="card in cards"
        :key="card.instanceId"
        size="sm"
        :label="card.title"
        :aria-current="card.instanceId === instanceId"
        :title="
          card.instanceId === instanceId
            ? undefined
            : t('dashboard.camera.switchToCard', { card: card.title })
        "
        @click="selectCard(card.instanceId)"
      />
      <AppButton size="sm" icon="add" :label="t('dashboard.camera.addCard')" @click="createCard" />
    </div>

    <div class="settings-row mt-4">
      <label class="settings-row__label" for="camera-card-title">
        {{ t('dashboard.camera.titleLabel') }}
      </label>
      <input
        id="camera-card-title"
        v-model="titleDraft"
        type="text"
        class="field"
        :placeholder="t('dashboard.modules.camera')"
        autocomplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        @change="commitTitle"
      />
    </div>

    <CameraCardSettingsFields mode="pane" />
  </SurfaceSection>

  <SurfaceSection bare>
    <p class="surface-section__subtitle mt-4">{{ t('dashboard.camera.selectedTitle') }}</p>
    <ul v-if="selectedRows.length > 0" class="camera-picker__list mt-2 grid gap-1">
      <li
        v-for="(row, index) in selectedRows"
        :key="row.uid"
        class="camera-row"
        :class="{ 'camera-row--missing': row.camera === null }"
      >
        <span class="camera-row__name">{{ row.label }}</span>
        <span v-if="row.camera && !row.camera.enabled" class="camera-row__badge">
          {{ t('dashboard.camera.disabledShort') }}
        </span>
        <div class="camera-row__reorder">
          <AppButton
            variant="quiet"
            size="xs"
            icon-only
            icon="up"
            :disabled="index === 0"
            :title="t('dashboard.camera.moveEarlier', { camera: row.label })"
            :aria-label="t('dashboard.camera.moveEarlier', { camera: row.label })"
            @click="move(row.uid, -1)"
          />
          <AppButton
            variant="quiet"
            size="xs"
            icon-only
            icon="down"
            :disabled="index === selectedRows.length - 1"
            :title="t('dashboard.camera.moveLater', { camera: row.label })"
            :aria-label="t('dashboard.camera.moveLater', { camera: row.label })"
            @click="move(row.uid, 1)"
          />
        </div>
        <AppButton
          variant="danger-quiet"
          size="xs"
          icon-only
          icon="trash"
          :title="t('dashboard.camera.remove', { camera: row.label })"
          :aria-label="t('dashboard.camera.remove', { camera: row.label })"
          @click="deselect(row.uid)"
        />
      </li>
    </ul>
    <p v-else class="mt-2 text-xs text-muted">{{ t('dashboard.camera.noneOnCard') }}</p>

    <div class="camera-picker__rule"></div>

    <p class="surface-section__subtitle">{{ t('dashboard.camera.availableTitle') }}</p>
    <ul v-if="availableCameras.length > 0" class="camera-picker__list mt-2 grid gap-1">
      <li v-for="camera in availableCameras" :key="camera.uid" class="camera-row">
        <span class="camera-row__name">{{ camera.name }}</span>
        <span v-if="!camera.enabled" class="camera-row__badge">
          {{ t('dashboard.camera.disabledShort') }}
        </span>
        <AppButton
          variant="quiet"
          size="xs"
          icon-only
          icon="add"
          :title="t('dashboard.camera.add', { camera: camera.name })"
          :aria-label="t('dashboard.camera.add', { camera: camera.name })"
          @click="select(camera.uid)"
        />
      </li>
    </ul>
    <p v-if="webcams.cameras.length === 0" class="mt-2 text-xs text-muted">
      {{ t('dashboard.camera.noneReported') }}
    </p>

    <p class="module-settings__hint mt-4">{{ t('dashboard.camera.configureHint') }}</p>
  </SurfaceSection>
</template>
