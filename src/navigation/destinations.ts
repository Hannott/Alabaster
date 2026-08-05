import type { AppIconName } from '@/components/AppIcon.vue'

/**
 * The primary navigation, as data. Order, labels, gating, and mobile placement
 * all live here so a new destination is one entry rather than an edit to the
 * shell — see `docs/design/navigation-plan.md`, which decides what earns one.
 */

/** Every routed destination the navigation can offer. */
export type NavigationDestinationName =
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
  mobile: MobilePlacement
}

const destinations: readonly NavigationDestination[] = [
  {
    name: 'overview',
    labelKey: 'navigation.overview',
    icon: 'overview',
    position: 10,
    mobile: 'bar',
  },
  {
    name: 'console',
    labelKey: 'navigation.console',
    icon: 'console',
    position: 20,
    mobile: 'overflow',
  },
  {
    name: 'calibration',
    labelKey: 'navigation.calibration',
    icon: 'mesh',
    position: 30,
    mobile: 'overflow',
  },
  {
    name: 'printFiles',
    labelKey: 'navigation.printFiles',
    icon: 'jobs',
    // Nothing to browse without the root that holds the files.
    capability: { root: 'gcodes' },
    position: 40,
    mobile: 'bar',
  },
  {
    name: 'history',
    labelKey: 'navigation.history',
    icon: 'history',
    // Moonraker records nothing without the component, so the page would be a
    // permanently empty list on an instance that has it switched off.
    capability: { component: 'history' },
    position: 50,
    mobile: 'overflow',
  },
  {
    name: 'gcodeViewer',
    labelKey: 'navigation.gcodeViewer',
    icon: 'viewer',
    position: 60,
    mobile: 'overflow',
  },
  {
    name: 'timelapse',
    labelKey: 'navigation.timelapse',
    icon: 'camera',
    // The component is a separate install; without it the root does not exist.
    capability: { component: 'timelapse' },
    position: 70,
    mobile: 'overflow',
  },
  {
    name: 'configuration',
    labelKey: 'navigation.configuration',
    icon: 'folderCode',
    // Moonraker only registers the config root when `config_path` is set, and
    // the workspace can do nothing without it.
    capability: { root: 'config' },
    position: 80,
    mobile: 'bar',
  },
  {
    name: 'machine',
    labelKey: 'navigation.machine',
    icon: 'machine',
    position: 90,
    mobile: 'bar',
  },
  {
    name: 'settings',
    labelKey: 'navigation.settings',
    icon: 'settings',
    position: 100,
    mobile: 'overflow',
  },
]

/** The destinations in rail order. Sorted here so `position` cannot drift from it. */
export const navigationDestinations: readonly NavigationDestination[] = Object.freeze(
  [...destinations].sort((first, second) => first.position - second.position),
)

/**
 * What a machine reports it can do. Implemented by the stores in the
 * application and by plain objects in tests.
 */
export interface MachineCapabilities {
  hasRoot: (root: string) => boolean
  hasComponent: (component: string) => boolean
  hasConfigSection: (section: string) => boolean
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
  return true
}
