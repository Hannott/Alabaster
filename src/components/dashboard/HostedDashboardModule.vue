<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import type { DashboardModuleId } from '@/dashboard/layout'
import { dashboardModulesById } from '@/dashboard/registry'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'

/**
 * One dashboard module, hosted on a routed page instead of on the dashboard.
 *
 * The Calibration page used to do this by hand for the bed-mesh viewer — a
 * page-level `provide` of `dashboardModuleContextKey`, a `ref` for the
 * disclosure, and its own gear button in its own header. That works for exactly
 * one module per page, because `provide` is per component instance: the second
 * hosted module would have silently read the first one's context and written
 * the first one's configuration. This component is that same wiring, scoped to
 * one module, so a page can host as many as it has room for.
 *
 * What a host is *not* allowed to do is invent a second copy of the module's
 * settings. The context provided here is bound to the real instance the layout
 * store already keeps for every registered module (see `normalizeInstances` —
 * every module id always has one, whether or not a card for it is on anybody's
 * dashboard), so a setting changed here holds on the dashboard and the other
 * way round. That is the whole point of hosting the module rather than
 * reimplementing its controls: one implementation, one saved configuration,
 * two places to reach it.
 *
 * `canOpenSurface: false`, always: the settings surface docks a card out of a
 * grid of cards, and a hosted module is not in one. `ModuleSettingsLink` reads
 * that and hides itself rather than offering a link into a surface nothing
 * would render — see `canOpenSurface`'s own comment in `dashboard/context.ts`.
 */
const props = defineProps<{
  moduleId: DashboardModuleId
  /**
   * The card's visible heading. Defaults to the module's registered title,
   * which is right wherever the page means the same thing the dashboard does.
   * A page that means something narrower says so — Calibration calls the
   * bed-mesh viewer "Height map", because on that page the profile list is a
   * separate card and "Bed mesh" would name both of them.
   */
  title?: string
  hint?: string
}>()

const { t } = useI18n({ useScope: 'global' })
const layout = useDashboardLayoutStore()
const settingsOpen = ref(false)

/**
 * The module id doubles as the instance id for every module this can host.
 * `nextInstanceId` only ever suffixes an id that is already taken, and only
 * `camera` and `macros` are `supportsMultiple`, so a single-instance module's
 * instance is always exactly its own id. A `supportsMultiple` module has no
 * single instance a page could mean, which is why hosting one is refused in
 * development rather than quietly binding to whichever card came first.
 */
const definition = computed(() => dashboardModulesById.get(props.moduleId))

if (import.meta.env.DEV && dashboardModulesById.get(props.moduleId)?.supportsMultiple) {
  console.warn(
    `HostedDashboardModule: "${props.moduleId}" supports multiple instances, so there is no single instance a page can host.`,
  )
}

const heading = computed(() => props.title ?? t(definition.value?.titleKey ?? ''))
const hasSettings = computed(() => definition.value?.hasSettings === true)

provide(dashboardModuleContextKey, {
  instanceId: props.moduleId,
  moduleId: props.moduleId,
  config: computed(
    () =>
      layout.profile.instances.find((instance) => instance.instanceId === props.moduleId)?.config ??
      {},
  ),
  updateConfig: (patch) => layout.updateConfig(props.moduleId, patch),
  isSettingsOpen: computed(() => settingsOpen.value),
  openSettings: () => {
    settingsOpen.value = true
  },
  closeSettings: () => {
    settingsOpen.value = false
  },
  isSurfaceOpen: computed(() => false),
  openSurface: () => {},
  closeSurface: () => {},
  canOpenSurface: false,
})
</script>

<template>
  <section class="page-card calibration-panel">
    <header class="calibration-panel__header">
      <div>
        <h2 class="calibration-panel__title">{{ heading }}</h2>
        <p v-if="hint" class="calibration-panel__hint">{{ hint }}</p>
      </div>
      <div class="calibration-panel__actions">
        <slot name="actions"></slot>
        <AppButton
          v-if="hasSettings"
          variant="quiet"
          size="xs"
          icon-only
          icon="settings"
          :aria-pressed="settingsOpen"
          :aria-label="t('dashboard.layout.settings', { module: heading })"
          :title="t('dashboard.layout.settingsTooltip', { module: heading })"
          @click="settingsOpen = !settingsOpen"
        />
      </div>
    </header>

    <!--
      The module's own body, unchanged. It renders its own `AppDashboardModule`
      shell inside this slot, which is why the padding here is the page card's
      and not a second one: the shell's `p-4` is what a dashboard card supplies,
      and a hosted module sits in a `page-card` that already has padding of its
      own. `calibration-panel--hosted` below cancels the inner one.
    -->
    <div class="calibration-panel__module">
      <slot></slot>
    </div>
  </section>
</template>
