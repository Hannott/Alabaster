import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { detectDocsSite, isDocsSite, type DocsSite } from '@/features/machine/docsLinks'
import type { MoonrakerUpdateEntry } from '@/services/moonraker/types'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'
import { readScoped, writeScoped } from '@/stores/printerScope'
import { usePrintersStore } from '@/stores/printers'
import { isRecord } from '@/utils/records'

const storageKey = 'alabaster.editor.documentationSite'

function storedTable(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function normalizeDocumentationSite(value: unknown): DocsSite | null {
  return isDocsSite(value) ? value : null
}

/**
 * Which project's documentation the configuration editor links to: Klipper's
 * or Kalico's.
 *
 * Detected from the repository Moonraker's update manager tracks for Klipper,
 * the same entry the Machine page's software list shows. A printer whose
 * Klipper the update manager does not manage reports nothing, and falls back
 * to Klipper's documentation, which most configs are written against; the
 * stored choice is for that case and for anything the detection gets wrong.
 *
 * Per printer, like Z motion and Quick config's pins, and in the settings
 * bundle so a second device opening the same printer links to the same site:
 * it is a fact about the machine, not a reading preference.
 *
 * The update manager's status is re-read on every connection and whenever it
 * announces a refresh, so a printer moved from one firmware to the other is
 * followed without a reload.
 */
export const useDocumentationSiteStore = defineStore('documentationSite', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const printers = usePrintersStore()

  const stored = ref<DocsSite | null>(
    normalizeDocumentationSite(readScoped(storedTable(), printers.activeScopeKeys)),
  )
  const detected = ref<DocsSite | null>(null)
  const disposers: Array<() => void> = []
  let generation = 0
  /* Counted: the editor and Settings each start it while they are mounted. */
  let starts = 0

  watch(
    () => printers.activeScopeKeys.join(','),
    () => {
      stored.value = normalizeDocumentationSite(readScoped(storedTable(), printers.activeScopeKeys))
    },
  )

  const site = computed<DocsSite>(() => stored.value ?? detected.value ?? 'klipper')

  function persist(): void {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(writeScoped(storedTable(), printers.activeScopeKeys, stored.value)),
    )
  }

  /** Null returns the printer to automatic detection. */
  function setSite(next: DocsSite | null): void {
    stored.value = next
    persist()
  }

  function replace(value: unknown): void {
    stored.value = normalizeDocumentationSite(value)
    persist()
  }

  function applyStatus(status: unknown): void {
    if (!isRecord(status) || !isRecord(status.version_info)) return
    const klipper = status.version_info.klipper
    detected.value = isRecord(klipper) ? detectDocsSite(klipper as MoonrakerUpdateEntry) : null
  }

  async function refresh(): Promise<void> {
    const current = ++generation
    try {
      const status = await moonraker.rpcCall('machine.update.status', {})
      if (current === generation) applyStatus(status)
    } catch {
      // No update manager, or a Moonraker too old to have one: the fallback stands.
      if (current === generation) detected.value = null
    }
  }

  function start(): void {
    starts += 1
    if (starts > 1) return
    disposers.push(
      moonraker.onPrinterChange(() => {
        generation += 1
        detected.value = null
      }),
      watch(
        () => availability.isMoonrakerConnected,
        (connected) => {
          if (connected) void refresh()
        },
        { immediate: true },
      ),
    )
    try {
      disposers.push(
        moonraker.onNotification('notify_update_refreshed', (notification) =>
          applyStatus(notification.params[0]),
        ),
      )
    } catch {
      // Without the notification the site is still read on every connection.
    }
  }

  function stop(): void {
    if (starts === 0) return
    starts -= 1
    if (starts > 0) return
    generation += 1
    while (disposers.length > 0) disposers.pop()?.()
  }

  return { stored, detected, site, setSite, replace, start, stop }
})
