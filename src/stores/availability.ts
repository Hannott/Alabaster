import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
export type KlipperState = 'disconnected' | 'startup' | 'ready' | 'error' | 'shutdown'
export type SubscriptionState = 'inactive' | 'synchronizing' | 'ready'
export type AvailabilityRequirement = 'local' | 'moonraker' | 'klipper'
export type AvailabilityPhase = 'available' | 'recovering' | 'unavailable' | 'error'
export type AvailabilityReason =
  | 'none'
  | 'moonrakerConnecting'
  | 'moonrakerReconnecting'
  | 'moonrakerDisconnected'
  | 'klipperStarting'
  | 'printerSynchronizing'
  | 'klipperDisconnected'
  | 'klipperError'
  | 'klipperShutdown'

export interface AvailabilityState {
  phase: AvailabilityPhase
  reason: AvailabilityReason
  isAvailable: boolean
  isStale: boolean
}

export interface MoonrakerServerInfo {
  klippy_connected: boolean
  klippy_state: KlipperState
}

export type KlipperLifecycleNotification =
  | 'notify_klippy_ready'
  | 'notify_klippy_shutdown'
  | 'notify_klippy_disconnected'
  | 'notify_klippy_started'

const availableState: AvailabilityState = {
  phase: 'available',
  reason: 'none',
  isAvailable: true,
  isStale: false,
}

export const useAvailabilityStore = defineStore('availability', () => {
  const transportState = ref<TransportState>('disconnected')
  const klipperState = ref<KlipperState>('disconnected')
  /**
   * Klipper's own sentence about why it is not ready — the config error that
   * ended the load, the MCU's shutdown reason. Held here because it is
   * lifecycle state like the state itself, and because it is the only place in
   * the product where the reason for a failed boot exists at all: `server.info`
   * reports `error` and stops there, and a reader with only that has to open a
   * log file to learn what happened.
   *
   * Reported by whichever source saw it first — the `webhooks` subscription
   * while Klipper was still running, `printer.info` on the lifecycle poll when
   * it never started — so it is stored whatever the current state says and read
   * only where it means something, which is a fault. Cleared when Klipper
   * reaches ready and when a connection or a printer goes away, never on the
   * way into a fault: the message routinely arrives a moment before the state
   * that explains it, and clearing on entry would drop it.
   */
  const klipperMessage = ref('')
  const subscriptionState = ref<SubscriptionState>('inactive')
  const hasReachedMoonraker = ref(false)
  const hasReachedKlipper = ref(false)

  const isMoonrakerConnected = computed(() => transportState.value === 'connected')
  const isKlipperReady = computed(
    () =>
      isMoonrakerConnected.value &&
      klipperState.value === 'ready' &&
      subscriptionState.value === 'ready',
  )

  function beginConnection(): void {
    transportState.value = hasReachedMoonraker.value ? 'reconnecting' : 'connecting'
  }

  function moonrakerConnected(serverInfo: MoonrakerServerInfo): void {
    transportState.value = 'connected'
    hasReachedMoonraker.value = true
    setKlipperState(serverInfo.klippy_connected ? serverInfo.klippy_state : 'disconnected')
  }

  function moonrakerConnectionLost(): void {
    transportState.value = hasReachedMoonraker.value ? 'reconnecting' : 'disconnected'
    klipperState.value = 'disconnected'
    klipperMessage.value = ''
    subscriptionState.value = 'inactive'
  }

  function moonrakerConnectionFailed(): void {
    transportState.value = hasReachedMoonraker.value ? 'reconnecting' : 'disconnected'
  }

  function moonrakerDisconnected(): void {
    transportState.value = 'disconnected'
    klipperState.value = 'disconnected'
    klipperMessage.value = ''
    subscriptionState.value = 'inactive'
  }

  /**
   * A different printer, so everything learned about the previous one is void.
   *
   * `hasReachedMoonraker` and `hasReachedKlipper` are what separate "never
   * answered" from "answered once and dropped": they decide whether a region
   * renders as unavailable or as stale, and whether the transport reports
   * `connecting` or `reconnecting`. Carried across a switch they make a machine
   * nobody has spoken to yet look like one that just went quiet, and dim its
   * last-known data as though it belonged to this printer.
   *
   * Callers must invoke this *before* the new connection begins, because
   * `beginConnection` reads `hasReachedMoonraker` synchronously.
   */
  function printerChanged(): void {
    transportState.value = 'disconnected'
    klipperState.value = 'disconnected'
    klipperMessage.value = ''
    subscriptionState.value = 'inactive'
    hasReachedMoonraker.value = false
    hasReachedKlipper.value = false
  }

  function setKlipperState(nextState: KlipperState): void {
    const previousState = klipperState.value
    klipperState.value = nextState
    if (nextState === 'ready') klipperMessage.value = ''

    if (nextState !== 'ready') {
      subscriptionState.value = 'inactive'
    } else if (previousState !== 'ready') {
      subscriptionState.value = 'synchronizing'
    }
  }

  /** See `klipperMessage` for why this stores whatever it is given. */
  function reportKlipperMessage(message: string): void {
    klipperMessage.value = message
  }

  function printerSnapshotSynchronized(): boolean {
    if (!isMoonrakerConnected.value || klipperState.value !== 'ready') return false

    subscriptionState.value = 'ready'
    hasReachedKlipper.value = true
    return true
  }

  function handleKlipperNotification(notification: KlipperLifecycleNotification): void {
    const stateByNotification: Record<KlipperLifecycleNotification, KlipperState> = {
      notify_klippy_ready: 'ready',
      notify_klippy_shutdown: 'shutdown',
      notify_klippy_disconnected: 'disconnected',
      notify_klippy_started: 'startup',
    }

    setKlipperState(stateByNotification[notification])
  }

  function availabilityFor(requirement: AvailabilityRequirement): AvailabilityState {
    if (requirement === 'local') return availableState

    if (!isMoonrakerConnected.value) {
      const isRecovering =
        transportState.value === 'connecting' || transportState.value === 'reconnecting'

      return {
        phase: isRecovering ? 'recovering' : 'unavailable',
        reason:
          transportState.value === 'connecting'
            ? 'moonrakerConnecting'
            : transportState.value === 'reconnecting'
              ? 'moonrakerReconnecting'
              : 'moonrakerDisconnected',
        isAvailable: false,
        isStale: hasReachedMoonraker.value,
      }
    }

    if (requirement === 'moonraker') return availableState
    if (isKlipperReady.value) return availableState

    if (klipperState.value === 'ready') {
      return {
        phase: 'recovering',
        reason: 'printerSynchronizing',
        isAvailable: false,
        isStale: hasReachedKlipper.value,
      }
    }

    const state: Record<Exclude<KlipperState, 'ready'>, AvailabilityState> = {
      startup: {
        phase: 'recovering',
        reason: 'klipperStarting',
        isAvailable: false,
        isStale: hasReachedKlipper.value,
      },
      disconnected: {
        phase: hasReachedKlipper.value ? 'recovering' : 'unavailable',
        reason: 'klipperDisconnected',
        isAvailable: false,
        isStale: hasReachedKlipper.value,
      },
      error: {
        phase: 'error',
        reason: 'klipperError',
        isAvailable: false,
        isStale: hasReachedKlipper.value,
      },
      shutdown: {
        phase: 'error',
        reason: 'klipperShutdown',
        isAvailable: false,
        isStale: hasReachedKlipper.value,
      },
    }

    return state[klipperState.value as Exclude<KlipperState, 'ready'>]
  }

  return {
    transportState,
    klipperState,
    klipperMessage,
    subscriptionState,
    hasReachedMoonraker,
    hasReachedKlipper,
    isMoonrakerConnected,
    isKlipperReady,
    beginConnection,
    moonrakerConnected,
    moonrakerConnectionLost,
    moonrakerConnectionFailed,
    moonrakerDisconnected,
    printerChanged,
    setKlipperState,
    reportKlipperMessage,
    printerSnapshotSynchronized,
    handleKlipperNotification,
    availabilityFor,
  }
})
