import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { sensorLabel } from '@/components/dashboard/modules/temperatureSensors'
import type { ProcedureContext, ProcedureHeater } from '@/features/calibration/procedures'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useConsoleStore } from '@/stores/console'
import { useMacrosStore } from '@/stores/macros'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useRunoutSensorsStore } from '@/stores/runoutSensors'
import { useShakeTuneStore } from '@/stores/shakeTune'
import { useTelemetryStore } from '@/stores/telemetry'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * What the procedure registry may ask about the printer, gathered from the
 * stores in one place so `features/calibration/procedures.ts` stays free of
 * them and can be tested with a plain object.
 */
export function useProcedureContext(): ComputedRef<ProcedureContext> {
  const { t } = useI18n({ useScope: 'global' })
  const bedMesh = useBedMeshStore()
  const gcodeConsole = useConsoleStore()
  const macros = useMacrosStore()
  const printer = usePrinterStore()
  const printerConfig = usePrinterConfigStore()
  const runoutSensors = useRunoutSensorsStore()
  const shakeTune = useShakeTuneStore()
  const telemetry = useTelemetryStore()

  const commands = computed(
    () => new Set(gcodeConsole.gcodeHelp.map((entry) => entry.command.toUpperCase())),
  )

  const heaters = computed<ProcedureHeater[]>(() =>
    telemetry.sensors.flatMap((sensor) => {
      if (!sensor.isSettable) return []
      const kind = printerConfig.controlKindFor(sensor.objectName)
      if (kind !== 'pid' && kind !== 'mpc') return []
      return [{ objectName: sensor.objectName, label: sensorLabel(sensor, t), kind }]
    }),
  )

  return computed<ProcedureContext>(() => {
    const kinematics = printerConfig.section('printer')?.kinematics
    return {
      hasSection: (name) => printerConfig.hasSection(name),
      sections: Object.keys(printerConfig.settings),
      hasCommand: (command) => commands.value.has(command.toUpperCase()),
      hasMacro: (name) => macros.hasMacro(name),
      settings: (section) => {
        const value = printerConfig.section(section)
        return isRecord(value) ? value : null
      },
      kinematics: typeof kinematics === 'string' ? kinematics : null,
      hasProbe: printerConfig.hasProbe,
      heaters: heaters.value,
      hasRunoutSensors: runoutSensors.hasSensors,
      livePressureAdvance: printer.extruder.pressureAdvance,
      liveSmoothTime: printer.extruder.smoothTime,
      pendingItems: () => printer.saveConfigPendingItems,
      mesh: () =>
        bedMesh.profileName === ''
          ? null
          : {
              profile: bedMesh.profileName,
              range: bedMesh.range,
              points: bedMesh.rowCount * bedMesh.columnCount,
              temperature: bedMesh.activeProbeTemperature,
            },
      newestGraph: (category) => shakeTune.resultsByCategory[category][0]?.name ?? null,
    }
  })
}
