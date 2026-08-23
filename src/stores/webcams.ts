import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import { normalizeCamera, resolveCameraUrl, type Camera } from '@/features/camera/camera'
import type {
  MoonrakerWebcam,
  MoonrakerWebcamPatch,
  MoonrakerWebcamTestResult,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { createCommandRunner } from '@/stores/commandRunner'
import { createGuardedLoad } from '@/stores/guardedLoad'
import { useMoonrakerStore } from '@/stores/moonraker'

/**
 * Kept as a re-export because the URL rule it implements — resolve against the
 * printer's websocket host, never the page's own origin — is the same one
 * `spool.ts` cites, and the tests that pin it were written against this name.
 */
export { resolveCameraUrl as resolveWebcamUrl }

export type WebcamCommandKey = 'save' | 'delete' | 'test'

export const useWebcamsStore = defineStore('webcams', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  const webcams = ref<MoonrakerWebcam[]>([])
  const isLoading = ref(false)
  const failed = ref(false)
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopWebcamNotifications: (() => void) | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  let started = false
  const load = createGuardedLoad({ isLoading, failed })
  const commands = createCommandRunner<WebcamCommandKey>(['save', 'delete', 'test'])

  /**
   * Every camera the printer knows about, disabled ones included — the
   * settings section has to list a camera in order to re-enable it, so
   * filtering here would make it unreachable. Consumers that render streams
   * take `enabledCameras` instead.
   */
  const cameras = computed<Camera[]>(() =>
    webcams.value.map((webcam) => normalizeCamera(webcam, moonraker.endpoint)),
  )

  const enabledCameras = computed<Camera[]>(() => cameras.value.filter((camera) => camera.enabled))

  /**
   * Looks a camera up by the identifier a dashboard card stored. Falls back to
   * the name because a card configured against a Moonraker too old to send
   * UIDs holds a name in that slot, and because a camera that was renamed
   * elsewhere is better found by its old name than dropped from the card.
   */
  function cameraByUid(uid: string): Camera | null {
    return (
      cameras.value.find((camera) => camera.uid === uid) ??
      cameras.value.find((camera) => camera.name === uid) ??
      null
    )
  }

  /**
   * The camera a card falls back to when it has never been configured, and the
   * one the collapsed-card summary reads. First enabled rather than first
   * listed: a camera someone switched off is one they deliberately stopped
   * watching.
   */
  const primaryCamera = computed<Camera | null>(() => enabledCameras.value[0] ?? null)

  /** The camera list is the other machine's hardware; it goes with the switch. */
  function printerChanged(): void {
    load.invalidate()
    webcams.value = []
    failed.value = false
    commands.reset()
  }

  async function refresh(): Promise<void> {
    await load.run(
      () => moonraker.rpcCall('server.webcams.list'),
      (result) => {
        webcams.value = result.webcams
      },
    )
  }

  /**
   * Creates a camera when `patch` carries no `uid` and updates the named one
   * when it does. The list is not patched locally on success: Moonraker fires
   * `notify_webcams_changed` for its own write, so the reload below is the
   * same path a camera added from Mainsail takes — one code path instead of an
   * optimistic update that could disagree with what the server actually stored.
   */
  function save(patch: MoonrakerWebcamPatch): Promise<boolean> {
    return commands.run('save', () => moonraker.rpcCall('server.webcams.post_item', patch))
  }

  function remove(uid: string): Promise<boolean> {
    return commands.run('delete', () => moonraker.rpcCall('server.webcams.delete_item', { uid }))
  }

  /**
   * Asks Moonraker to reach the camera's snapshot from the printer's own
   * network. Null when the call itself failed, which is a different answer
   * from `snapshot_reachable: false` — the first says Alabaster could not ask,
   * the second says the printer asked and got nothing.
   */
  async function test(uid: string): Promise<MoonrakerWebcamTestResult | null> {
    const holder: { result: MoonrakerWebcamTestResult | null } = { result: null }
    const succeeded = await commands.run('test', async () => {
      holder.result = await moonraker.rpcCall('server.webcams.test', { uid })
    })
    return succeeded ? holder.result : null
  }

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopAvailabilityWatch = watch(
      () => availability.isMoonrakerConnected,
      (isConnected) => {
        if (isConnected) void refresh()
      },
      { immediate: true },
    )
    // A camera added or renamed from another client has to appear without a
    // reload; this is the notification Moonraker fires when its webcam list
    // changes.
    try {
      stopWebcamNotifications = moonraker.onNotification('notify_webcams_changed', () => {
        void refresh()
      })
    } catch {
      stopWebcamNotifications = null
    }
  }

  function stop(): void {
    if (!started) return
    started = false
    load.invalidate()
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopWebcamNotifications?.()
    stopWebcamNotifications = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
  }

  return {
    webcams,
    cameras,
    enabledCameras,
    cameraByUid,
    primaryCamera,
    isLoading,
    failed,
    pendingCommands: commands.pendingCommands,
    lastCommandError: commands.lastCommandError,
    lastCommandErrorMessage: commands.lastCommandErrorMessage,
    clearCommandError: commands.clearCommandError,
    save,
    remove,
    test,
    start,
    stop,
    refresh,
  }
})
