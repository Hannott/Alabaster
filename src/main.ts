import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from '@/App.vue'
import { initializeLocale, i18n } from '@/i18n'
import { router } from '@/router'
import { useAnnouncementsStore } from '@/stores/announcements'
import { useAuthStore } from '@/stores/auth'
import { useBedMeshStore } from '@/stores/bedMesh'
import { useBedScrewsStore } from '@/stores/bedScrews'
import { useConsoleStore } from '@/stores/console'
import { useDevicePowerStore } from '@/stores/devicePower'
import { useExcludeObjectStore } from '@/stores/excludeObject'
import { useHistoryStore } from '@/stores/history'
import { useJobQueueStore } from '@/stores/jobQueue'
import { useMacrosStore } from '@/stores/macros'
import { useManualProbeStore } from '@/stores/manualProbe'
import { useMaintenanceStore } from '@/stores/maintenance'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useRunoutSensorsStore } from '@/stores/runoutSensors'
import { useSensorsStore } from '@/stores/sensors'
import { useServerWarningsStore } from '@/stores/serverWarnings'
import { useSettingsSyncStore } from '@/stores/settingsSync'
import { useSpoolStore } from '@/stores/spool'
import { useTelemetryStore } from '@/stores/telemetry'
import { useWebcamsStore } from '@/stores/webcams'
import '@/styles/main.css'

await initializeLocale()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia).use(i18n).use(router)
useMoonrakerStore(pinia).start()
useTelemetryStore(pinia).start()
usePrinterStore(pinia).start()
useConsoleStore(pinia).start()
useWebcamsStore(pinia).start()
usePrinterConfigStore(pinia).start()
useMacrosStore(pinia).start()
useJobQueueStore(pinia).start()
useBedMeshStore(pinia).start()
useSpoolStore(pinia).start()
// Feeds the collapsed Sensors card's own count, so it stays live regardless
// of whether that card happens to be mounted.
useSensorsStore(pinia).start()
useExcludeObjectStore(pinia).start()
// A manual probe can be started from anywhere — the console, a macro button,
// the printer's own screen — so the object that reports one is watched from
// startup rather than by whichever surface happens to be mounted.
useManualProbeStore(pinia).start()
// The same for a bed-screw round: `BED_SCREWS_ADJUST` is its own Klipper helper
// with its own status object, so watching the probe never sees one.
useBedScrewsStore(pinia).start()
// A runout can trip while the user is looking at any other page, so this
// watches the sensor objects from startup rather than only while Calibration
// happens to be open.
useRunoutSensorsStore(pinia).start()
useDevicePowerStore(pinia).start()
useAnnouncementsStore(pinia).start()
// The muted-warnings list is scoped per printer; this reloads it on a switch
// rather than only while the notifications menu happens to be open.
useServerWarningsStore(pinia).start()
useAuthStore(pinia).start()
// Lifetime totals feed the Maintenance module's overdue check regardless of
// whether the History page has ever been opened, so both start here rather
// than only while that page is mounted.
useHistoryStore(pinia).start()
useMaintenanceStore(pinia).start()
// Settings/layout sync needs to notice a reconnect and apply a newer synced
// profile regardless of whether Settings has ever been opened.
useSettingsSyncStore(pinia).start()
app.mount('#app')
