<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import AppSlider from '@/components/AppSlider.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import BedMeshScaleSettingsFields from '@/components/dashboard/modules/BedMeshScaleSettingsFields.vue'
import BedMeshViewSettingsFields from '@/components/dashboard/modules/BedMeshViewSettingsFields.vue'
import { configBoolean, configNumber, useDashboardModule } from '@/dashboard/context'
import { profileNameIssue } from '@/features/bedMesh/profileNames'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useConfirmationsStore } from '@/stores/confirmations'
import { usePrinterStore } from '@/stores/printer'

/**
 * Bed mesh's full configuration, in four groups by what each one is about: what
 * the height map draws, what its colours are measured against, when the card
 * speaks up, and the saved profiles themselves.
 *
 * The first two live in fields components shared with the card's own quick
 * layer, so the two can never drift; each row there carries the pin that
 * decides whether it also appears on the card.
 *
 * The two warnings are one section because they are one kind of thing — a
 * threshold past which the card stops being quiet — and reading them together
 * is how someone decides whether their printer is being too loud. Splitting
 * them by what they measure put a section of one row under its own rule.
 *
 * Profiles belong here rather than on the card because managing them is a
 * filing job, not a glance — but the card is docked alongside, so loading one
 * shows its shape immediately, which is the whole reason the surface exists.
 */
const { locale, t } = useI18n({ useScope: 'global' })
const bedMesh = useBedMeshStore()
const printer = usePrinterStore()
const confirmations = useConfirmationsStore()
const { config, updateConfig } = useDashboardModule('bedMesh')

const renaming = ref<string | null>(null)
const removing = ref<string | null>(null)
const saving = ref(false)

const skipDeleteProfileWarning = computed(() =>
  configBoolean(config.value, 'skipDeleteProfileWarning', false),
)

function requestDelete(name: string): void {
  if (confirmations.skipAll || skipDeleteProfileWarning.value)
    void printer.removeBedMeshProfile(name)
  else removing.value = name
}

const deviationFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
)

/** The literal defaults a reset button restores. */
const rangeWarningDefault = 0.2
const temperatureWarningDefault = 5
/** The slider's own span for each field — the number box reaches past it. */
const rangeWarningSliderMax = 1
const temperatureWarningSliderMax = 10

const rangeWarning = computed(() => configNumber(config.value, 'rangeWarning', rangeWarningDefault))
const temperatureWarning = computed(() =>
  configNumber(config.value, 'temperatureWarning', temperatureWarningDefault),
)

const isBusy = computed(() => printer.pendingCommands.bedMesh)

function validateName(value: string, except?: string): string | undefined {
  switch (profileNameIssue(value, bedMesh.profiles, except)) {
    case 'empty':
      return t('dashboard.bedMesh.nameEmpty')
    case 'nonAscii':
      return t('dashboard.bedMesh.nameAscii')
    case 'taken':
      return t('dashboard.bedMesh.nameTaken')
    default:
      return undefined
  }
}
</script>

<template>
  <SurfaceSection :title="t('dashboard.bedMesh.viewTitle')">
    <BedMeshViewSettingsFields mode="pane" />
  </SurfaceSection>

  <SurfaceSection :title="t('dashboard.bedMesh.scaleTitle')" divided>
    <BedMeshScaleSettingsFields mode="pane" />
  </SurfaceSection>

  <SurfaceSection :title="t('dashboard.bedMesh.warningsTitle')" divided>
    <AppSlider
      :label="t('dashboard.bedMesh.rangeWarning')"
      :model-value="rangeWarning"
      :min="0"
      :max="5"
      :step="0.01"
      :track-max="rangeWarningSliderMax"
      entry
      can-reset
      :reset-value="rangeWarningDefault"
      commit-on-drag
      @commit="(value) => updateConfig({ rangeWarning: value })"
    />
    <p class="module-settings__hint">{{ t('dashboard.bedMesh.rangeWarningHint') }}</p>

    <AppSlider
      :label="t('dashboard.bedMesh.temperatureWarning')"
      :model-value="temperatureWarning"
      :min="0"
      :max="20"
      :step="0.5"
      :track-max="temperatureWarningSliderMax"
      entry
      can-reset
      :reset-value="temperatureWarningDefault"
      commit-on-drag
      @commit="(value) => updateConfig({ temperatureWarning: value })"
    />
    <p class="module-settings__hint">{{ t('dashboard.bedMesh.temperatureWarningHint') }}</p>
  </SurfaceSection>

  <SurfaceSection :title="t('dashboard.bedMesh.profilesTitle')" divided>
    <p v-if="bedMesh.profileSummaries.length === 0" class="text-xs text-muted">
      {{ t('dashboard.bedMesh.noProfiles') }}
    </p>

    <div v-for="profile in bedMesh.profileSummaries" :key="profile.name" class="mesh-profile-row">
      <button
        type="button"
        class="button button--quiet button--sm button--start button--block"
        :disabled="isBusy || profile.isActive || printer.hasActivePrint"
        :aria-current="profile.isActive ? 'true' : undefined"
        @click="printer.loadBedMeshProfile(profile.name)"
      >
        <span class="truncate">{{ profile.name }}</span>
        <span
          v-if="profile.isActive"
          class="text-[0.6rem] font-black uppercase tracking-[0.12em] text-data-sky"
        >
          {{ t('dashboard.bedMesh.activeProfile') }}
        </span>
      </button>
      <span
        class="text-value"
        :title="
          t('dashboard.bedMesh.profileSpread', {
            lowest: deviationFormatter.format(profile.lowest),
            highest: deviationFormatter.format(profile.highest),
          })
        "
      >
        {{ deviationFormatter.format(profile.range) }}
      </span>
      <button
        type="button"
        class="button button--quiet button--xs button--icon"
        :disabled="isBusy || !profile.isActive"
        :title="t('dashboard.bedMesh.renameProfile', { name: profile.name })"
        :aria-label="t('dashboard.bedMesh.renameProfile', { name: profile.name })"
        @click="renaming = profile.name"
      >
        <AppIcon name="rename" class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="button button--xs button--icon"
        :class="
          confirmations.skipAll || skipDeleteProfileWarning
            ? 'button--danger'
            : 'button--danger-quiet'
        "
        :disabled="isBusy"
        :title="t('dashboard.bedMesh.deleteProfile', { name: profile.name })"
        :aria-label="t('dashboard.bedMesh.deleteProfile', { name: profile.name })"
        @click="requestDelete(profile.name)"
      >
        <AppIcon name="trash" class="size-4" aria-hidden="true" />
      </button>
    </div>

    <div class="mt-2 flex flex-wrap gap-2">
      <button
        type="button"
        class="button button--sm"
        :disabled="isBusy || !bedMesh.isActive"
        @click="saving = true"
      >
        <AppIcon name="save" class="size-4" aria-hidden="true" />
        {{ t('dashboard.bedMesh.saveProfile') }}
      </button>
      <button
        type="button"
        class="button button--sm"
        :disabled="isBusy || printer.hasActivePrint"
        @click="printer.calibrateBedMesh()"
      >
        <AppIcon name="mesh" class="size-4" aria-hidden="true" />
        {{ t('dashboard.bedMesh.calibrate') }}
      </button>
    </div>
    <p class="mt-2 text-xs text-muted">{{ t('dashboard.bedMesh.saveProfileHint') }}</p>
  </SurfaceSection>

  <SurfaceSection :title="t('dashboard.bedMesh.confirmationsTitle')" divided>
    <div class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="skipDeleteProfileWarning"
          @change="updateConfig({ skipDeleteProfileWarning: !skipDeleteProfileWarning })"
        />
        <span>{{ t('dashboard.bedMesh.skipDeleteProfileWarning') }}</span>
      </label>
    </div>
  </SurfaceSection>

  <PromptDialog
    :open="saving"
    :title="t('dashboard.bedMesh.saveProfileTitle')"
    :description="t('dashboard.bedMesh.saveProfileHint')"
    :label="t('dashboard.bedMesh.name')"
    :initial-value="bedMesh.suggestedProfileName"
    :confirm-label="t('dashboard.bedMesh.saveProfile')"
    :validate="(value: string) => validateName(value, bedMesh.profileName)"
    @cancel="saving = false"
    @confirm="
      (value: string) => {
        saving = false
        void printer.saveBedMeshProfile(value)
      }
    "
  />

  <PromptDialog
    :open="renaming !== null"
    :title="t('dashboard.bedMesh.renameProfileTitle')"
    :label="t('dashboard.bedMesh.name')"
    :initial-value="renaming ?? ''"
    :confirm-label="t('dashboard.bedMesh.rename')"
    :validate="(value: string) => validateName(value, renaming ?? undefined)"
    @cancel="renaming = null"
    @confirm="
      (value: string) => {
        const from = renaming
        renaming = null
        if (from) void printer.renameBedMeshProfile(from, value)
      }
    "
  />

  <ConfirmDialog
    :open="removing !== null"
    :title="t('dashboard.bedMesh.deleteProfileTitle')"
    :description="t('dashboard.bedMesh.deleteProfileDescription')"
    :items="removing ? [removing] : []"
    :confirm-label="t('dashboard.bedMesh.delete')"
    tone="danger"
    @cancel="removing = null"
    @confirm="
      () => {
        const name = removing
        removing = null
        if (name) void printer.removeBedMeshProfile(name)
      }
    "
  />
</template>
