import {
  configBoolean,
  configNumber,
  configOptionalStringList,
  configString,
} from '@/dashboard/context'
import type { DashboardModuleInstance } from '@/dashboard/layout'
import type { Camera } from '@/features/camera/camera'

/**
 * One Camera card's configuration, read once and shared by the card, its two
 * settings layers, and the collapsed-card summary on the registry definition —
 * which is the reason this lives outside the component: a collapsed card has no
 * component mounted, and `summary()` still has to read the card's own settings
 * the way the card would.
 */

export const cameraArrangements = ['grid', 'tabs'] as const
export type CameraArrangement = (typeof cameraArrangements)[number]

/**
 * Which way several cameras on one card run: across, or down.
 *
 * It pairs with `columns` rather than replacing it — the axis and how many fit
 * across it are two questions, and answering only the second leaves "one
 * column" standing in for "stacked", which is not what anybody reads it as.
 * `columns` therefore only has anything to say while the stacking is
 * horizontal.
 */
export const cameraStackings = ['horizontal', 'vertical'] as const
export type CameraStacking = (typeof cameraStackings)[number]

export const cameraMaxColumns = 4

export interface CameraCardSettings {
  /**
   * The cameras this card shows, in the order it shows them, by UID.
   *
   * `null` is a card nobody has configured yet, and it is deliberately *not*
   * the same as `[]`. A never-configured card takes the first camera no other
   * card is already showing, which is what makes adding a second Camera card
   * useful — the alternative, an implicit fall back to the printer's first
   * camera, gave every new card the same stream and no indication why. `[]` is a
   * card whose cameras were all removed on purpose and stays empty.
   */
  cameraUids: string[] | null
  arrangement: CameraArrangement
  /** Ignored by the tab arrangement, which shows one camera at a time. */
  stacking: CameraStacking
  /** How many cameras sit across a horizontal row. Ignored when stacked. */
  columns: number
  showLabels: boolean
  showFrameRate: boolean
}

function arrangementOf(value: string): CameraArrangement {
  return cameraArrangements.includes(value as CameraArrangement)
    ? (value as CameraArrangement)
    : 'grid'
}

function stackingOf(value: string): CameraStacking {
  return cameraStackings.includes(value as CameraStacking)
    ? (value as CameraStacking)
    : 'horizontal'
}

export function cameraCardSettings(config: Record<string, unknown>): CameraCardSettings {
  return {
    cameraUids: configOptionalStringList(config, 'cameras'),
    arrangement: arrangementOf(configString(config, 'arrangement', 'grid')),
    stacking: stackingOf(configString(config, 'stacking', 'horizontal')),
    columns: Math.min(
      cameraMaxColumns,
      Math.max(1, Math.round(configNumber(config, 'columns', 2))),
    ),
    showLabels: configBoolean(config, 'showLabels', true),
    showFrameRate: configBoolean(config, 'showFrameRate', true),
  }
}

/**
 * The cameras a card actually renders.
 *
 * A stored UID that matches nothing is dropped rather than rendered as a
 * placeholder: unlike a missing macro — where the button is the configuration
 * and marking it tells the user what to fix — a missing camera has no control
 * to mark, and a permanently black tile in a grid reads as a broken camera
 * rather than as a deleted one. The settings pane is where a stale selection is
 * visible and fixable.
 *
 * Disabled cameras are dropped for the same reason. "Enabled" is the switch
 * whose whole purpose is to stop a camera being streamed, and honoring it only
 * in the settings list would leave the card streaming from a camera its owner
 * switched off.
 */
export function selectedCameras(settings: CameraCardSettings, cameras: Camera[]): Camera[] {
  return (settings.cameraUids ?? [])
    .map((uid) => cameras.find((camera) => camera.uid === uid) ?? null)
    .filter((camera): camera is Camera => camera !== null && camera.enabled)
}

/**
 * Which cameras the *other* Camera cards have claimed.
 *
 * Two cards showing one camera means two streams of the same picture: double the
 * bandwidth and double the load on the printer for nothing, and no way to tell
 * the cards apart at a glance. So a camera already on another card is not
 * offered again — the pane lists what is left, and a new card takes the first of
 * those.
 */
export function camerasOnOtherCards(
  instances: readonly DashboardModuleInstance[],
  ownInstanceId: string,
): Set<string> {
  const claimed = new Set<string>()
  for (const instance of instances) {
    if (instance.moduleId !== 'camera' || instance.instanceId === ownInstanceId) continue
    for (const uid of cameraCardSettings(instance.config).cameraUids ?? []) claimed.add(uid)
  }
  return claimed
}

/**
 * The camera a never-configured card should adopt, or null when every camera is
 * already spoken for. Enabled cameras only: a card seeded with a switched-off
 * camera would render its empty state and look broken.
 */
export function firstUnclaimedCamera(cameras: Camera[], claimed: Set<string>): Camera | null {
  return cameras.find((camera) => camera.enabled && !claimed.has(camera.uid)) ?? null
}
