<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { useAvailability } from '@/composables/useAvailability'
import { profileNameIssue } from '@/features/bedMesh/profileNames'
import { useBedMeshStore } from '@/stores/bedMesh'
import { usePrinterStore } from '@/stores/printer'

const { locale, t } = useI18n({ useScope: 'global' })
const bedMesh = useBedMeshStore()
const printer = usePrinterStore()
const { availability: klipperAvailability } = useAvailability('klipper')

/*
 * `danger-quiet` drops its softening rather than gaining a fill, which is this
 * variant's one available step: a border adds noise in a dense row, and the row
 * is where the control lives.
 */
const deleteProfileGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'deleteMeshProfile',
})

const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
)
const canCommand = computed(() => klipperAvailability.value.isAvailable && !printer.hasActivePrint)

const renamingProfile = ref<string | null>(null)
const deletingProfile = ref<string | null>(null)
const savingMesh = ref(false)

function formatHeight(value: number): string {
  return t('calibration.mesh.millimetres', { value: numberFormatter.value.format(value) })
}

async function confirmRename(name: string): Promise<void> {
  const from = renamingProfile.value
  renamingProfile.value = null
  if (from) await printer.renameBedMeshProfile(from, name)
}

async function confirmDelete(): Promise<void> {
  const profile = deletingProfile.value
  deletingProfile.value = null
  if (profile) await printer.removeBedMeshProfile(profile)
}

function requestDelete(name: string): void {
  if (deleteProfileGuard.guarded.value) deletingProfile.value = name
  else void printer.removeBedMeshProfile(name)
}

async function confirmSave(name: string): Promise<void> {
  savingMesh.value = false
  await printer.saveBedMeshProfile(name)
}

function validateMeshName(value: string, except?: string): string | undefined {
  switch (profileNameIssue(value, bedMesh.profiles, except)) {
    case 'empty':
      return t('calibration.mesh.nameEmpty')
    case 'nonAscii':
      return t('calibration.mesh.nameAscii')
    case 'taken':
      return t('calibration.mesh.nameTaken')
    default:
      return undefined
  }
}
</script>

<template>
  <section class="page-card calibration-panel" :aria-label="t('calibration.mesh.title')">
    <header class="calibration-panel__header">
      <div>
        <h2 class="calibration-panel__title">{{ t('calibration.mesh.title') }}</h2>
        <p class="calibration-panel__hint">{{ t('calibration.mesh.hint') }}</p>
      </div>
      <div class="calibration-panel__actions">
        <AppButton
          size="xs"
          :pending="printer.pendingCommands.bedMesh"
          icon="mesh"
          :label="t('calibration.mesh.calibrate')"
          :disabled="!canCommand"
          @click="printer.calibrateBedMesh()"
        />
        <AppButton
          size="xs"
          icon="save"
          :label="t('calibration.mesh.save')"
          :disabled="!canCommand || !bedMesh.isActive"
          @click="savingMesh = true"
        />
      </div>
    </header>

    <p v-if="!bedMesh.isActive" class="calibration-panel__hint">
      {{ t('calibration.mesh.noneLoaded') }}
    </p>

    <ul v-if="bedMesh.profileSummaries.length > 0" class="calibration-profiles">
      <li
        v-for="profile in bedMesh.profileSummaries"
        :key="profile.name"
        class="calibration-profile"
        :class="{ 'calibration-profile--active': profile.isActive }"
        :aria-current="profile.isActive ? 'true' : undefined"
      >
        <span class="calibration-profile__identity">
          <span class="calibration-profile__name">{{ profile.name }}</span>
        </span>
        <!--
          Each profile's own spread, read from the points Klipper reports with
          it. The alternative is loading each one in turn to look at it, which
          changes the machine to answer a question about a file.
        -->
        <span class="calibration-profile__range text-value">
          {{ t('calibration.mesh.spread', { value: formatHeight(profile.range) }) }}
        </span>
        <span class="calibration-profile__actions">
          <AppButton
            variant="quiet"
            size="xs"
            :label="t('calibration.mesh.load')"
            :disabled="!canCommand || profile.isActive"
            @click="printer.loadBedMeshProfile(profile.name)"
          />
          <AppButton
            variant="quiet"
            size="xs"
            :label="t('calibration.mesh.rename')"
            :disabled="!canCommand || !profile.isActive"
            :title="t('calibration.mesh.renameHint')"
            @click="renamingProfile = profile.name"
          />
          <AppButton
            size="xs"
            :guard="deleteProfileGuard"
            :label="t('calibration.mesh.delete')"
            :disabled="!canCommand"
            @click="requestDelete(profile.name)"
          />
        </span>
      </li>
    </ul>
    <p v-else class="calibration-panel__hint">{{ t('calibration.mesh.noProfiles') }}</p>

    <PromptDialog
      :open="renamingProfile !== null"
      :title="t('calibration.mesh.renameTitle')"
      :label="t('calibration.mesh.renameLabel')"
      :initial-value="renamingProfile ?? ''"
      :confirm-label="t('calibration.mesh.rename')"
      @confirm="confirmRename"
      @cancel="renamingProfile = null"
    />
    <PromptDialog
      :open="savingMesh"
      :title="t('calibration.mesh.saveTitle')"
      :label="t('calibration.mesh.saveLabel')"
      :initial-value="bedMesh.suggestedProfileName"
      :confirm-label="t('calibration.mesh.save')"
      :validate="(value: string) => validateMeshName(value, bedMesh.profileName)"
      @confirm="confirmSave"
      @cancel="savingMesh = false"
    />
    <ConfirmDialog
      :open="deletingProfile !== null"
      :title="t('calibration.mesh.deleteTitle')"
      :description="t('calibration.mesh.deleteConfirm', { name: deletingProfile ?? '' })"
      :confirm-label="t('calibration.mesh.delete')"
      tone="danger"
      @confirm="confirmDelete"
      @cancel="deletingProfile = null"
    />
  </section>
</template>
