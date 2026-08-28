<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppStatusField, { type AppStatusFieldTone } from '@/components/AppStatusField.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import MachineUpdateConsoleDialog from '@/components/MachineUpdateConsoleDialog.vue'
import PageHeading from '@/components/PageHeading.vue'
import UpdateCommitList from '@/components/UpdateCommitList.vue'
import UpdateRecoveryDialog from '@/components/UpdateRecoveryDialog.vue'
import { useActionGuard, type ActionGuardResult } from '@/composables/useActionGuard'
import type {
  MachineServiceStatus,
  MachineUpdateAvailability,
  MachineUpdateItem,
} from '@/stores/machineSystem'
import { updateAvailability, useMachineSystemStore } from '@/stores/machineSystem'
import { useMoonrakerStore } from '@/stores/moonraker'

const { locale, t } = useI18n({ useScope: 'global' })
const moonraker = useMoonrakerStore()
const machine = useMachineSystemStore()
/*
 * `primary` emphasis: installing an update is a commitment rather than a
 * destruction, so it keeps the emphasis it has while the dialog is there and
 * escalates one step when the dialog is gone. One guard for both triggers,
 * because both answer to the same key -- an update installed one at a time and
 * an update-all are the same decision.
 */
const installGuard = useActionGuard({ tier: 'terminal', emphasis: 'primary', key: 'installUpdate' })
/**
 * `danger-quiet`: rolling back is a real regression, but the control sits in a
 * list of otherwise-quiet rows, the same reasoning that keeps the header
 * power menu's `rebootHost`/`shutdownHost` off the louder plain `danger`.
 */
const rollbackGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'rollbackUpdate',
})
/**
 * One guard for every service's Stop, regardless of which one: stopping a
 * systemd unit directly is worth confirming on its own terms, not only while
 * it happens to be the one keeping a print alive -- unlike `restartKlipper`
 * and `firmwareRestart`, this always asks rather than only while a job is
 * loaded, which is why it is its own key rather than joining their group.
 * Starting one back up is corrective, not consequential, so it carries no
 * guard at all.
 */
const stopServiceGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'stopService',
})
/** Milder than Stop -- the service comes back on its own -- so it rests at `quiet` rather than `danger-quiet`. */
const restartServiceGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'quiet',
  key: 'restartService',
})
let pollTimer: ReturnType<typeof setInterval> | undefined
const completeStatsRefreshMs = 5_000

const hostName = computed(() => machine.systemInfo?.cpu_info?.model || t('machine.host'))
const operatingSystem = computed(() => {
  const distribution = machine.systemInfo?.distribution
  return distribution ? `${distribution.name} ${distribution.version}`.trim() : '—'
})
const primaryNetwork = computed(() => {
  const networks = Object.entries(machine.systemInfo?.network ?? {})
  const match = networks.find(([, network]) =>
    network.ip_addresses?.some((address) => address.family === 'ipv4' && address.address),
  )
  if (!match) return null
  const address = match[1].ip_addresses?.find(
    (candidate) => candidate.family === 'ipv4' && candidate.address,
  )?.address
  return { name: match[0], address: address ?? '—', stats: machine.procStats?.network[match[0]] }
})
const decimalFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)
const frequencyFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)
const mcuNumberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
)
/** Joining names with a literal ", " would not survive translation. */
const listFormatter = computed(
  () => new Intl.ListFormat(locale.value, { style: 'long', type: 'conjunction' }),
)

function formatBytes(bytes?: number): string {
  if (!Number.isFinite(bytes)) return '—'
  const value = bytes ?? 0
  if (value < 1024) return `${decimalFormatter.value.format(value)} B`
  if (value < 1024 ** 2) return `${decimalFormatter.value.format(value / 1024)} KB`
  if (value < 1024 ** 3) return `${decimalFormatter.value.format(value / 1024 ** 2)} MB`
  return `${decimalFormatter.value.format(value / 1024 ** 3)} GB`
}

function formatMemory(kilobytes?: number): string {
  return formatBytes(kilobytes == null ? undefined : kilobytes * 1024)
}

const freeMemory = computed(() => {
  const memory = machine.procStats?.system_memory
  return memory ? memory.total - memory.used : null
})

function formatMcuVersion(app: string | null, version: string | null): string {
  const reportedVersion = version ?? t('machine.modules.unknown')
  return app && app !== 'Klipper' ? `${app} ${reportedVersion}` : reportedVersion
}

function formatMcuFrequency(frequency: number | null): string | null {
  if (frequency === null || frequency <= 0) return null
  if (frequency >= 1_000_000_000) {
    return t('machine.modules.frequencyGHz', {
      value: frequencyFormatter.value.format(frequency / 1_000_000_000),
    })
  }
  if (frequency >= 1_000_000) {
    return t('machine.modules.frequencyMHz', {
      value: frequencyFormatter.value.format(frequency / 1_000_000),
    })
  }
  return t('machine.modules.frequencyKHz', {
    value: frequencyFormatter.value.format(frequency / 1_000),
  })
}

function formatCanbusBitrate(bitrate: number | null): string | null {
  if (bitrate === null || bitrate <= 0) return null
  if (bitrate >= 1_000_000) {
    return t('machine.peripherals.canbusBitrateMbps', {
      value: frequencyFormatter.value.format(bitrate / 1_000_000),
    })
  }
  return t('machine.peripherals.canbusBitrateKbps', {
    value: frequencyFormatter.value.format(bitrate / 1_000),
  })
}

/** Spoolman's row has no systemd unit behind it, so it never earns a start/stop control. */
function isSystemdService(name: string): boolean {
  return machine.systemInfo?.available_services.includes(name) ?? false
}

/**
 * A running Moonraker offers no way back from Stop: the request that stops it
 * is answered by the very process it just killed, and nothing short of SSH
 * can start it again, since `machine.services.start` needs a running
 * Moonraker to carry it. Restart is unaffected -- systemd relaunches it as
 * one operation, the same one `restartMoonraker` already uses safely -- so
 * only the toggle hides; the row still offers Restart.
 */
function canToggleService(service: MachineServiceStatus): boolean {
  return !(service.name === 'moonraker' && service.state === 'active')
}

/** `AppStatusField`'s closed tone set, not `MachineServiceState`'s own domain vocabulary. */
const serviceStatusTones: Record<MachineServiceStatus['state'], AppStatusFieldTone> = {
  active: 'positive',
  failed: 'danger',
  inactive: 'offline',
}

function serviceStatusTone(service: MachineServiceStatus): AppStatusFieldTone {
  return serviceStatusTones[service.state]
}

function serviceActionIcon(service: MachineServiceStatus): 'spinner' | 'stop' | 'play' {
  if (machine.isServicePending(service.name)) return 'spinner'
  return service.state === 'active' ? 'stop' : 'play'
}

function serviceActionLabel(service: MachineServiceStatus): string {
  if (machine.isServicePending(service.name)) {
    return service.state === 'active'
      ? t('machine.services.stopping')
      : t('machine.services.starting')
  }
  return service.state === 'active'
    ? t('machine.services.stop', { name: service.name })
    : t('machine.services.start', { name: service.name })
}

/** Stopping is the only half that carries a guard; starting a stopped unit has nothing to ask about. */
/**
 * Stop is guarded; Start is corrective and carries none. One helper rather than
 * the previous pair, because a variant and a binding that disagreed about which
 * service they described was exactly the split `useActionGuard` exists to close.
 */
function serviceActionGuard(service: MachineServiceStatus): ActionGuardResult | undefined {
  return service.state === 'active' ? stopServiceGuard : undefined
}

const pendingServiceStop = ref<string | null>(null)

function requestServiceAction(service: MachineServiceStatus): void {
  if (!moonraker.isConnected || machine.isServicePending(service.name)) return
  if (service.state !== 'active') {
    void machine.startService(service.name)
    return
  }
  if (stopServiceGuard.guarded.value) {
    pendingServiceStop.value = service.name
    return
  }
  void machine.stopService(service.name)
}

function cancelServiceStop(): void {
  pendingServiceStop.value = null
}

function confirmServiceStop(): void {
  const name = pendingServiceStop.value
  pendingServiceStop.value = null
  if (name) void machine.stopService(name)
}

/** Restarting nothing is just starting it, so the separate control only offers what Start does not already cover. */
function canRestartService(service: MachineServiceStatus): boolean {
  return service.state !== 'inactive'
}

function restartActionIcon(service: MachineServiceStatus): 'spinner' | 'refresh' {
  return machine.isServicePending(service.name) ? 'spinner' : 'refresh'
}

function restartActionLabel(service: MachineServiceStatus): string {
  return machine.isServicePending(service.name)
    ? t('machine.services.restarting')
    : t('machine.services.restart', { name: service.name })
}

const pendingServiceRestart = ref<string | null>(null)

function requestServiceRestart(service: MachineServiceStatus): void {
  if (!moonraker.isConnected || machine.isServicePending(service.name)) return
  if (restartServiceGuard.guarded.value) {
    pendingServiceRestart.value = service.name
    return
  }
  void machine.restartService(service.name)
}

function cancelServiceRestart(): void {
  pendingServiceRestart.value = null
}

function confirmServiceRestart(): void {
  const name = pendingServiceRestart.value
  pendingServiceRestart.value = null
  if (name) void machine.restartService(name)
}

function updateVersion(update: MachineUpdateItem): string {
  if (update.configured_type === 'system') {
    return t('machine.updates.packages', { count: update.package_count ?? 0 })
  }
  return update.version || '—'
}

/**
 * What a row's click does, which is not the same for all three states: an
 * up-to-date source has nothing to install so it re-checks, a source needing
 * attention cannot be installed at all so it opens the recovery dialog, and only
 * an `available` source installs.
 */
function rowAction(update: MachineUpdateItem): 'check' | 'install' | 'investigate' {
  const availability = updateAvailability(update)
  if (availability === 'attention') return 'investigate'
  return availability === 'available' ? 'install' : 'check'
}

function rowIsPending(update: MachineUpdateItem): boolean {
  return machine.checkingUpdateId === update.id || machine.runningUpdateId === update.id
}

/** `AppStatusField`'s closed tone set, not `updateAvailability`'s own domain vocabulary. */
const updateStatusTones: Record<MachineUpdateAvailability, AppStatusFieldTone> = {
  current: 'positive',
  available: 'accent',
  attention: 'caution',
}

function updateStatusTone(update: MachineUpdateItem): AppStatusFieldTone {
  return updateStatusTones[updateAvailability(update)]
}

/** The full sentence a screen reader hears, which never depends on hover. */
function rowActionName(update: MachineUpdateItem): string {
  const key = {
    install: 'machine.updates.updateOne',
    check: 'machine.updates.checkOne',
    investigate: 'machine.updates.investigateOne',
  }[rowAction(update)]
  return t(key, { name: update.displayName })
}

/**
 * The action button's own visible label -- the generic verb, not the
 * name-including phrase `rowActionName` carries for assistive technology.
 */
function rowActionLabel(update: MachineUpdateItem): string {
  if (machine.runningUpdateId === update.id) return t('machine.updates.updating')
  if (machine.checkingUpdateId === update.id) return t('machine.updates.checking')
  return {
    install: t('machine.updates.updateNow'),
    check: t('machine.updates.check'),
    investigate: t('machine.updates.investigate'),
  }[rowAction(update)]
}

const pendingUpdate = ref<MachineUpdateItem | null>(null)
const investigating = ref<MachineUpdateItem | null>(null)
const isUpdateAllPending = ref(false)

/*
 * Re-read from the store rather than holding the captured row: a recovery run
 * streams a new status, and the dialog must describe the source as it is now.
 */
const investigatingUpdate = computed(
  () => machine.updates.find((update) => update.id === investigating.value?.id) ?? null,
)
const isConfirmOpen = computed(() => isUpdateAllPending.value || pendingUpdate.value !== null)
const confirmTitle = computed(() =>
  pendingUpdate.value
    ? t('machine.updates.updateOneConfirmTitle', { name: pendingUpdate.value.displayName })
    : t('machine.updates.updateAllConfirmTitle'),
)
/*
 * A confirmation covering a set names every member rather than implying a count.
 * These names go in the description rather than through `ConfirmDialog`'s `items`
 * list: that list is styled for unsaved-work file paths — mono and caution — and
 * a handful of short source names are neither.
 */
const pendingSourceNames = computed(() =>
  machine.updates
    .filter((update) => updateAvailability(update) === 'available')
    .map((update) => update.displayName),
)
const confirmDescription = computed(() =>
  pendingUpdate.value
    ? t('machine.updates.updateOneConfirmDescription', {
        name: pendingUpdate.value.displayName,
      })
    : t('machine.updates.updateAllConfirmDescription', {
        names: listFormatter.value.format(pendingSourceNames.value),
      }),
)

/*
 * A single-source confirmation shows what the update actually contains.
 * `commits_behind` is the changelog for a git/web source; a `system` source
 * has no commits at all, so its own package list stands in instead — never
 * both, since a source is only ever one of the two shapes.
 */
const pendingUpdateCommits = computed(() => pendingUpdate.value?.commits_behind ?? [])
const pendingUpdatePackages = computed(() =>
  pendingUpdateCommits.value.length ? [] : (pendingUpdate.value?.package_list ?? []),
)
const hasChangelogDetails = computed(
  () => pendingUpdateCommits.value.length > 0 || pendingUpdatePackages.value.length > 0,
)

const updatesDisabled = computed(() => !moonraker.isConnected || machine.isUpdateManagerBusy)

/**
 * Installing restarts Klipper or Moonraker, so it is confirmed. Checking reads
 * the repositories and changes nothing, so it runs straight away. A source needing
 * attention opens the recovery dialog, because there is nothing to install until
 * its repository is resolved.
 */
function runUpdate(target: MachineUpdateItem | null): void {
  if (target) void machine.startUpdate(target.id)
  else void machine.startAllUpdates()
}

function activateRow(update: MachineUpdateItem): void {
  if (updatesDisabled.value) return
  const action = rowAction(update)
  if (action === 'install') {
    if (installGuard.guarded.value) pendingUpdate.value = update
    else runUpdate(update)
  } else if (action === 'investigate') investigating.value = update
  else void machine.checkForUpdates(update.id)
}

function requestUpdateAll(): void {
  if (updatesDisabled.value) return
  if (installGuard.guarded.value) isUpdateAllPending.value = true
  else runUpdate(null)
}

function cancelConfirm(): void {
  pendingUpdate.value = null
  isUpdateAllPending.value = false
}

function confirmUpdate(): void {
  const target = pendingUpdate.value
  cancelConfirm()
  runUpdate(target)
}

/*
 * The dialog closes as the recovery starts: its progress belongs in the update
 * console popout below, which opens itself the moment `isUpdating` goes true.
 */
function confirmRecovery(id: string): void {
  investigating.value = null
  void machine.recoverUpdate(id)
}

/**
 * Only a `git_repo`/`web` source has a previous version Moonraker can revert
 * to, and a source already needing attention is resolved through Investigate
 * instead -- a dirty or corrupt repository is no more rollback-able than it is
 * upgradeable.
 */
function canRollbackUpdate(update: MachineUpdateItem): boolean {
  return update.configured_type !== 'system' && updateAvailability(update) !== 'attention'
}

/*
 * Moonraker's `anomalies` are unexpected-but-tolerated conditions -- an
 * unofficial remote or branch is the common case -- that never raise
 * `attention` and so are never covered by Investigate. `attention` rows are
 * excluded here because their own recovery dialog already lists every
 * reported condition, anomalies included; showing this toggle there too would
 * be the same information behind two controls on the same row.
 */
function hasAnomalyToggle(update: MachineUpdateItem): boolean {
  return (update.anomalies?.length ?? 0) > 0 && updateAvailability(update) !== 'attention'
}

const expandedAnomalyIds = ref(new Set<string>())

function isAnomaliesExpanded(id: string): boolean {
  return expandedAnomalyIds.value.has(id)
}

function toggleAnomalies(id: string): void {
  const next = new Set(expandedAnomalyIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedAnomalyIds.value = next
}

const pendingRollback = ref<MachineUpdateItem | null>(null)

function requestRollback(update: MachineUpdateItem): void {
  if (updatesDisabled.value) return
  if (rollbackGuard.guarded.value) pendingRollback.value = update
  else void machine.rollbackUpdate(update.id)
}

function cancelRollback(): void {
  pendingRollback.value = null
}

/*
 * The dialog closes as the rollback starts: its progress belongs in the same
 * update console popout every other update action opens, via the shared
 * `isUpdating` watcher below.
 */
function confirmRollback(): void {
  const target = pendingRollback.value
  pendingRollback.value = null
  if (target) void machine.rollbackUpdate(target.id)
}

const isConsoleOpen = ref(false)
/**
 * Set once a run that completed `alabaster` — Alabaster's own served bundle
 * — ends, and consumed only after the console the reader is still watching
 * is dismissed; see `closeConsole` below. Read from `machine.completedUpdateIds`
 * rather than `!updateFailed && !updateInterrupted`: an **Update all** run
 * that updates Alabaster before failing on Moonraker last (Moonraker
 * restarting drops the socket, which `startAllUpdates` orders it after
 * everything else specifically to isolate) must still reload, since
 * Alabaster's own install did not fail. Klipper needs no equivalent flag —
 * Moonraker already restarts it as part of finishing its own update, the
 * same fact `updateOneConfirmDescription` already tells the reader before
 * the run starts, so prompting again afterward would only invite a second,
 * redundant restart.
 */
const alabasterReloadDue = ref(false)

/*
 * Opens itself the moment a run starts, the same continuation-of-the-user's-
 * own-gesture behaviour as the confirmation dialog it follows — the user just
 * confirmed Update now (or Investigate's own reset/re-clone), so this is not
 * an unprompted popup. It stays open across the whole run and does not force
 * itself back open if the reader dismisses it early; `openConsole` in the
 * Updates panel header reopens it for as long as there is a transcript to see.
 */
watch(
  () => machine.isUpdating,
  (isUpdating, wasUpdating) => {
    if (isUpdating && !wasUpdating) isConsoleOpen.value = true
    if (!isUpdating && wasUpdating && machine.completedUpdateIds.has('alabaster')) {
      alabasterReloadDue.value = true
    }
  },
)

/**
 * The console dialog closing is what triggers the reload, never the run
 * finishing on its own: reloading while the reader is still watching the
 * transcript would discard it out from under them.
 */
function closeConsole(): void {
  isConsoleOpen.value = false
  if (!alabasterReloadDue.value) return
  alabasterReloadDue.value = false
  window.location.reload()
}

watch(
  () => moonraker.isConnected,
  (connected) => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
    if (!connected) return
    void machine.load()
    pollTimer = setInterval(() => void machine.refreshProcStats(), completeStatsRefreshMs)
  },
  { immediate: true },
)

onMounted(() => machine.start())

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  machine.stop()
})
</script>

<template>
  <section class="standard-page machine-system-page">
    <PageHeading :title="t('machine.title')" />

    <AvailabilityRegion requires="moonraker" class="min-h-0">
      <div v-if="machine.error" class="machine-system-error selectable" role="alert">
        {{ t('machine.error') }}
      </div>

      <div class="machine-system-grid">
        <div class="machine-system-column">
          <section class="machine-status-panel" aria-labelledby="machine-system-title">
            <header class="machine-panel-heading">
              <AppIcon name="machine" class="size-5 text-action" aria-hidden="true" />
              <h2 id="machine-system-title">{{ t('machine.system.title') }}</h2>
            </header>

            <div class="machine-host-row selectable">
              <div class="min-w-0">
                <p class="machine-host-name">{{ hostName }}</p>
                <p>{{ operatingSystem }}</p>
                <p v-if="machine.systemInfo?.cpu_info?.cpu_desc">
                  {{ machine.systemInfo.cpu_info.cpu_desc }}
                </p>
                <p>
                  {{
                    t('machine.system.uptime', {
                      value: Math.floor(machine.systemUptime / 3600),
                    })
                  }}
                </p>
                <p v-if="machine.procStats?.cpu_temp != null">
                  {{
                    t('machine.system.temperature', {
                      value: Math.round(machine.procStats.cpu_temp),
                    })
                  }}
                </p>
                <p v-if="primaryNetwork">
                  {{ primaryNetwork.name }} · {{ primaryNetwork.address }} ·
                  {{
                    t('machine.system.bandwidth', {
                      value: formatBytes(primaryNetwork.stats?.bandwidth),
                    })
                  }}
                </p>
                <p v-if="freeMemory !== null">
                  {{
                    t('machine.system.freeMemory', {
                      value: formatMemory(freeMemory),
                    })
                  }}
                </p>
              </div>

              <div class="machine-meters">
                <div class="machine-meter" :style="{ '--meter-value': `${machine.cpuUsage}%` }">
                  <div class="machine-meter__heading">
                    <AppIcon name="processor" aria-hidden="true" />
                    <span>{{ t('machine.system.cpu') }}</span>
                  </div>
                  <p class="machine-meter__value">
                    <strong>{{ machine.cpuUsage }}</strong
                    ><span>%</span>
                  </p>
                  <div class="machine-meter__track" aria-hidden="true">
                    <span class="machine-meter__fill"></span>
                  </div>
                </div>
                <div class="machine-meter" :style="{ '--meter-value': `${machine.memoryUsage}%` }">
                  <div class="machine-meter__heading">
                    <AppIcon name="ram" aria-hidden="true" />
                    <span>{{ t('machine.system.memory') }}</span>
                  </div>
                  <p class="machine-meter__value">
                    <strong>{{ machine.memoryUsage }}</strong
                    ><span>%</span>
                  </p>
                  <div class="machine-meter__track" aria-hidden="true">
                    <span class="machine-meter__fill"></span>
                  </div>
                </div>
              </div>
            </div>

            <section v-if="machine.mcuModules.length" class="machine-module-list">
              <article
                v-for="module in machine.mcuModules"
                :key="module.id"
                class="machine-module-row"
              >
                <div class="min-w-0">
                  <h4>
                    {{ module.name }}
                    <span v-if="module.chip" class="machine-module-chip">({{ module.chip }})</span>
                  </h4>
                  <p>
                    {{
                      t('machine.modules.version', {
                        version: formatMcuVersion(module.app, module.version),
                      })
                    }}
                  </p>
                  <p v-if="module.load !== null || module.frequency !== null">
                    <span v-if="module.load !== null">
                      {{
                        t('machine.modules.load', {
                          value: mcuNumberFormatter.format(module.load),
                        })
                      }}
                    </span>
                    <span v-if="formatMcuFrequency(module.frequency)">
                      {{ formatMcuFrequency(module.frequency) }}
                    </span>
                  </p>
                </div>
                <AppStatusField
                  v-if="module.isDisconnected"
                  class="machine-module-disconnected"
                  :text="t('machine.modules.disconnected')"
                  tone="caution"
                />
              </article>
            </section>

            <section v-if="machine.services.length" class="machine-service-list">
              <h3>{{ t('machine.services.title') }}</h3>
              <article
                v-for="service in machine.services"
                :key="service.name"
                class="machine-service-row"
              >
                <span class="machine-service-name">{{ service.name }}</span>
                <span class="machine-service-actions">
                  <a
                    v-if="service.url"
                    class="button button--quiet button--icon"
                    :href="service.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    :aria-label="t('machine.services.open', { name: service.name })"
                  >
                    <AppIcon name="globe" class="size-5" aria-hidden="true" />
                  </a>
                  <AppButton
                    v-if="isSystemdService(service.name) && canToggleService(service)"
                    variant="quiet"
                    :guard="serviceActionGuard(service)"
                    :icon="serviceActionIcon(service)"
                    :disabled="!moonraker.isConnected || machine.isServicePending(service.name)"
                    :pending="machine.isServicePending(service.name)"
                    :aria-label="serviceActionLabel(service)"
                    :title="serviceActionLabel(service)"
                    @click="requestServiceAction(service)"
                  />
                  <AppButton
                    v-if="isSystemdService(service.name) && canRestartService(service)"
                    :guard="restartServiceGuard"
                    :icon="restartActionIcon(service)"
                    :disabled="!moonraker.isConnected || machine.isServicePending(service.name)"
                    :pending="machine.isServicePending(service.name)"
                    :aria-label="restartActionLabel(service)"
                    :title="restartActionLabel(service)"
                    @click="requestServiceRestart(service)"
                  />
                  <AppStatusField
                    class="machine-service-status"
                    :text="t(`machine.services.status.${service.state}`)"
                    :tone="serviceStatusTone(service)"
                  />
                </span>
              </article>
            </section>
          </section>

          <!--
            Read once with the rest of `load()` and again only on an explicit
            request — there is no notification for a device being plugged or
            unplugged, so a stale list would otherwise never correct itself.
            Hidden entirely rather than shown empty: a printer whose Moonraker
            never implemented this (or is not running on Linux) simply never
            populates either list, the same absence `machine.services`/
            `machine.mcuModules` already treat as "nothing to show" above.
          -->
          <section
            v-if="
              machine.serialDevices.length ||
              machine.usbDevices.length ||
              machine.canbusInterfaces.length
            "
            class="machine-status-panel"
            aria-labelledby="machine-peripherals-title"
          >
            <header class="machine-panel-heading">
              <AppIcon name="usb" class="size-5 text-action" aria-hidden="true" />
              <h2 id="machine-peripherals-title">{{ t('machine.peripherals.title') }}</h2>
              <div class="machine-panel-heading__actions">
                <!--
                  Icon-only with the same refresh/spinner swap as the Repository
                  updates panel's own Check for updates control -- outlier 12's
                  third instance, since this is the same kind of action: a plain
                  re-read with nothing to confirm, named well enough by the icon
                  that a text label added nothing beside it.
                -->
                <AppButton
                  variant="quiet"
                  icon-only
                  :pending="machine.isLoadingPeripherals"
                  :icon="machine.isLoadingPeripherals ? 'spinner' : 'refresh'"
                  :disabled="!moonraker.isConnected"
                  :aria-label="
                    machine.isLoadingPeripherals
                      ? t('machine.peripherals.refreshing')
                      : t('machine.peripherals.refresh')
                  "
                  :title="
                    machine.isLoadingPeripherals
                      ? t('machine.peripherals.refreshing')
                      : t('machine.peripherals.refresh')
                  "
                  @click="machine.refreshPeripherals()"
                />
              </div>
            </header>

            <section v-if="machine.serialDevices.length" class="machine-module-list">
              <h3>{{ t('machine.peripherals.serialTitle') }}</h3>
              <article
                v-for="device in machine.serialDevices"
                :key="device.device_path"
                class="machine-module-row machine-peripheral-row selectable"
              >
                <div class="min-w-0">
                  <h4>{{ device.path_by_id ?? device.device_path }}</h4>
                  <p>
                    {{ device.device_path }} ·
                    {{ t(`machine.peripherals.serialType.${device.device_type}`) }}
                  </p>
                </div>
              </article>
            </section>

            <section v-if="machine.usbDevices.length" class="machine-module-list">
              <h3>{{ t('machine.peripherals.usbTitle') }}</h3>
              <article
                v-for="device in machine.usbDevices"
                :key="`${device.bus_num}:${device.device_num}`"
                class="machine-module-row machine-peripheral-row selectable"
              >
                <div class="min-w-0">
                  <h4>{{ device.description || `${device.vendor_id}:${device.product_id}` }}</h4>
                  <p>{{ device.usb_location }}</p>
                </div>
              </article>
            </section>

            <!--
              `machine.peripherals.canbus` reports only UUIDs neither Klipper
              nor Katapult has claimed yet, so most rows here are the
              interface itself confirming "nothing pending" — that is still
              worth showing, since it confirms the CAN adapter is seen at all.
            -->
            <section v-if="machine.canbusInterfaces.length" class="machine-module-list">
              <h3>{{ t('machine.peripherals.canbusTitle') }}</h3>
              <template v-for="iface in machine.canbusInterfaces" :key="iface.interface">
                <article
                  v-for="node in iface.uuids"
                  :key="node.uuid"
                  class="machine-module-row machine-peripheral-row selectable"
                >
                  <div class="min-w-0">
                    <h4>{{ node.uuid }}</h4>
                    <p>
                      {{
                        [iface.interface, node.application, formatCanbusBitrate(iface.bitrate)]
                          .filter(Boolean)
                          .join(' · ')
                      }}
                    </p>
                  </div>
                </article>
                <article
                  v-if="iface.uuids.length === 0"
                  class="machine-module-row machine-peripheral-row"
                >
                  <div class="min-w-0">
                    <h4>{{ iface.interface }}</h4>
                    <p>
                      {{
                        [
                          formatCanbusBitrate(iface.bitrate),
                          iface.driver,
                          t('machine.peripherals.canbusNone'),
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      }}
                    </p>
                  </div>
                </article>
              </template>
            </section>
          </section>
        </div>

        <!--
          ADR 0004 asks the region affected by an async operation to expose
          `aria-busy`, which is also what tells assistive technology why every
          control inside it is disabled.
        -->
        <section
          class="machine-status-panel"
          aria-labelledby="machine-updates-title"
          :aria-busy="machine.isUpdateManagerBusy || undefined"
        >
          <header class="machine-panel-heading">
            <AppIcon name="refresh" class="size-5 text-action" aria-hidden="true" />
            <h2 id="machine-updates-title">{{ t('machine.updates.title') }}</h2>
            <div class="machine-panel-heading__actions">
              <AppButton
                v-if="machine.outputLines.length > 0 || machine.isUpdating"
                variant="quiet"
                size="sm"
                :pending="machine.isUpdating"
                icon="console"
                :label="t('machine.output.openConsole')"
                @click="isConsoleOpen = true"
              />
              <AppButton
                variant="quiet"
                icon-only
                :pending="machine.checkingUpdateId === ''"
                :icon="machine.checkingUpdateId === '' ? 'spinner' : 'refresh'"
                :disabled="updatesDisabled"
                :aria-label="
                  machine.checkingUpdateId === ''
                    ? t('machine.updates.checking')
                    : t('machine.updates.check')
                "
                :title="
                  machine.checkingUpdateId === ''
                    ? t('machine.updates.checking')
                    : t('machine.updates.check')
                "
                @click="machine.checkForUpdates()"
              />
              <AppButton
                v-if="machine.hasAvailableUpdates"
                size="sm"
                :guard="installGuard"
                :pending="machine.isUpdatingAll"
                icon="download"
                :label="t('machine.updates.updateAll')"
                :disabled="updatesDisabled"
                @click="requestUpdateAll"
              />
            </div>
          </header>

          <p v-if="machine.checkFailed" class="machine-panel-notice" role="alert">
            {{ t('machine.updates.checkFailed') }}
          </p>
          <p v-if="machine.updateFailed" class="machine-panel-notice" role="alert">
            {{ t('machine.updates.updateFailed') }}
          </p>
          <!--
            A Moonraker update restarts Moonraker, so losing the socket mid-update
            is the expected path rather than a failure. It still requires an
            explicit retry, so it is surfaced — just not as "could not be started".
          -->
          <p v-if="machine.updateInterrupted" class="machine-panel-notice" role="alert">
            {{ t('machine.updates.updateInterrupted') }}
          </p>

          <div v-if="machine.updates.length" class="machine-update-list">
            <template v-for="update in machine.updates" :key="update.id">
              <div class="machine-update-row-group">
                <!--
                  Plain content, not a control: a source's name, version, and
                  status are facts to read, not a click target whose meaning
                  changes with state. It leads the group, since it is the one
                  thing every row always has, unlike the controls beside it.
                -->
                <span class="machine-update-row__detail">
                  <span class="machine-update-row__name">{{ update.displayName }}</span>
                  <span class="machine-update-row__version">{{ updateVersion(update) }}</span>
                  <span
                    v-if="updateAvailability(update) === 'attention'"
                    class="machine-update-warning"
                  >
                    {{ t('machine.updates.dirty') }}
                  </span>
                </span>
                <!--
                  A disclosure toggle for `anomalies` Moonraker reports outside the
                  attention state -- see `hasAnomalyToggle`'s reasoning. It follows
                  button-system.md's shared toggle model (`aria-pressed`) rather than
                  a fourth row state, the same reasoning that already keeps rollback
                  beside the row instead of inside its click.
                -->
                <AppButton
                  v-if="hasAnomalyToggle(update)"
                  variant="quiet"
                  icon-only
                  icon="info"
                  class="machine-update-row__anomalies-toggle"
                  :aria-pressed="isAnomaliesExpanded(update.id)"
                  :aria-controls="`machine-update-anomalies-${update.id}`"
                  :aria-label="
                    t(
                      isAnomaliesExpanded(update.id)
                        ? 'machine.updates.anomaliesHide'
                        : 'machine.updates.anomaliesShow',
                      { name: update.displayName },
                    )
                  "
                  :title="t('machine.updates.anomalies')"
                  @click="toggleAnomalies(update.id)"
                />
                <!--
                  A secondary control beside the row rather than a fourth state
                  folded into the action button: rollback has nothing to do with
                  whether a source is behind. Icon-only, per button-system.md's
                  bounded exception for icon-only confirming controls --
                  `aria-haspopup` is its only carrier, same as the Console card
                  header's clear and the job queue row's remove.
                -->
                <AppButton
                  v-if="canRollbackUpdate(update)"
                  class="machine-update-row__rollback"
                  :guard="rollbackGuard"
                  icon="undo"
                  :disabled="updatesDisabled"
                  :aria-label="t('machine.updates.rollbackOne', { name: update.displayName })"
                  :title="t('machine.updates.rollback')"
                  @click="requestRollback(update)"
                />
                <!--
                  A dirty/invalid/corrupt source cannot be installed at all, so its
                  action is Investigate rather than Update now or Check -- and
                  unlike those two, it opens a whole recovery dialog rather than
                  starting or reading, which earns it a distinct icon beside the
                  status instead of the trailing labeled/icon action button below.
                -->
                <AppButton
                  v-if="rowAction(update) === 'investigate'"
                  variant="quiet"
                  icon-only
                  icon="warningDiamond"
                  class="machine-update-row__investigate"
                  :disabled="updatesDisabled"
                  :aria-label="rowActionName(update)"
                  :title="rowActionName(update)"
                  @click="activateRow(update)"
                />
                <AppStatusField
                  class="machine-update-status"
                  :text="t(`machine.updates.status.${updateAvailability(update)}`)"
                  :tone="updateStatusTone(update)"
                />
                <!--
                  The row's own action, trailing the status it acts on: an install
                  carries `installGuard`'s escalation and dialog exactly like Update
                  all, since a single-source install answers to the same
                  confirmation key. A check asks nothing, so it wears no guard, and
                  collapses to an icon in the same `button--quiet button--icon` shape
                  as the anomalies toggle, rollback, and Investigate beside it --
                  the same refresh/spinner swap the panel header's own
                  Check-for-updates control already uses, at that control's own `md`
                  size rather than a bespoke dense one, since "check" names nothing
                  an icon cannot already say next to a status that already reads
                  "Up to date". Investigate never reaches this button at all; see
                  the icon beside the status above.
                -->
                <!--
                  Two controls, not one with a ternary in every attribute. Check
                  and Install differ in size, variant, guard, and whether they
                  carry a label at all, so the single element was branching on
                  `rowAction` five times and could land a combination neither
                  branch intended — an `install` that kept the icon-only shape,
                  say. Splitting them makes each one legible on its own.
                -->
                <AppButton
                  v-if="rowAction(update) === 'check'"
                  class="machine-update-row__action"
                  variant="quiet"
                  :icon="machine.checkingUpdateId === update.id ? 'spinner' : 'refresh'"
                  :disabled="updatesDisabled"
                  :pending="rowIsPending(update)"
                  :aria-label="rowActionName(update)"
                  :title="rowActionName(update)"
                  @click="activateRow(update)"
                />
                <AppButton
                  v-else-if="rowAction(update) === 'install'"
                  class="machine-update-row__action"
                  size="sm"
                  :guard="installGuard"
                  :label="rowActionLabel(update)"
                  :disabled="updatesDisabled"
                  :pending="rowIsPending(update)"
                  :aria-label="rowActionName(update)"
                  :title="rowActionName(update)"
                  @click="activateRow(update)"
                />
              </div>
              <ul
                v-if="hasAnomalyToggle(update) && isAnomaliesExpanded(update.id)"
                :id="`machine-update-anomalies-${update.id}`"
                class="machine-update-anomalies selectable"
              >
                <li v-for="message in update.anomalies" :key="message">
                  <AppIcon name="info" class="size-4" aria-hidden="true" />
                  <span>{{ message }}</span>
                </li>
              </ul>
            </template>
          </div>
          <p v-else class="machine-panel-empty">{{ t('machine.updates.empty') }}</p>
        </section>
      </div>
    </AvailabilityRegion>

    <ConfirmDialog
      :open="isConfirmOpen"
      :title="confirmTitle"
      :description="confirmDescription"
      :confirm-label="t('machine.updates.updateConfirm')"
      :wide="hasChangelogDetails"
      @confirm="confirmUpdate"
      @cancel="cancelConfirm"
    >
      <template v-if="pendingUpdateCommits.length" #details>
        <p class="update-recovery-section-note">
          {{ t('machine.updates.changelogCommits', { count: pendingUpdateCommits.length }) }}
        </p>
        <UpdateCommitList :commits="pendingUpdateCommits" />
      </template>
      <template v-else-if="pendingUpdatePackages.length" #details>
        <p class="update-recovery-section-note">{{ t('machine.updates.changelogPackages') }}</p>
        <ul class="update-recovery-messages selectable">
          <li v-for="name in pendingUpdatePackages" :key="name">{{ name }}</li>
        </ul>
      </template>
    </ConfirmDialog>

    <UpdateRecoveryDialog
      :update="investigatingUpdate"
      :busy="machine.isUpdateManagerBusy"
      @reset="confirmRecovery"
      @close="investigating = null"
    />

    <ConfirmDialog
      :open="pendingRollback !== null"
      :title="
        t('machine.updates.rollbackConfirmTitle', { name: pendingRollback?.displayName ?? '' })
      "
      :description="t('machine.updates.rollbackConfirmDescription')"
      :confirm-label="t('machine.updates.rollback')"
      tone="danger"
      @confirm="confirmRollback"
      @cancel="cancelRollback"
    />

    <ConfirmDialog
      :open="pendingServiceStop !== null"
      :title="t('machine.services.stopConfirmTitle', { name: pendingServiceStop ?? '' })"
      :description="
        t('machine.services.stopConfirmDescription', { name: pendingServiceStop ?? '' })
      "
      :confirm-label="t('machine.services.stop', { name: pendingServiceStop ?? '' })"
      tone="danger"
      @confirm="confirmServiceStop"
      @cancel="cancelServiceStop"
    />

    <ConfirmDialog
      :open="pendingServiceRestart !== null"
      :title="t('machine.services.restartConfirmTitle', { name: pendingServiceRestart ?? '' })"
      :description="
        t('machine.services.restartConfirmDescription', { name: pendingServiceRestart ?? '' })
      "
      :confirm-label="t('machine.services.restart', { name: pendingServiceRestart ?? '' })"
      @confirm="confirmServiceRestart"
      @cancel="cancelServiceRestart"
    />

    <MachineUpdateConsoleDialog
      :open="isConsoleOpen"
      :lines="machine.outputLines"
      :running="machine.isUpdating"
      :failed="machine.updateFailed || machine.updateInterrupted"
      @close="closeConsole"
      @clear="machine.clearUpdateOutput()"
    />
  </section>
</template>
