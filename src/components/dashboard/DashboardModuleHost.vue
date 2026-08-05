<script setup lang="ts">
import { computed, provide, type Component } from 'vue'

import { dashboardModuleContextKey, dashboardSurfaceGroupSwitchKey } from '@/dashboard/context'
import type { DashboardModuleId } from '@/dashboard/layout'
import { useDashboardLayoutStore } from '@/stores/dashboardLayout'

const props = withDefaults(
  defineProps<{
    instanceId: string
    moduleId: DashboardModuleId
    /** Omitted by a host whose children come from its slot instead. */
    component?: Component
    settingsOpen: boolean
    /** True for the host mounted inside the settings surface. */
    surfaceOpen?: boolean
  }>(),
  { surfaceOpen: false },
)

const emit = defineEmits<{
  openSettings: [instanceId: string]
  closeSettings: [instanceId: string]
  openSurface: [instanceId: string]
  closeSurface: [instanceId: string]
  /** See `dashboardSurfaceGroupSwitchKey` — the target is a sibling instance, not this host's own. */
  switchSurface: [instanceId: string]
}>()

const layout = useDashboardLayoutStore()

// The host owns one instance for its whole lifetime, so the context it provides
// stays stable while the configuration it exposes remains reactive. Two hosts
// may exist for one instance — the card and its settings pane — reading and
// writing the same store slice.
provide(dashboardModuleContextKey, {
  instanceId: props.instanceId,
  moduleId: props.moduleId,
  config: computed(
    () =>
      layout.profile.instances.find((instance) => instance.instanceId === props.instanceId)
        ?.config ?? {},
  ),
  updateConfig: (patch) => layout.updateConfig(props.instanceId, patch),
  isSettingsOpen: computed(() => props.settingsOpen),
  openSettings: () => emit('openSettings', props.instanceId),
  closeSettings: () => emit('closeSettings', props.instanceId),
  isSurfaceOpen: computed(() => props.surfaceOpen),
  openSurface: () => emit('openSurface', props.instanceId),
  closeSurface: () => emit('closeSurface', props.instanceId),
})

provide(dashboardSurfaceGroupSwitchKey, {
  switchTo: (instanceId) => emit('switchSurface', instanceId),
})
</script>

<template>
  <component :is="component" v-if="component" />
  <!--
    The surface puts two components in one host — the card's quick settings and
    the module's pane — so they share the one context this host provides rather
    than each nesting a host of its own.
  -->
  <slot></slot>
</template>
