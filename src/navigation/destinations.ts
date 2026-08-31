import type { AppIconName } from '@/components/AppIcon.vue'

/**
 * The primary navigation, as data. Order, labels, gating, and mobile placement
 * all live here so a new destination is one entry rather than an edit to the
 * shell — see `docs/design/navigation-plan.md`, which decides what earns one.
 */

/** Every routed destination the navigation can offer. */
export type NavigationDestinationName =
  | 'farm'
  | 'overview'
  | 'printFiles'
  | 'gcodeViewer'
  | 'history'
  | 'timelapse'
  | 'calibration'
  | 'configuration'
  | 'machine'
  | 'console'
  | 'settings'

/**
 * Where a destination sits in the mobile navigation. The bar holds the few
 * destinations worth a permanent cell at 390 px; everything else is reachable
 * through the bar's overflow menu. Nothing may be absent from both: a
 * destination the mobile navigation drops entirely is unreachable on a phone,
 * which is the defect this split exists to prevent.
 */
export type MobilePlacement = 'bar' | 'overflow'

/**
 * What the machine has to support for a destination to be worth showing.
 *
 * Declared rather than computed, unlike the dashboard registry's `summary`,
 * because capability is a fact about the machine's configuration rather than a
 * live reading — which keeps this table pure data and testable without a store.
 * Absent means the destination always applies.
 */
export interface DestinationCapability {
  /** A Moonraker file root that must be registered, from `server.info`. */
  root?: string
  /** A Moonraker component that must be loaded, from `server.info`. */
  component?: string
  /** A Klipper config section that must exist, from `usePrinterConfigStore`. */
  configSection?: string
}

export interface NavigationDestination {
  name: NavigationDestinationName
  /** i18n key for the label, which is also the accessible name. */
  labelKey: string
  icon: AppIconName
  /**
   * Numbered in tens so a gated or future destination slots in without
   * renumbering its neighbours. Position, not array order, is authoritative.
   */
  position: number
  capability?: DestinationCapability
  /**
   * How many printers have to be saved in this browser before the destination
   * is worth offering. A fact about the browser rather than about the machine,
   * which is why it is separate from `capability` above: that table describes
   * what a printer can serve, and answers from the server's own report.
   *
   * Declared here rather than checked in the shell for the reason the rest of
   * this table exists — gating written at the call site is gating in two
   * places, and the second one is the one nobody updates.
   */
  requiresSavedPrinters?: number
  /**
   * Whether the user may hide this destination from the rail.
   *
   * A bounded exception, granted per destination and listed here rather than
   * offered generally: a rail the user can empty is a rail that can strand
   * them, and every destination below is somewhere Alabaster expects to be able
   * to send someone — an error toast that says "see Machine" is worthless if
   * Machine can be switched off. **Farm is the only instance**, and it earns it
   * because it is the one destination that is about the printer list rather
   * than about a printer: somebody who has saved a second machine but drives
   * them one at a time is not choosing to hide a feature, they are saying the
   * feature does not describe how they work.
   *
   * The preference itself lives in `composables/useHiddenDestinations.ts`;
   * this flag is what makes it legal.
   */
  hideable?: boolean
  mobile: MobilePlacement
}

const destinations: readonly NavigationDestination[] = [
  {
    name: 'farm',
    labelKey: 'navigation.farm',
    icon: 'lan',
    /*
     * First, and the only entry above Overview: everything below it on the rail
     * is about one printer, and this is the step before that — choosing which
     * machine the rest of the arc applies to. Adding it renumbered the rail
     * rather than taking a position between two existing ones, because the tens
     * convention has no room above its first entry and a position of 5 would
     * have made the rule "tens, except once".
     *
     * Absent entirely on a single-printer install, where it would be a page
     * showing one column.
     */
    position: 10,
    requiresSavedPrinters: 2,
    hideable: true,
    mobile: 'overflow',
  },
  {
    name: 'overview',
    labelKey: 'navigation.overview',
    icon: 'overview',
    position: 20,
    mobile: 'bar',
  },
  {
    name: 'console',
    labelKey: 'navigation.console',
    icon: 'console',
    position: 30,
    mobile: 'bar',
  },
  {
    name: 'calibration',
    labelKey: 'navigation.calibration',
    icon: 'controls',
    position: 40,
    mobile: 'overflow',
  },
  {
    name: 'printFiles',
    labelKey: 'navigation.printFiles',
    icon: 'jobs',
    // Nothing to browse without the root that holds the files.
    capability: { root: 'gcodes' },
    position: 50,
    mobile: 'bar',
  },
  {
    name: 'history',
    labelKey: 'navigation.history',
    icon: 'history',
    // Moonraker records nothing without the component, so the page would be a
    // permanently empty list on an instance that has it switched off.
    capability: { component: 'history' },
    position: 60,
    mobile: 'bar',
  },
  {
    name: 'gcodeViewer',
    labelKey: 'navigation.gcodeViewer',
    icon: 'viewer',
    position: 70,
    mobile: 'overflow',
  },
  {
    name: 'timelapse',
    labelKey: 'navigation.timelapse',
    icon: 'camera',
    // The component is a separate install; without it the root does not exist.
    capability: { component: 'timelapse' },
    position: 80,
    mobile: 'overflow',
  },
  {
    name: 'configuration',
    labelKey: 'navigation.configuration',
    icon: 'folderCode',
    // Moonraker only registers the config root when `config_path` is set, and
    // the workspace can do nothing without it.
    capability: { root: 'config' },
    position: 90,
    mobile: 'overflow',
  },
  {
    name: 'machine',
    labelKey: 'navigation.machine',
    icon: 'machine',
    position: 100,
    mobile: 'overflow',
  },
  {
    name: 'settings',
    labelKey: 'navigation.settings',
    icon: 'gears',
    position: 110,
    mobile: 'overflow',
  },
]

/** The destinations in rail order. Sorted here so `position` cannot drift from it. */
export const navigationDestinations: readonly NavigationDestination[] = Object.freeze(
  [...destinations].sort((first, second) => first.position - second.position),
)

/**
 * The destinations a user is allowed to hide, derived from the table rather
 * than listed a second time — see `hideable` above for what earns the flag.
 * `useHiddenDestinations` filters stored preferences against this, so removing
 * a flag un-hides the destination instead of stranding it.
 */
export const hideableDestinations: readonly NavigationDestinationName[] = Object.freeze(
  navigationDestinations
    .filter((destination) => destination.hideable === true)
    .map((destination) => destination.name),
)

/**
 * What a machine reports it can do. Implemented by the stores in the
 * application and by plain objects in tests.
 */
export interface MachineCapabilities {
  hasRoot: (root: string) => boolean
  hasComponent: (component: string) => boolean
  hasConfigSection: (section: string) => boolean
  /** How many printers this browser has saved. Absent means one, the historical case. */
  savedPrinters?: number
}

/**
 * Whether this machine supports the destination at all.
 *
 * Distinct from availability: an unsupported destination is never rendered,
 * while a supported one whose printer is unreachable stays in the rail and
 * renders its unavailable state. A rail that offers a destination the machine
 * cannot serve leads the user to an empty page and makes them doubt their own
 * configuration.
 */
export function isDestinationSupported(
  destination: NavigationDestination,
  capabilities: MachineCapabilities,
): boolean {
  const { root, component, configSection } = destination.capability ?? {}
  if (root !== undefined && !capabilities.hasRoot(root)) return false
  if (component !== undefined && !capabilities.hasComponent(component)) return false
  if (configSection !== undefined && !capabilities.hasConfigSection(configSection)) return false
  if (
    destination.requiresSavedPrinters !== undefined &&
    (capabilities.savedPrinters ?? 1) < destination.requiresSavedPrinters
  )
    return false
  return true
}

/**
 * Whether the destination belongs in the rail right now: supported by this
 * machine *and* not one the user has hidden.
 *
 * Composed here rather than at the call site for the reason the table exists —
 * gating written where the rail is rendered is gating in two places, and the
 * second one is the one nobody updates when a third condition arrives.
 */
export function isDestinationVisible(
  destination: NavigationDestination,
  capabilities: MachineCapabilities,
  hidden: readonly NavigationDestinationName[] = [],
): boolean {
  if (!isDestinationSupported(destination, capabilities)) return false
  return !(destination.hideable === true && hidden.includes(destination.name))
}
