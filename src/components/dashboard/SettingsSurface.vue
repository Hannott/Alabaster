<script setup lang="ts">
import { onBeforeUnmount, ref, useId, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import DashboardModuleHost from '@/components/dashboard/DashboardModuleHost.vue'
import type { DashboardModuleId } from '@/dashboard/layout'
import type { AvailabilityRequirement } from '@/stores/availability'

/**
 * A module's full configuration with its live card docked beside it. Built on
 * the shared `<dialog>` shell from `dialog-system.md`, but a surface rather
 * than a popup — see `docs/design/settings-surface.md` for why it is specified
 * separately and for the docking and motion rules.
 */
const props = defineProps<{
  /** Null while nothing is docked; the surface is closed. */
  instanceId: string | null
  moduleId: DashboardModuleId | null
  title: string
  icon: AppIconName | null
  requires: AvailabilityRequirement
  /**
   * A module's *fixed* quick settings, repeated here because docking withdraws
   * the gear that would otherwise reach them — null for a module that has none
   * of its own (see `hasSettings`), and also null for a module that lets the
   * user promote individual settings into its quick layer instead (an
   * instance whose registry entry sets `quickSettingsDefaultKeys`): every
   * setting there already renders in its own section below, exactly once,
   * with a `QuickSettingToggle` marking whether it is quick — repeating it up
   * here would show the same control twice on one screen. See
   * `docs/design/settings-surface.md`.
   */
  quickSettingsComponent: Component | null
  settingsComponent: Component | null
  /** The docked card's measured width, so the flight animates position only. */
  dockWidth: number | null
  /**
   * Decided by the view, not here: the flight has to know it too, and the one
   * condition should not be expressed in two places.
   */
  stacked: boolean
}>()

const emit = defineEmits<{ close: []; switchSurface: [instanceId: string] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)
/** Teleport target for the live card. Exposed so the view can move it here. */
const dock = ref<HTMLElement | null>(null)
/**
 * Exposed so the view can fade this in lockstep with the card it belongs to —
 * see the `companion` parameter on `moveCard` for why that has to be one
 * function driving both rather than this pane animating on its own.
 */
const pane = ref<HTMLElement | null>(null)
const titleId = useId()

defineExpose({ dock, pane })

/*
 * Modal, so the dashboard behind is locked and no second card's settings can
 * be opened while this one is up. The choreography that returns the card to
 * its column depends on there only ever being one docked card.
 */
watch(
  () => props.instanceId,
  (instanceId) => {
    const element = dialog.value
    if (!element) return
    if (instanceId !== null && !element.open) element.showModal()
    if (instanceId === null && element.open) element.close()
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="settings-surface"
    :class="{ 'settings-surface--stacked': stacked }"
    :aria-labelledby="titleId"
    :style="dockWidth && !stacked ? { '--dock-width': `${dockWidth}px` } : undefined"
    @cancel.prevent="emit('close')"
  >
    <div class="settings-surface__body">
      <section ref="pane" class="settings-surface__pane">
        <header class="settings-surface__header">
          <AppIcon
            v-if="icon"
            :name="icon"
            class="size-5 shrink-0 text-data-sky"
            aria-hidden="true"
          />
          <h2 :id="titleId" class="min-w-0 truncate text-card-title">
            {{ t('dashboard.surface.title', { module: title }) }}
          </h2>
          <AppButton
            variant="quiet"
            size="xs"
            icon-only
            icon="close"
            class="ms-auto"
            :aria-label="t('dashboard.surface.close')"
            :title="t('dashboard.surface.close')"
            @click="emit('close')"
          />
        </header>
        <div class="settings-surface__content">
          <DashboardModuleHost
            v-if="instanceId && moduleId"
            :key="instanceId"
            :instance-id="instanceId"
            :module-id="moduleId"
            :settings-open="true"
            :surface-open="true"
            @close-surface="emit('close')"
            @switch-surface="emit('switchSurface', $event)"
          >
            <!--
              The card's own rows come first and from the card's own component:
              docking hides the gear, and these would otherwise be unreachable
              for as long as the surface is open. Rendered here rather than by
              each pane so no module can forget them.
            -->
            <div v-if="quickSettingsComponent" class="surface-section">
              <p class="surface-section__title">{{ t('dashboard.surface.quickTitle') }}</p>
              <component :is="quickSettingsComponent" />
            </div>
            <component :is="settingsComponent" v-if="settingsComponent" />
          </DashboardModuleHost>
        </div>
      </section>

      <!--
        The dock carries its own availability region: moving the card out of
        its column moved it out of the one there, and a card docked when
        Klipper drops must not stay pressable.
      -->
      <AvailabilityRegion :requires="requires" disable-interaction class="settings-surface__dock">
        <!--
          Empty until the card lands in it, deliberately. A shell here — where
          the card fades *in* — is a second box that appears under it for the
          length of the fade and is taken away again, which blinks. The shell
          belongs at the end the card is leaving, in its dashboard slot, where
          it stays put for the whole round trip.
        -->
        <div ref="dock" class="settings-surface__dock-target"></div>
      </AvailabilityRegion>
    </div>
  </dialog>
</template>
