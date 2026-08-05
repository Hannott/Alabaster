import { readonly, ref, watch } from 'vue'

const storageKey = 'alabaster.wakeLock.enabled'

function getInitialEnabled(): boolean {
  return localStorage.getItem(storageKey) === 'true'
}

/** Absent entirely in some browsers (older Firefox/Safari). Checked once — not a capability that changes at runtime. */
export const isWakeLockSupported = 'wakeLock' in navigator

/**
 * The Wake Lock API is a secure-context feature. Alabaster is deliberately
 * served over plain HTTP on the LAN (ADR 0003), so this is false for most
 * real deployments — reached over a LAN IP or a `.local` hostname — even
 * though it is true at `localhost` or behind HTTPS.
 */
export const isWakeLockSecureContext = window.isSecureContext === true

const enabled = ref(getInitialEnabled())
const isActive = ref(false)

let sentinel: WakeLockSentinel | null = null

function setEnabled(next: boolean): void {
  enabled.value = next
  localStorage.setItem(storageKey, String(next))
}

async function acquire(): Promise<void> {
  if (!isWakeLockSupported || !isWakeLockSecureContext) return
  if (sentinel || document.visibilityState !== 'visible') return
  try {
    const next = await navigator.wakeLock.request('screen')
    // A request made while this resolved could already be stale — enabled
    // may have been turned off, or another acquire already landed.
    if (!enabled.value || sentinel) {
      void next.release()
      return
    }
    sentinel = next
    isActive.value = true
    sentinel.addEventListener('release', () => {
      sentinel = null
      isActive.value = false
    })
  } catch {
    isActive.value = false
  }
}

function release(): void {
  const current = sentinel
  sentinel = null
  isActive.value = false
  void current?.release()
}

watch(enabled, (next) => {
  if (next) void acquire()
  else release()
})

/**
 * The lock releases itself the moment the tab is hidden — that is the API's
 * own behavior, not a bug here — so the only way to honor "keep this on"
 * across a tab switch or screen lock is to ask again every time the page
 * becomes visible.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && enabled.value) void acquire()
})

if (enabled.value) void acquire()

export function useWakeLock() {
  return {
    isSupported: isWakeLockSupported,
    isSecureContext: isWakeLockSecureContext,
    enabled: readonly(enabled),
    isActive: readonly(isActive),
    setEnabled,
  }
}
