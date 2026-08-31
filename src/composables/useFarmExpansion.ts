import { computed, ref } from 'vue'

/**
 * Which farm columns are expanded, remembered per printer.
 *
 * Module-level state rather than a store, for the same reason the sidebar's
 * collapse is: this is a display preference with no domain behind it, and
 * nothing outside the farm page reads it. It is deliberately **not** part of
 * the farm store either — the size a column is drawn at must never be able to
 * influence what is connected, and keeping the two in separate modules is what
 * makes that true by construction rather than by discipline.
 *
 * Keyed by printer id, so an entry whose address changes keeps its size, and
 * remembered across reloads because the machine somebody is babysitting today
 * is usually the one they were babysitting yesterday.
 */

const storageKey = 'alabaster.farm.expanded'

function readStorage(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return new Set()
  }
}

const expanded = ref<Set<string>>(readStorage())

function persist(): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...expanded.value]))
  } catch {
    // A full or unavailable store costs the sizes after the next reload and
    // nothing else. Never worth interrupting anyone for.
  }
}

export function useFarmExpansion() {
  const isExpanded = (id: string): boolean => expanded.value.has(id)

  function toggle(id: string): void {
    const next = new Set(expanded.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expanded.value = next
    persist()
  }

  function collapseAll(): void {
    expanded.value = new Set()
    persist()
  }

  return {
    isExpanded,
    toggle,
    collapseAll,
    expandedCount: computed(() => expanded.value.size),
  }
}
