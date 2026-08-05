import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * What this Moonraker instance can serve: the components it loaded and the file
 * roots it registered. Both come from `server.info`, which the client emits on
 * every handshake and on every lifecycle poll, so these stay current without a
 * subscription of their own — a Moonraker restart is a reconnect, and a
 * reconnect re-reads them.
 *
 * Consumed by the navigation to decide which destinations this machine can
 * serve at all; see `docs/design/navigation-plan.md`.
 */
export interface ServerInfoCapabilities {
  components?: unknown
  registered_directories?: unknown
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((entry): entry is string => typeof entry === 'string')
}

export const useServerCapabilitiesStore = defineStore('serverCapabilities', () => {
  /** `null` until Moonraker has reported one, which is not the same as empty. */
  const components = ref<string[] | null>(null)
  const registeredRoots = ref<string[] | null>(null)

  const hasReported = computed(() => components.value !== null || registeredRoots.value !== null)

  function applyServerInfo(serverInfo: ServerInfoCapabilities): void {
    const reportedComponents = readStringList(serverInfo.components)
    const reportedRoots = readStringList(serverInfo.registered_directories)

    // Only overwrite what this report actually carried. An older Moonraker, or
    // a trimmed response, must not erase what a previous one told us.
    if (reportedComponents !== null) components.value = reportedComponents
    if (reportedRoots !== null) registeredRoots.value = reportedRoots
  }

  /**
   * A different printer loads different components and registers different
   * roots, so the previous machine's answers must not gate this one's
   * navigation. Back to `null` rather than to empty, because "not yet reported"
   * is what makes `hasComponent` and `hasRoot` answer optimistically until
   * Moonraker has actually said otherwise — clearing to `[]` would instead hide
   * every gated destination until the new handshake lands.
   */
  function reset(): void {
    components.value = null
    registeredRoots.value = null
  }

  /**
   * Unknown counts as present, for both of these.
   *
   * Gating exists to keep the interface from offering what the machine cannot
   * serve. Answering "no" because we could not read the list would instead hide
   * a destination that works, which is the worse of the two failures: an
   * unnecessary entry is a wasted tap, a missing one is a feature the user
   * cannot find and cannot know to look for. Nothing is hidden until Moonraker
   * has actually said so.
   */
  function hasComponent(component: string): boolean {
    return components.value === null || components.value.includes(component)
  }

  function hasRoot(root: string): boolean {
    return registeredRoots.value === null || registeredRoots.value.includes(root)
  }

  return {
    components,
    registeredRoots,
    hasReported,
    applyServerInfo,
    reset,
    hasComponent,
    hasRoot,
  }
})
