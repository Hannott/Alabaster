<script setup lang="ts">
/**
 * The Cameras card on the Settings route: every camera the printer knows about,
 * and the form for adding or changing one.
 *
 * **These live in Moonraker's own webcam database, not in Alabaster's
 * settings.** That is deliberate and it is the reason this card is not part of
 * the settings bundle ADR 0008 syncs: a camera is the printer's hardware, so
 * Mainsail and Fluidd on the same printer read and write the same entries, and
 * a camera added here appears in them without anyone copying anything. The cost
 * is that a camera's configuration does not travel to a second printer with the
 * rest of a user's settings — which is right, because a second printer has
 * different cameras at different addresses.
 *
 * What a *card* shows is a separate question, kept separate: this page
 * configures cameras, and each Camera card's own settings pane chooses which of
 * them it shows. Two dashboard cards can never disagree about which way up a
 * camera is, and neither can two clients.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import CameraEditor from '@/components/settings/CameraEditor.vue'
import type { Camera } from '@/features/camera/camera'
import { cameraServiceTraits } from '@/features/camera/services'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useWebcamsStore } from '@/stores/webcams'

const { t } = useI18n({ useScope: 'global' })
const webcams = useWebcamsStore()
const confirmations = useConfirmationsStore()

/**
 * Which camera the form is pointed at: a `Camera` when editing, `'new'` when
 * adding, `null` when the form is closed. One slot rather than a per-row
 * disclosure, because two forms open at once would mean two live previews
 * streaming beside each other for no reason.
 */
const editing = ref<Camera | 'new' | null>(null)

const editingCamera = computed(() => (editing.value === 'new' ? null : editing.value))
const takenNames = computed(() => webcams.cameras.map((camera) => camera.name))

/**
 * Removing a camera reaches every interface on the printer, not just this
 * dashboard, so it asks first — and like every other page-level confirmation it
 * can be switched off on the Confirmations card rather than being unskippable.
 */
const pendingRemoval = ref<Camera | null>(null)

function requestRemoval(camera: Camera): void {
  if (confirmations.shouldConfirm('removeCamera')) pendingRemoval.value = camera
  else void remove(camera)
}

async function confirmRemoval(): Promise<void> {
  const camera = pendingRemoval.value
  pendingRemoval.value = null
  if (camera) await remove(camera)
}

async function remove(camera: Camera): Promise<void> {
  if (editing.value !== 'new' && editing.value?.uid === camera.uid) editing.value = null
  await webcams.remove(camera.uid)
}

/** Whether a camera should stream is the printer's switch, so it saves straight
 * away rather than only through the form — the row is the natural place to
 * silence a camera without opening anything. */
async function toggleEnabled(camera: Camera): Promise<void> {
  await webcams.save({ uid: camera.uid, enabled: !camera.enabled })
}

function serviceLabel(camera: Camera): string {
  return t(cameraServiceTraits(camera.service).labelKey)
}
</script>

<template>
  <section class="page-card">
    <p class="text-eyebrow text-data-blue">{{ t('cameras.eyebrow') }}</p>
    <h2 class="mt-2 text-section-title">{{ t('cameras.title') }}</h2>
    <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">{{ t('cameras.description') }}</p>

    <p v-if="webcams.cameras.length === 0" class="mt-7 text-sm leading-6 text-muted">
      {{ webcams.failed ? t('cameras.loadFailed') : t('cameras.empty') }}
    </p>
    <ul v-else class="mt-7 divide-y divide-subtle">
      <li v-for="camera in webcams.cameras" :key="camera.uid" class="flex items-center gap-3 py-3">
        <span class="min-w-0 flex-1">
          <strong class="block truncate text-row-name">{{ camera.name }}</strong>
          <span class="block truncate text-xs text-muted">
            {{ serviceLabel(camera) }}
            <template v-if="camera.rawStreamUrl || camera.rawSnapshotUrl">
              — {{ camera.rawStreamUrl || camera.rawSnapshotUrl }}
            </template>
          </span>
        </span>
        <span v-if="camera.isReadOnly" class="text-xs text-muted">{{
          t('cameras.fromConfig')
        }}</span>
        <button
          v-else
          type="button"
          class="button button--sm"
          :aria-pressed="camera.enabled"
          :disabled="webcams.pendingCommands.save"
          @click="toggleEnabled(camera)"
        >
          {{ camera.enabled ? t('cameras.on') : t('cameras.off') }}
        </button>
        <button
          type="button"
          class="button button--quiet button--sm button--icon"
          :aria-label="t('cameras.edit', { name: camera.name })"
          @click="editing = camera"
        >
          <AppIcon name="edit" class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="button button--danger-quiet button--sm button--icon"
          :disabled="camera.isReadOnly"
          :aria-label="t('cameras.remove', { name: camera.name })"
          @click="requestRemoval(camera)"
        >
          <AppIcon name="trash" class="size-4" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <div class="mt-7 border-t border-subtle pt-7">
      <button
        v-if="editing === null"
        type="button"
        class="button button--primary"
        @click="editing = 'new'"
      >
        <AppIcon name="add" class="size-5" aria-hidden="true" />
        {{ t('cameras.add') }}
      </button>
      <template v-else>
        <p class="text-group-title">
          {{
            editingCamera
              ? t('cameras.editTitle', { name: editingCamera.name })
              : t('cameras.addTitle')
          }}
        </p>
        <CameraEditor
          :key="editingCamera?.uid ?? 'new'"
          class="mt-5"
          :camera="editingCamera"
          :taken-names="takenNames"
          @close="editing = null"
        />
      </template>
    </div>

    <ConfirmDialog
      :open="pendingRemoval !== null"
      :title="t('cameras.removeTitle')"
      :description="t('cameras.removeDescription')"
      :items="pendingRemoval ? [pendingRemoval.name] : undefined"
      :confirm-label="t('cameras.removeConfirm')"
      tone="danger"
      @confirm="confirmRemoval"
      @cancel="pendingRemoval = null"
    />
  </section>
</template>
