import { markRaw, type Component } from 'vue'

import type { AppIconName } from '@/components/AppIcon.vue'
import ActivityModule from '@/components/dashboard/modules/ActivityModule.vue'
import BedMeshModule from '@/components/dashboard/modules/BedMeshModule.vue'
import BedMeshQuickSettings from '@/components/dashboard/modules/BedMeshQuickSettings.vue'
import BedMeshSettingsPane from '@/components/dashboard/modules/BedMeshSettingsPane.vue'
import CameraModule from '@/components/dashboard/modules/CameraModule.vue'
import CameraQuickSettings from '@/components/dashboard/modules/CameraQuickSettings.vue'
import CameraSettingsPane from '@/components/dashboard/modules/CameraSettingsPane.vue'
import {
  cameraCardSettings,
  selectedCameras,
} from '@/components/dashboard/modules/cameraCardSettings'
import ConsoleModule from '@/components/dashboard/modules/ConsoleModule.vue'
import ConsoleQuickSettings from '@/components/dashboard/modules/ConsoleQuickSettings.vue'
import ConsoleSettingsPane from '@/components/dashboard/modules/ConsoleSettingsPane.vue'
import ControlsModule from '@/components/dashboard/modules/ControlsModule.vue'
import ControlsQuickSettings from '@/components/dashboard/modules/ControlsQuickSettings.vue'
import ControlsSettingsPane from '@/components/dashboard/modules/ControlsSettingsPane.vue'
import ExtruderModule from '@/components/dashboard/modules/ExtruderModule.vue'
import ExtruderQuickSettings from '@/components/dashboard/modules/ExtruderQuickSettings.vue'
import ExtruderSettingsPane from '@/components/dashboard/modules/ExtruderSettingsPane.vue'
import JobQueueModule from '@/components/dashboard/modules/JobQueueModule.vue'
import MachineModule from '@/components/dashboard/modules/MachineModule.vue'
import MachineQuickSettings from '@/components/dashboard/modules/MachineQuickSettings.vue'
import MachineSettingsPane from '@/components/dashboard/modules/MachineSettingsPane.vue'
import MaintenanceModule from '@/components/dashboard/modules/MaintenanceModule.vue'
import MacrosModule from '@/components/dashboard/modules/MacrosModule.vue'
import MacrosQuickSettings from '@/components/dashboard/modules/MacrosQuickSettings.vue'
import MacrosSettingsPane from '@/components/dashboard/modules/MacrosSettingsPane.vue'
import MovementModule from '@/components/dashboard/modules/MovementModule.vue'
import MovementQuickSettings from '@/components/dashboard/modules/MovementQuickSettings.vue'
import MovementSettingsPane from '@/components/dashboard/modules/MovementSettingsPane.vue'
import PrintModule from '@/components/dashboard/modules/PrintModule.vue'
import PrintQuickSettings from '@/components/dashboard/modules/PrintQuickSettings.vue'
import PrintSettingsPane from '@/components/dashboard/modules/PrintSettingsPane.vue'
import { printProgressFraction } from '@/components/dashboard/modules/printCardSettings'
import SpoolModule from '@/components/dashboard/modules/SpoolModule.vue'
import SpoolQuickSettings from '@/components/dashboard/modules/SpoolQuickSettings.vue'
import SpoolSettingsPane from '@/components/dashboard/modules/SpoolSettingsPane.vue'
import TemperaturesModule from '@/components/dashboard/modules/TemperaturesModule.vue'
import TemperaturesQuickSettings from '@/components/dashboard/modules/TemperaturesQuickSettings.vue'
import TemperaturesSettingsPane from '@/components/dashboard/modules/TemperaturesSettingsPane.vue'
import type { DashboardModuleId } from '@/dashboard/layout'
import {
  bedMeshDefaultQuickKeys,
  cameraDefaultQuickKeys,
  consoleDefaultQuickKeys,
  controlsDefaultQuickKeys,
  extruderDefaultQuickKeys,
  machineDefaultQuickKeys,
  macrosDefaultQuickKeys,
  movementDefaultQuickKeys,
  printDefaultQuickKeys,
  spoolDefaultQuickKeys,
  temperaturesDefaultQuickKeys,
} from '@/dashboard/quickSettingDefaults'
import { i18n } from '@/i18n'
import type { AvailabilityRequirement } from '@/stores/availability'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useMaintenanceStore } from '@/stores/maintenance'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useSpoolStore } from '@/stores/spool'
import { useTelemetryStore } from '@/stores/telemetry'
import { useWebcamsStore } from '@/stores/webcams'

export interface DashboardModuleDefinition {
  id: DashboardModuleId
  titleKey: string
  icon: AppIconName
  requires: AvailabilityRequirement
  /**
   * A Moonraker component this module is built entirely around, such as
   * `spoolman`. Unlike `requires`, which every module has and which describes
   * the transport/Klipper tiers every printer shares, this names an optional
   * component a printer's Moonraker may not have configured at all — see
   * ADR 0006's "A module may require a Moonraker component". Checked only at
   * render time, in `DashboardView`'s `renderedModules`; the instance itself
   * is never excluded from normalization or the module tray.
   */
  requiresComponent?: string
  component: Component
  /** The module can appear more than once, each card with its own configuration. */
  supportsMultiple?: boolean
  /** The module renders a short disclosure layer that the card header can reveal. */
  hasSettings?: boolean
  /**
   * What changes what the card shows: the rows of the disclosure layer. Named
   * here as well as rendered by the module, because the surface hides the
   * card's gear while it is docked and repeats these at the top of its pane —
   * from one component, so the two cannot drift.
   */
  quickSettingsComponent?: Component
  /**
   * A module that lets the user promote or demote its own settings into the
   * quick layer (see `useQuickSettings`) names the keys shown on a
   * never-customized instance here. Its absence means the module still has a
   * fixed `quickSettingsComponent` nobody can turn off, so `moduleHasQuickSettings`
   * treats it as always having something to disclose.
   */
  quickSettingsDefaultKeys?: readonly string[]
  /**
   * Whether one promoted setting has a row to render right now, for a module
   * whose quick rows are conditional. Only such a module needs it; every other
   * one leaves it unset and `moduleHasQuickSettings` counts keys as before.
   *
   * It lives on the definition for the same reason `summary` does: the question
   * is asked by the card header, which has no module mounted to ask.
   */
  quickSettingRowVisible?: (key: string, config: Record<string, unknown>) => boolean
  /**
   * The module's full configuration, shown in the settings surface with this
   * card docked beside it. Independent of `hasSettings`: a module may have
   * either layer, both, or neither. See `docs/design/settings-surface.md`.
   */
  settingsComponent?: Component
  /**
   * The one value worth keeping visible while the card is collapsed, rendered in
   * the card header. It lives on the definition rather than inside the module
   * because a collapsed card unmounts its module, and it returns null whenever
   * there is nothing worth saying, so the header stays quiet instead of showing
   * a placeholder. Keep it to a few characters: it shares the header with the
   * title and the quick controls.
   *
   * It receives the *instance's* stored configuration, not just the stores,
   * because a summary that answers a question the card's own settings can
   * re-aim has to be aimed the same way. Print is the case: its percentage
   * follows the chosen remaining-time source, so a summary reading the file
   * position regardless reported a different number in the header than the
   * card showed one row below — and with two Print cards configured
   * differently, no single global reading could be right for both. Modules
   * whose summary asks nothing configurable ignore the argument.
   */
  summary?: (config: Record<string, unknown>) => string | null
  /**
   * Overrides `icon` when the card's icon depends on live state rather than
   * being fixed for the module — Extruder's nozzle glyph swaps to its
   * "heating" variant while the hotend is climbing toward a target, reading
   * a store the same way `summary` above already does. Absent for every
   * other module, which just renders `icon` as-is.
   */
  dynamicIcon?: () => AppIconName
}

export const dashboardModuleRegistry: readonly DashboardModuleDefinition[] = [
  {
    id: 'print',
    titleKey: 'dashboard.modules.print',
    icon: 'print',
    requires: 'klipper',
    component: markRaw(PrintModule),
    hasSettings: true,
    quickSettingsComponent: markRaw(PrintQuickSettings),
    quickSettingsDefaultKeys: printDefaultQuickKeys,
    settingsComponent: markRaw(PrintSettingsPane),
    // Progress is the reason this card gets collapsed and still watched. With
    // nothing running there is no number to watch, and the state already reads
    // from the printer's own status in the application header.
    //
    // Read through this instance's own configuration, so a card pinned to the
    // slicer's estimate reports the slicer's progress collapsed as well as
    // expanded. It used to take `printer.progress` regardless, which is only
    // the "File position" answer — the header and the card then showed two
    // different percentages for one print.
    summary: (config) => {
      const printer = usePrinterStore()
      if (!printer.hasActivePrint) return null
      const fraction = printProgressFraction(config, {
        file: printer.progress,
        slicer: printer.slicerProgress,
        filament: printer.filamentProgress,
      })
      return `${Math.round(fraction * 100)}%`
    },
  },
  {
    id: 'camera',
    titleKey: 'dashboard.modules.camera',
    icon: 'camera',
    requires: 'moonraker',
    component: markRaw(CameraModule),
    // A printer with a chamber camera and a nozzle camera wants them on
    // separate cards as often as it wants them tiled on one: cards can sit in
    // different columns, collapse independently, and carry their own title.
    // Both ways of splitting cameras therefore exist, and this is the half the
    // module contract owns.
    supportsMultiple: true,
    hasSettings: true,
    quickSettingsComponent: markRaw(CameraQuickSettings),
    quickSettingsDefaultKeys: cameraDefaultQuickKeys,
    settingsComponent: markRaw(CameraSettingsPane),
    // Arrangement and columns only mean something with more than one camera on
    // the card, and `CameraCardSettingsFields` hides them below that. Without
    // this the gear opened an empty panel on every single-camera card.
    quickSettingRowVisible: (key, config) => {
      if (key !== 'arrangement' && key !== 'stacking' && key !== 'columns') return true
      const webcams = useWebcamsStore()
      return selectedCameras(cameraCardSettings(config), webcams.cameras).length > 1
    },
    // Only the case where the card has nothing to show. The picture is the
    // whole point of this module, so a collapsed card has nothing to summarize
    // — except the one state that makes expanding it pointless, which is worth
    // saying rather than leaving someone to expand a card and find an empty
    // stage. Read through the instance's own selection, because with two Camera
    // cards one may be configured and the other not.
    summary: (config) => {
      const webcams = useWebcamsStore()
      const cameras = selectedCameras(cameraCardSettings(config), webcams.cameras)
      return cameras.length > 0 ? null : i18n.global.t('dashboard.camera.summaryNone')
    },
  },
  {
    id: 'temperatures',
    titleKey: 'dashboard.modules.temperatures',
    icon: 'temperature',
    requires: 'klipper',
    component: markRaw(TemperaturesModule),
    hasSettings: true,
    quickSettingsComponent: markRaw(TemperaturesQuickSettings),
    quickSettingsDefaultKeys: temperaturesDefaultQuickKeys,
    settingsComponent: markRaw(TemperaturesSettingsPane),
    // The hotend, because it is the reading this card gets collapsed and still
    // watched for, and the one a target is set on most. A machine without an
    // extruder falls back to whatever it can heat, then to whatever it can
    // measure — a chamber-only or bed-only printer still has a number worth
    // keeping in the header. Null only when there is genuinely no reading yet,
    // which is the case a placeholder would misreport as a value.
    summary: () => {
      const telemetry = useTelemetryStore()
      const reading =
        telemetry.readings.extruder ??
        telemetry.sensors.find((sensor) => sensor.isSettable) ??
        telemetry.sensors[0]
      if (!reading || reading.temperature === null) return null
      return `${Math.round(reading.temperature)}${i18n.global.t('dashboard.temperatureUnit')}`
    },
  },
  {
    id: 'movement',
    titleKey: 'dashboard.modules.movement',
    icon: 'move',
    requires: 'klipper',
    component: markRaw(MovementModule),
    hasSettings: true,
    quickSettingsComponent: markRaw(MovementQuickSettings),
    quickSettingsDefaultKeys: movementDefaultQuickKeys,
    settingsComponent: markRaw(MovementSettingsPane),
    // Whether the machine knows where it is, which is the precondition every
    // control on this card shares and the one thing worth reading while it is
    // collapsed. Homed, the answer is the position itself — three coordinates
    // do not fit the header, so Z alone stands for them: it is the axis that
    // changes between jobs and the one whose value someone collapses this card
    // still watching. Explicit "Not homed" rather than null, because silence
    // in this slot reads as a card still loading rather than one correctly
    // reporting a machine that has not been homed yet.
    summary: () => {
      const printer = usePrinterStore()
      const homed = printer.motion.homedAxes.toUpperCase()
      if (!['X', 'Y', 'Z'].every((axis) => homed.includes(axis))) {
        return i18n.global.t('dashboard.movement.notHomed')
      }
      const height = printer.toolheadPosition[2]
      if (height === null) return i18n.global.t('dashboard.movement.notHomed')
      return i18n.global.t('dashboard.movement.summaryHeight', {
        height: new Intl.NumberFormat(i18n.global.locale.value, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(height),
      })
    },
  },
  {
    id: 'controls',
    titleKey: 'dashboard.modules.controls',
    icon: 'controls',
    requires: 'klipper',
    component: markRaw(ControlsModule),
    hasSettings: true,
    quickSettingsComponent: markRaw(ControlsQuickSettings),
    quickSettingsDefaultKeys: controlsDefaultQuickKeys,
    settingsComponent: markRaw(ControlsSettingsPane),
    // The part fan's speed, because it is the reading rendered first on the
    // card and the one every printer with cooling has; falling back to the
    // first controllable fan on a printer with no part fan. No label — a
    // fan's own name has no length limit, and the 12-character header budget
    // does, so this follows Temperatures' bare-reading convention rather
    // than naming which fan. Null with no controllable fans configured, or
    // before the fan's speed has been reported — the case a placeholder
    // would misreport as a value.
    summary: () => {
      const printerConfig = usePrinterConfigStore()
      const telemetry = useTelemetryStore()
      const controllableFans = printerConfig.fans.filter((fan) => fan.kind !== 'monitored')
      const fan =
        controllableFans.find((candidate) => candidate.kind === 'part') ?? controllableFans[0]
      if (!fan) return null
      const speed = telemetry.fans[fan.objectName]?.speed ?? null
      if (speed === null) return null
      return `${Math.round(speed * 100)}${i18n.global.t('dashboard.percentUnit')}`
    },
  },
  {
    id: 'machine',
    titleKey: 'dashboard.modules.machine',
    icon: 'machine',
    requires: 'klipper',
    component: markRaw(MachineModule),
    hasSettings: true,
    quickSettingsComponent: markRaw(MachineQuickSettings),
    quickSettingsDefaultKeys: machineDefaultQuickKeys,
    settingsComponent: markRaw(MachineSettingsPane),
  },
  {
    id: 'macros',
    titleKey: 'dashboard.modules.macros',
    icon: 'function',
    requires: 'klipper',
    component: markRaw(MacrosModule),
    supportsMultiple: true,
    hasSettings: true,
    quickSettingsComponent: markRaw(MacrosQuickSettings),
    quickSettingsDefaultKeys: macrosDefaultQuickKeys,
    settingsComponent: markRaw(MacrosSettingsPane),
  },
  {
    id: 'extruder',
    titleKey: 'dashboard.modules.extruder',
    icon: 'nozzle',
    requires: 'klipper',
    component: markRaw(ExtruderModule),
    hasSettings: true,
    quickSettingsComponent: markRaw(ExtruderQuickSettings),
    quickSettingsDefaultKeys: extruderDefaultQuickKeys,
    settingsComponent: markRaw(ExtruderSettingsPane),
    // The hotend climbing toward a target is worth telling apart from one
    // already there or idle — 2°C rather than exactly the target, so the
    // glyph does not flicker between the two while a heater's own PID hunts
    // around its setpoint.
    dynamicIcon: () => {
      const telemetry = useTelemetryStore()
      const reading = telemetry.readings.extruder
      const isHeating =
        reading !== undefined &&
        reading.target !== null &&
        reading.temperature !== null &&
        reading.temperature < reading.target - 2
      return isHeating ? 'nozzleHeat' : 'nozzle'
    },
    // The extrusion factor, and deliberately not the hotend temperature:
    // Temperatures already collapses to `telemetry.readings.extruder`, and two
    // cards showing one number is worse than one card showing nothing.
    //
    // Never null, unlike every other summary here. Klipper always has a factor
    // and carries it silently from one job into the next, so the state most
    // worth catching from a collapsed card is exactly the one where it is not
    // 100% — and a reading that always exists has no "nothing yet" case a
    // placeholder could misreport.
    summary: () => {
      const printer = usePrinterStore()
      const percent = Math.round(printer.motion.extrusionFactor * 100)
      return `${percent}${i18n.global.t('dashboard.percentUnit')}`
    },
  },
  {
    id: 'spool',
    titleKey: 'dashboard.modules.spool',
    icon: 'spool',
    requires: 'moonraker',
    requiresComponent: 'spoolman',
    component: markRaw(SpoolModule),
    hasSettings: true,
    quickSettingsComponent: markRaw(SpoolQuickSettings),
    quickSettingsDefaultKeys: spoolDefaultQuickKeys,
    settingsComponent: markRaw(SpoolSettingsPane),
    // The remaining weight, because it is the number this card exists to keep
    // in view and the one every spool has regardless of what Spoolman knows
    // about its filament. Null with no active spool, or when Spoolman has not
    // reported enough of the spool's own weight to derive a remaining figure —
    // both genuinely have nothing to show, which a placeholder would misreport
    // as a value.
    summary: () => {
      const spool = useSpoolStore()
      const remaining = spool.activeSpool?.remaining_weight
      if (remaining === null || remaining === undefined) return null
      return `${Math.round(remaining)}${i18n.global.t('dashboard.weightUnit')}`
    },
  },
  {
    id: 'bedMesh',
    titleKey: 'dashboard.modules.bedMesh',
    icon: 'mesh',
    requires: 'klipper',
    component: markRaw(BedMeshModule),
    hasSettings: true,
    quickSettingsComponent: markRaw(BedMeshQuickSettings),
    quickSettingsDefaultKeys: bedMeshDefaultQuickKeys,
    settingsComponent: markRaw(BedMeshSettingsPane),
    // How far the bed strays is the reason this card is on the dashboard at
    // all, and it is the one figure that still means something without the map
    // beside it. Labelled "Range:" rather than bare, since a bare number in the
    // header has no unit or context to say what it is a range of.
    //
    // A printer that has never been probed and one that has a saved mesh it is
    // simply not using right now look identical if both collapse to nothing —
    // the second is running unlevelled after having known better, which is
    // worth a word even collapsed. "Unloaded" and "No data" fit the header; the
    // full warning colour and icon live only in the expanded card, which this
    // slot has no room for. Explicit rather than null for the never-calibrated
    // case too: this module's collapsed line is read as "status of the last
    // calibration," and silence there reads as a card that has not finished
    // loading rather than one correctly reporting it has nothing to show yet.
    summary: () => {
      const bedMesh = useBedMeshStore()
      if (bedMesh.isActive && bedMesh.range !== null) {
        // Formatted through the active locale rather than `toFixed`, which
        // would print an English decimal point into every other language.
        const range = new Intl.NumberFormat(i18n.global.locale.value, {
          minimumFractionDigits: 3,
          maximumFractionDigits: 3,
        }).format(bedMesh.range)
        return i18n.global.t('dashboard.bedMesh.summaryRange', { range })
      }
      if (bedMesh.profiles.length > 0) return i18n.global.t('dashboard.bedMesh.summaryUnloaded')
      return i18n.global.t('dashboard.bedMesh.summaryNone')
    },
  },
  {
    id: 'jobQueue',
    titleKey: 'dashboard.modules.jobQueue',
    icon: 'jobs',
    requires: 'moonraker',
    component: markRaw(JobQueueModule),
  },
  {
    id: 'console',
    titleKey: 'dashboard.modules.console',
    icon: 'console',
    requires: 'klipper',
    component: markRaw(ConsoleModule),
    hasSettings: true,
    quickSettingsComponent: markRaw(ConsoleQuickSettings),
    quickSettingsDefaultKeys: consoleDefaultQuickKeys,
    settingsComponent: markRaw(ConsoleSettingsPane),
  },
  {
    id: 'activity',
    titleKey: 'dashboard.modules.activity',
    icon: 'activity',
    requires: 'moonraker',
    component: markRaw(ActivityModule),
  },
  {
    id: 'maintenance',
    titleKey: 'dashboard.modules.maintenance',
    icon: 'maintenance',
    // server.history.* needs only Moonraker, not a ready Klipper — the
    // printer's lifetime totals exist whether or not the firmware is up.
    requires: 'moonraker',
    component: markRaw(MaintenanceModule),
    // Whether anything is overdue, because that is the one fact worth seeing
    // without expanding the card — a service interval that has quietly run
    // out is the failure this module exists to catch. Null otherwise, rather
    // than a count: "2 overdue" invites reading the number as urgency scaled
    // by how many, when even one overdue interval is the whole story.
    summary: () => {
      const maintenance = useMaintenanceStore()
      return maintenance.hasOverdue ? i18n.global.t('dashboard.maintenance.summaryOverdue') : null
    },
  },
] as const

export const dashboardModulesById = new Map(
  dashboardModuleRegistry.map((module) => [module.id, module]),
)
