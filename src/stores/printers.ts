import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { defaultMoonrakerWebSocketUrl, normalizeMoonrakerWebSocketUrl } from '@/services/moonraker'
import { isRecord } from '@/utils/records'

/**
 * The printers this browser knows how to reach, and which one is in front.
 *
 * Two things live here that used to be one endpoint string in local storage.
 *
 * **Identity.** A printer's `id` is stable and has nothing to do with how it is
 * reached. Everything scoped per printer — dashboard layout, learned heat
 * curves, bed-mesh probe temperatures — keys on the id, because keying on the
 * endpoint made one machine into several: `voron.local:7125` and
 * `192.168.1.50:7125` are the same printer, and reaching it through a tunnel
 * invents a third. Editing an endpoint therefore keeps everything the user has
 * arranged, which is the whole point of separating the two.
 *
 * **The list.** It cannot live in Moonraker's database, because it is the
 * answer to "which databases can I reach" — so it stays browser-local even now
 * that per-printer settings sync (`stores/settingsSync.ts`) exists. Sync
 * itself is opt-in per entry (`dbSyncEnabled`), because writing to a printer's
 * database is a step beyond merely connecting to it, and a printer someone
 * else also uses should not have its settings silently overwritten by whoever
 * happens to open Alabaster next.
 *
 * Ids are derived rather than random, matching `nextInstanceId` for dashboard
 * modules: no clock and no random source, so a stored list and a test read the
 * same either way.
 */

const storageKey = 'alabaster.printers.v1'
/** Read once, to carry a single-printer install forward. */
const legacyEndpointKey = 'alabaster.moonraker.endpoint'
const legacyNameKey = 'alabaster.printer.name'

const idPrefix = 'printer'

export interface PrinterEntry {
  id: string
  /**
   * What the user called it. Empty means "use what the printer calls itself",
   * which is why this is not seeded from the hostname: a label that was chosen
   * and a label that was merely observed have to stay distinguishable, or
   * renaming the machine would stop renaming the entry.
   */
  label: string
  /**
   * What the printer calls itself — `printer.info`'s hostname, learned on
   * connection and remembered so an entry keeps its name while offline.
   *
   * This is the other half of `label`'s promise, which until now the product
   * only half kept: an unnamed entry fell back to its address, so a machine
   * that had told us it was `voron` was still displayed as `192.168.1.50:7125`.
   * It is a separate field rather than a seeded `label` for the reason stated
   * above — renaming the machine has to keep renaming what the entry shows, and
   * it cannot if the observed name has been copied into the chosen one.
   *
   * Never written by the user, and never sent anywhere: it is refreshed from
   * whichever connection reaches the printer, so it corrects itself the first
   * time the machine answers to a different name.
   */
  discoveredName?: string
  endpoint: string
  /**
   * This printer's Moonraker `access.login` refresh token, present only for a
   * printer whose Moonraker enforces login and where the user has actually
   * logged in. Exchanged for a fresh (1-hour) access token on every connection
   * via `access.refresh_jwt` — the password itself is never stored. Left alone
   * on `removePrinter`, same as every other per-printer field: re-adding the
   * same endpoint should resume the session rather than force a fresh login.
   */
  refreshToken?: string
  /**
   * Opt-in, per printer: whether Settings/layout sync
   * (`stores/settingsSync.ts`) is allowed to read and write this printer's
   * Moonraker database. Off by default. `removePrinter` deletes the whole
   * entry, this field included, so re-adding the same address starts as a
   * fresh, un-opted-in printer — a deliberate difference from data scoped by
   * printer id in *other* stores (dashboard layout, bed-mesh temperatures),
   * which `removePrinter`'s own doc comment explains is left alone because
   * it lives outside this record entirely.
   */
  dbSyncEnabled?: boolean
}

/** The host portion of an entry's address, for a printer nobody has named yet. */
export function printerHost(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}

/**
 * What a printer is called, best answer first: the name the user chose, then
 * the name the printer gave for itself, then its address.
 *
 * The address is last rather than second because it is the one answer that is
 * always available and never informative — on a wall of six machines reached by
 * IP, six addresses tell the reader nothing that the ordering did not. Every
 * surface that renders this also renders the host beside or beneath it, so
 * preferring a name costs no information: the Farm card shows the address under
 * the name when expanded, and both the header's switcher and Settings' printer
 * rows show it as the row's second line.
 */
export function printerDisplayLabel(entry: PrinterEntry): string {
  return entry.label || entry.discoveredName || printerHost(entry.endpoint)
}

interface StoredPrinters {
  version: 1
  activeId: string
  entries: PrinterEntry[]
}

function nextPrinterId(taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(idPrefix)) return idPrefix
  let suffix = 2
  while (used.has(`${idPrefix}-${suffix}`)) suffix += 1
  return `${idPrefix}-${suffix}`
}

/** An unusable endpoint drops the entry rather than the whole list. */
function normalizeEndpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    return normalizeMoonrakerWebSocketUrl(value, window.location.href)
  } catch {
    return null
  }
}

function readEntries(value: unknown): PrinterEntry[] {
  if (!Array.isArray(value)) return []
  const entries: PrinterEntry[] = []
  const taken = new Set<string>()

  for (const candidate of value) {
    if (!isRecord(candidate)) continue
    const endpoint = normalizeEndpoint(candidate.endpoint)
    if (endpoint === null) continue
    const storedId = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const id = storedId !== '' && !taken.has(storedId) ? storedId : nextPrinterId(taken)
    taken.add(id)
    entries.push({
      id,
      label: typeof candidate.label === 'string' ? candidate.label.trim() : '',
      endpoint,
      ...(typeof candidate.discoveredName === 'string' && candidate.discoveredName.trim() !== ''
        ? { discoveredName: candidate.discoveredName.trim() }
        : {}),
      ...(typeof candidate.refreshToken === 'string' && candidate.refreshToken !== ''
        ? { refreshToken: candidate.refreshToken }
        : {}),
      ...(candidate.dbSyncEnabled === true ? { dbSyncEnabled: true } : {}),
    })
  }

  return entries
}

/**
 * A single-printer install has an endpoint and possibly a custom name in their
 * own keys. They become the first entry, so upgrading does not present someone
 * with an empty printer list and a working connection.
 */
function migrateLegacy(): StoredPrinters | null {
  const endpoint = normalizeEndpoint(window.localStorage.getItem(legacyEndpointKey))
  if (endpoint === null) return null
  const label = window.localStorage.getItem(legacyNameKey)?.trim() ?? ''
  return { version: 1, activeId: idPrefix, entries: [{ id: idPrefix, label, endpoint }] }
}

function readStorage(): StoredPrinters {
  let parsed: unknown
  try {
    parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
  } catch {
    parsed = null
  }

  if (isRecord(parsed)) {
    const entries = readEntries(parsed.entries)
    const storedActive = typeof parsed.activeId === 'string' ? parsed.activeId : ''
    const activeId = entries.some((entry) => entry.id === storedActive)
      ? storedActive
      : (entries[0]?.id ?? '')
    if (entries.length > 0) return { version: 1, activeId, entries }
  }

  return migrateLegacy() ?? { version: 1, activeId: '', entries: [] }
}

/**
 * A name chosen before the printer list existed belongs to the only printer
 * there was.
 *
 * `migrateLegacy` covers upgrading straight from the single-endpoint key. This
 * covers the narrower case it cannot: a list that already exists but whose entry
 * was created by a connection rather than by migration, so its label is empty
 * while the old key still holds the chosen name. Left unhandled, that name would
 * simply stop appearing.
 */
function adoptLegacyLabel(stored: StoredPrinters): StoredPrinters {
  const legacyLabel = window.localStorage.getItem(legacyNameKey)?.trim() ?? ''
  if (legacyLabel === '') return stored

  const target = stored.entries.find((entry) => entry.id === stored.activeId) ?? stored.entries[0]
  // With no entry to name, the key is left for a later run rather than dropped.
  if (!target) return stored

  if (target.label === '') target.label = legacyLabel

  /*
   * The old key goes even when nothing was adopted, because the list now owns
   * the name: left in place it would be adopted again the next time a label was
   * empty, so clearing a name and reloading would bring the old one back.
   *
   * The list is written first — and unconditionally, since a migrated list may
   * never have been persisted — so a failure here costs neither. The name stays
   * where it was and the next run tries again.
   */
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(stored))
    window.localStorage.removeItem(legacyNameKey)
  } catch {
    // Storage is unavailable; the name stays under its old key.
  }
  return stored
}

export const usePrintersStore = defineStore('printers', () => {
  const initial = adoptLegacyLabel(readStorage())
  const entries = ref<PrinterEntry[]>(initial.entries)
  const activeId = ref(initial.activeId)

  const activeEntry = computed<PrinterEntry | null>(
    () => entries.value.find((entry) => entry.id === activeId.value) ?? null,
  )

  /**
   * Where to connect. With no printer added this is `/websocket` on the page's
   * own origin, which is what a printer's own Pi serves — so that topology needs
   * no setup at all. Off-printer it resolves to nothing useful, and adding a
   * printer is the first thing a new install does.
   */
  const activeEndpoint = computed(
    () => activeEntry.value?.endpoint ?? defaultMoonrakerWebSocketUrl(window.location.href),
  )

  const hasPrinters = computed(() => entries.value.length > 0)

  /**
   * Where a specific printer's data may be kept, best key first: its identity,
   * then the endpoint that identity's profile might still be filed under — from
   * before printers had identities, or from the moment before a first connection
   * registers one. `printerScope.ts` reads down a list like this and writes to
   * its head, so an older key is adopted once and then gone.
   *
   * Unknown ids and the empty string both answer with no keys, which is the
   * signal callers use to skip rather than seed from nothing.
   */
  function scopeKeysFor(id: string): string[] {
    const entry = entries.value.find((candidate) => candidate.id === id)
    if (!entry) return []
    const keys = [entry.id, entry.endpoint]
    return keys.filter((key, index) => key !== '' && keys.indexOf(key) === index)
  }

  /**
   * The same lookup for whichever printer is in front — except with no printer
   * added yet, where it falls back to the same-origin default so the app's own
   * telemetry and layout still have somewhere to read and write.
   */
  const activeScopeKeys = computed<string[]>(() => {
    const keys = scopeKeysFor(activeId.value)
    return keys.length > 0 ? keys : [activeEndpoint.value]
  })

  function persist(): void {
    try {
      const payload: StoredPrinters = {
        version: 1,
        activeId: activeId.value,
        entries: entries.value,
      }
      window.localStorage.setItem(storageKey, JSON.stringify(payload))
    } catch {
      // A full or unavailable store costs the list after the next reload. The
      // connection in front of the user is unaffected, so it is never worth
      // interrupting them for.
    }
  }

  /**
   * Returns the entry so a caller can scope storage to its id straight away —
   * copying another printer's dashboard, for instance. Null when the endpoint
   * cannot be understood, which is the same answer `connect` gives.
   */
  function addPrinter(endpoint: string, label = ''): PrinterEntry | null {
    const normalized = normalizeEndpoint(endpoint)
    if (normalized === null) return null

    const existing = entries.value.find((entry) => entry.endpoint === normalized)
    if (existing) {
      activeId.value = existing.id
      persist()
      return existing
    }

    const entry: PrinterEntry = {
      id: nextPrinterId(entries.value.map((candidate) => candidate.id)),
      label: label.trim(),
      endpoint: normalized,
    }
    entries.value = [...entries.value, entry]
    activeId.value = entry.id
    persist()
    return entry
  }

  function selectPrinter(id: string): boolean {
    if (!entries.value.some((entry) => entry.id === id)) return false
    activeId.value = id
    persist()
    return true
  }

  function setEndpoint(id: string, endpoint: string): boolean {
    const normalized = normalizeEndpoint(endpoint)
    if (normalized === null) return false
    const index = entries.value.findIndex((entry) => entry.id === id)
    if (index === -1) return false
    const entry = entries.value[index]
    if (!entry) return false

    // The id is untouched on purpose: this is the same printer at a new address,
    // so its layout and learned data must follow it.
    const next = [...entries.value]
    next[index] = { ...entry, endpoint: normalized }
    entries.value = next
    persist()
    return true
  }

  function setLabel(id: string, label: string): boolean {
    const index = entries.value.findIndex((entry) => entry.id === id)
    if (index === -1) return false
    const entry = entries.value[index]
    if (!entry) return false
    const next = [...entries.value]
    next[index] = { ...entry, label: label.trim() }
    entries.value = next
    persist()
    return true
  }

  /**
   * Records what a printer answered when asked its own name.
   *
   * Called from both producers that ever learn it — the live printer store for
   * the printer in front, and a Farm column's own connection for the rest —
   * which is why it writes only on a real change: a rail of twenty columns
   * reconnecting would otherwise rewrite the whole list twenty times for no
   * difference. An empty answer is ignored rather than stored, so a printer
   * that reports no hostname keeps whatever it was last known as.
   */
  function rememberDiscoveredName(id: string, name: string): boolean {
    const trimmed = name.trim()
    if (trimmed === '') return false
    const index = entries.value.findIndex((entry) => entry.id === id)
    if (index === -1) return false
    const entry = entries.value[index]
    if (!entry || entry.discoveredName === trimmed) return false
    const next = [...entries.value]
    next[index] = { ...entry, discoveredName: trimmed }
    entries.value = next
    persist()
    return true
  }

  function setDbSyncEnabled(id: string, enabled: boolean): boolean {
    const index = entries.value.findIndex((entry) => entry.id === id)
    if (index === -1) return false
    const entry = entries.value[index]
    if (!entry) return false
    const next = [...entries.value]
    const updated = { ...entry }
    if (enabled) updated.dbSyncEnabled = true
    else delete updated.dbSyncEnabled
    next[index] = updated
    entries.value = next
    persist()
    return true
  }

  /** `null` clears it — logging out, or a refresh token Moonraker has rejected. */
  function setRefreshToken(id: string, token: string | null): boolean {
    const index = entries.value.findIndex((entry) => entry.id === id)
    if (index === -1) return false
    const entry = entries.value[index]
    if (!entry) return false
    const next = [...entries.value]
    const updated = { ...entry }
    if (token === null) delete updated.refreshToken
    else updated.refreshToken = token
    next[index] = updated
    entries.value = next
    persist()
    return true
  }

  /**
   * Removing the printer in front moves to the first of what is left, so the
   * interface is never pointed at an entry that no longer exists. Storage scoped
   * to the removed id is deliberately left alone: re-adding a printer that was
   * removed by accident should find its dashboard again.
   */
  function removePrinter(id: string): boolean {
    if (!entries.value.some((entry) => entry.id === id)) return false
    entries.value = entries.value.filter((entry) => entry.id !== id)
    if (activeId.value === id) activeId.value = entries.value[0]?.id ?? ''
    persist()
    return true
  }

  return {
    entries,
    activeId,
    activeEntry,
    activeEndpoint,
    activeScopeKeys,
    scopeKeysFor,
    hasPrinters,
    addPrinter,
    selectPrinter,
    setEndpoint,
    setLabel,
    rememberDiscoveredName,
    setRefreshToken,
    setDbSyncEnabled,
    removePrinter,
  }
})
