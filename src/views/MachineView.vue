<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import MachineUpdateConsoleDialog from '@/components/MachineUpdateConsoleDialog.vue'
import PageHeading from '@/components/PageHeading.vue'
import UpdateCommitList from '@/components/UpdateCommitList.vue'
import UpdateRecoveryDialog from '@/components/UpdateRecoveryDialog.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import type { MachineUpdateItem } from '@/stores/machineSystem'
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
 * The label the status chip reveals on hover and focus. It is `aria-hidden`,
 * because `rowActionName` already carries the action to assistive technology.
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

const isConsoleOpen = ref(false)

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
  },
)

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
                <span v-if="module.isDisconnected" class="machine-module-disconnected">
                  {{ t('machine.modules.disconnected') }}
                </span>
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
                    class="button button--quiet button--xs button--icon"
                    :href="service.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    :aria-label="t('machine.services.open', { name: service.name })"
                  >
                    <AppIcon name="globe" class="size-4" aria-hidden="true" />
                  </a>
                  <span class="machine-service-status" :data-state="service.state">
                    {{ t(`machine.services.status.${service.state}`) }}
                  </span>
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
                <button
                  type="button"
                  class="button button--quiet button--sm"
                  :disabled="!moonraker.isConnected"
                  :data-pending="machine.isLoadingPeripherals ? 'true' : undefined"
                  @click="machine.refreshPeripherals()"
                >
                  <AppIcon name="refresh" class="size-4" aria-hidden="true" />
                  {{ t('machine.peripherals.refresh') }}
                </button>
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
              <button
                v-if="machine.outputLines.length > 0 || machine.isUpdating"
                type="button"
                class="button button--quiet button--sm"
                :data-pending="machine.isUpdating ? 'true' : undefined"
                @click="isConsoleOpen = true"
              >
                <AppIcon name="console" class="size-4" aria-hidden="true" />
                {{ t('machine.output.openConsole') }}
              </button>
              <button
                type="button"
                class="button button--quiet button--icon"
                :disabled="updatesDisabled"
                :data-pending="machine.checkingUpdateId === '' ? 'true' : undefined"
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
              >
                <AppIcon
                  :name="machine.checkingUpdateId === '' ? 'spinner' : 'refresh'"
                  class="size-5"
                  aria-hidden="true"
                />
              </button>
              <button
                v-if="machine.hasAvailableUpdates"
                type="button"
                class="button button--sm"
                :class="installGuard.variant.value"
                v-bind="installGuard.bind.value"
                :disabled="updatesDisabled"
                :data-pending="machine.isUpdatingAll ? 'true' : undefined"
                @click="requestUpdateAll"
              >
                <AppIcon name="download" class="size-4" aria-hidden="true" />
                {{ t('machine.updates.updateAll') }}
              </button>
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
            <button
              v-for="update in machine.updates"
              :key="update.id"
              type="button"
              class="button button--quiet button--start button--block machine-update-row"
              :disabled="updatesDisabled"
              :data-pending="rowIsPending(update) ? 'true' : undefined"
              :title="rowActionName(update)"
              @click="activateRow(update)"
            >
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
                Both labels occupy one grid cell, so the chip is already as wide as
                the wider of the two and the hover swap is a crossfade rather than
                a reflow of the row.
              -->
              <span class="machine-update-status" :data-state="updateAvailability(update)">
                <span class="machine-update-status__label">
                  {{ t(`machine.updates.status.${updateAvailability(update)}`) }}
                </span>
                <span class="machine-update-status__action" aria-hidden="true">
                  {{ rowActionLabel(update) }}
                </span>
              </span>
              <!--
                The chip's action label is a hover affordance, so the action is
                named here instead. Leaving the row's own text in the accessible
                name is why this is not an `aria-label`.
              -->
              <span class="sr-only">{{ rowActionName(update) }}</span>
            </button>
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

    <MachineUpdateConsoleDialog
      :open="isConsoleOpen"
      :lines="machine.outputLines"
      :running="machine.isUpdating"
      @close="isConsoleOpen = false"
      @clear="machine.clearUpdateOutput()"
    />
  </section>
</template>
