<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { useAvailabilityStore } from '@/stores/availability'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useMachineSystemStore, type MachineServiceStatus } from '@/stores/machineSystem'
import { useMoonrakerStore } from '@/stores/moonraker'

const { t } = useI18n({ useScope: 'global' })
const machine = useMachineSystemStore()
const moonraker = useMoonrakerStore()
const availability = useAvailabilityStore()
const confirmations = useConfirmationsStore()

/**
 * Stopping a systemd unit directly is worth confirming on its own terms, not
 * only while it happens to be the one keeping a print alive -- unlike
 * `restartKlipper` and `firmwareRestart`, this always asks rather than only
 * while a job is loaded, which is why it is its own key rather than joining
 * their group. Starting one back up is corrective, not consequential, so it
 * carries no guard at all.
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
/** The same decision as `restartServiceGuard`, worn by the visible Restart on a failed row. */
const restartFailedGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'neutral',
  key: 'restartService',
})

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
 * only Stop is withheld; the row still offers Restart.
 */
function canStopService(service: MachineServiceStatus): boolean {
  return (
    isSystemdService(service.name) && service.state === 'active' && service.name !== 'moonraker'
  )
}

/** A running unit's actions live in its menu; a failed or stopped one shows the action it needs. */
function hasMenu(service: MachineServiceStatus): boolean {
  return isSystemdService(service.name) && service.state === 'active'
}

function isBusy(service: MachineServiceStatus): boolean {
  return !moonraker.isConnected || machine.isServicePending(service.name)
}

/** What the line under a service's name can say that the name does not already. */
function serviceDetail(service: MachineServiceStatus): string | null {
  if (service.name === 'klipper') return t(`machine.services.klippy.${availability.klipperState}`)
  if (service.name === 'moonraker') {
    const count = machine.procStats?.websocket_connections
    return typeof count === 'number' ? t('machine.services.clients', { count }) : null
  }
  if (service.url) {
    try {
      return new URL(service.url).host
    } catch {
      return service.url
    }
  }
  return null
}

const summary = computed(() => {
  const counts = { active: 0, failed: 0, inactive: 0 }
  for (const service of machine.services) counts[service.state] += 1
  if (counts.failed === 0 && counts.inactive === 0) {
    return t('machine.services.summaryAllRunning', { count: counts.active })
  }
  return [
    counts.failed > 0 ? t('machine.services.summaryFailed', { count: counts.failed }) : null,
    counts.inactive > 0 ? t('machine.services.summaryStopped', { count: counts.inactive }) : null,
    counts.active > 0 ? t('machine.services.summaryRunning', { count: counts.active }) : null,
  ]
    .filter((part): part is string => part !== null)
    .reduce((first, second) => t('machine.updates.detailJoin', { first, second }))
})

const pendingServiceStop = ref<string | null>(null)
const pendingServiceRestart = ref<string | null>(null)

function startService(service: MachineServiceStatus): void {
  if (isBusy(service)) return
  void machine.startService(service.name)
}

function requestStop(service: MachineServiceStatus, guarded: boolean): void {
  if (isBusy(service)) return
  if (guarded) pendingServiceStop.value = service.name
  else void machine.stopService(service.name)
}

function requestRestart(service: MachineServiceStatus, guarded: boolean): void {
  if (isBusy(service)) return
  if (guarded) pendingServiceRestart.value = service.name
  else void machine.restartService(service.name)
}

function confirmStop(): void {
  const name = pendingServiceStop.value
  pendingServiceStop.value = null
  if (name) void machine.stopService(name)
}

function confirmRestart(): void {
  const name = pendingServiceRestart.value
  pendingServiceRestart.value = null
  if (name) void machine.restartService(name)
}
</script>

<template>
  <section class="machine-status-panel machine-list-panel" aria-labelledby="machine-services-title">
    <header class="machine-panel-heading">
      <AppIcon name="gears" class="size-5 text-action" aria-hidden="true" />
      <h2 id="machine-services-title">{{ t('machine.services.title') }}</h2>
    </header>
    <p class="machine-panel-summary" aria-live="polite">{{ summary }}</p>
    <div class="machine-list">
      <div
        v-for="service in machine.services"
        :key="service.name"
        class="machine-row machine-service-row"
        :data-state="service.state === 'failed' ? 'attention' : 'current'"
      >
        <AppIcon
          v-if="service.state === 'failed'"
          name="warning"
          class="machine-row__state size-5"
          aria-hidden="true"
        />
        <span class="machine-row__detail">
          <span class="machine-row__name">{{ service.name }}</span>
          <span v-if="serviceDetail(service)" class="machine-row__meta">
            {{ serviceDetail(service) }}
          </span>
        </span>
        <a
          v-if="service.url"
          class="button button--quiet button--sm button--icon machine-row__aside"
          :href="service.url"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="t('machine.services.open', { name: service.name })"
          :title="t('machine.services.open', { name: service.name })"
        >
          <AppIcon name="globe" class="size-4 shrink-0" aria-hidden="true" />
        </a>
        <AppButton
          v-if="service.state === 'failed' && isSystemdService(service.name)"
          class="machine-row__action"
          size="sm"
          :guard="restartFailedGuard"
          :label="t('machine.services.restartShort')"
          :disabled="isBusy(service)"
          :pending="machine.isServicePending(service.name)"
          :aria-label="t('machine.services.restart', { name: service.name })"
          :title="t('machine.services.restart', { name: service.name })"
          @click="requestRestart(service, restartFailedGuard.guarded.value)"
        />
        <AppButton
          v-else-if="service.state === 'inactive' && isSystemdService(service.name)"
          class="machine-row__action"
          size="sm"
          :label="t('machine.services.startShort')"
          :disabled="isBusy(service)"
          :pending="machine.isServicePending(service.name)"
          :aria-label="t('machine.services.start', { name: service.name })"
          :title="t('machine.services.start', { name: service.name })"
          @click="startService(service)"
        />
        <span
          v-else
          class="machine-row__status"
          :data-tone="service.state === 'active' ? undefined : 'caution'"
        >
          <AppIcon
            v-if="service.state === 'active'"
            name="check"
            class="size-4"
            aria-hidden="true"
          />
          {{ t(`machine.services.status.${service.state}`) }}
        </span>
        <HeaderMenu
          v-if="hasMenu(service)"
          class="machine-row__menu"
          :label="t('machine.services.moreActions', { name: service.name })"
          align="end"
          trigger-size="sm"
          trigger-icon-only
        >
          <template #trigger>
            <AppIcon name="more" class="size-5" aria-hidden="true" />
          </template>
          <template #default="{ close }">
            <AppButton
              size="sm"
              start
              block
              icon="refresh"
              class="machine-service-row__restart"
              :guard="restartServiceGuard"
              :label="t('machine.services.restartShort')"
              :disabled="isBusy(service)"
              :pending="machine.isServicePending(service.name)"
              @click="
                () => {
                  requestRestart(service, restartServiceGuard.guarded.value)
                  close()
                }
              "
            />
            <AppButton
              v-if="canStopService(service)"
              size="sm"
              start
              block
              icon="stop"
              class="machine-service-row__stop"
              :guard="stopServiceGuard"
              :label="t('machine.services.stopShort')"
              :disabled="isBusy(service)"
              @click="
                () => {
                  requestStop(service, stopServiceGuard.guarded.value)
                  close()
                }
              "
            />
          </template>
        </HeaderMenu>
      </div>
    </div>

    <ConfirmDialog
      :open="pendingServiceStop !== null"
      :title="t('machine.services.stopConfirmTitle', { name: pendingServiceStop ?? '' })"
      :description="
        t('machine.services.stopConfirmDescription', { name: pendingServiceStop ?? '' })
      "
      :confirm-label="t('machine.services.stop', { name: pendingServiceStop ?? '' })"
      tone="danger"
      show-skip-option
      @confirm="confirmStop"
      @cancel="pendingServiceStop = null"
      @skip="confirmations.setSkip('stopService', true)"
    />

    <ConfirmDialog
      :open="pendingServiceRestart !== null"
      :title="t('machine.services.restartConfirmTitle', { name: pendingServiceRestart ?? '' })"
      :description="
        t('machine.services.restartConfirmDescription', { name: pendingServiceRestart ?? '' })
      "
      :confirm-label="t('machine.services.restart', { name: pendingServiceRestart ?? '' })"
      show-skip-option
      @confirm="confirmRestart"
      @cancel="pendingServiceRestart = null"
      @skip="confirmations.setSkip('restartService', true)"
    />
  </section>
</template>
