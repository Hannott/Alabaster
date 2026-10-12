<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import { useMachineSystemStore } from '@/stores/machineSystem'

const { locale, t } = useI18n({ useScope: 'global' })
const machine = useMachineSystemStore()

const decimalFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)
const sinceFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
)

function joinDetail(parts: (string | null | undefined)[]): string {
  const present = parts.filter((part): part is string => Boolean(part))
  if (present.length === 0) return ''
  return present.reduce((first, second) => t('machine.updates.detailJoin', { first, second }))
}

function formatRate(bytes: number): { value: string; unit: string } {
  const steps = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bytes
  let step = 0
  while (value >= 1024 && step < steps.length - 1) {
    value /= 1024
    step += 1
  }
  return { value: decimalFormatter.value.format(value), unit: steps[step] ?? 'B/s' }
}

const hostName = computed(() => machine.systemInfo?.cpu_info?.model || t('machine.host'))

const hostMeta = computed(() => {
  const info = machine.systemInfo
  const distribution = info?.distribution
  const capacity = info?.sd_info?.capacity
  return joinDetail([
    // Debian's own `name` already carries its version ("Debian GNU/Linux 13 (trixie)").
    distribution
      ? distribution.name.includes(distribution.version)
        ? distribution.name
        : `${distribution.name} ${distribution.version}`.trim()
      : null,
    info?.cpu_info?.processor,
    capacity ? t('machine.system.sdCard', { capacity }) : null,
  ])
})

const cores = computed(() => machine.systemInfo?.cpu_info?.cpu_count ?? null)

const memory = computed(() => {
  const value = machine.procStats?.system_memory
  if (!value?.total) return null
  // `system_memory` is in kilobytes; one shared unit keeps "0.6 of 3.7 GB" comparable.
  return t('machine.system.memoryUsed', {
    used: decimalFormatter.value.format(value.used / 1024 ** 2),
    total: decimalFormatter.value.format(value.total / 1024 ** 2),
  })
})

const uptime = computed(() => {
  const seconds = machine.systemUptime
  return { days: Math.floor(seconds / 86_400), hours: Math.floor((seconds % 86_400) / 3_600) }
})

const bootedAt = computed(() =>
  machine.systemUptime > 0
    ? sinceFormatter.value.format(new Date(machine.clockNow - machine.systemUptime * 1000))
    : null,
)

const primaryNetwork = computed(() => {
  const networks = Object.entries(machine.systemInfo?.network ?? {})
  const match = networks.find(([, network]) =>
    network.ip_addresses?.some((address) => address.family === 'ipv4' && address.address),
  )
  if (!match) return null
  const address = match[1].ip_addresses?.find(
    (candidate) => candidate.family === 'ipv4' && candidate.address,
  )?.address
  const bandwidth = machine.procStats?.network[match[0]]?.bandwidth ?? 0
  return {
    detail: joinDetail([match[0], address]),
    ...formatRate(Number.isFinite(bandwidth) ? bandwidth : 0),
  }
})

/*
 * The Raspberry Pi firmware's throttle bits, as `vcgencmd get_throttled`
 * reports them: the low nibble is what is happening now, bits 16-19 what has
 * happened since boot. Under-voltage is the one a reader can act on (a better
 * power supply), so it is named; any other current bit means the CPU is being
 * slowed down. A host that is not a Pi reports no throttle state at all, and
 * the cell is left out rather than claiming the power is fine.
 */
const power = computed(() => {
  const state = machine.procStats?.throttled_state
  if (!state) return null
  const bits = state.bits
  if (bits & 0x1) {
    return {
      value: t('machine.system.powerLow'),
      detail: t('machine.system.powerLowDetail'),
      tone: 'caution',
    }
  }
  if (bits & 0xe) {
    return {
      value: t('machine.system.powerThrottled'),
      detail: t('machine.system.powerThrottledDetail'),
      tone: 'caution',
    }
  }
  if (bits & 0x10000) {
    return {
      value: t('machine.system.powerOk'),
      detail: t('machine.system.powerPastDetail'),
      tone: 'neutral',
    }
  }
  return {
    value: t('machine.system.powerOk'),
    detail: t('machine.system.powerOkDetail'),
    tone: 'positive',
  }
})
</script>

<template>
  <section
    class="machine-status-panel machine-host selectable"
    :aria-label="t('machine.system.title')"
  >
    <div class="machine-host__layout">
      <div class="machine-host__identity">
        <AppIcon name="machine" aria-hidden="true" />
        <div class="min-w-0">
          <h2 class="machine-host__name">{{ hostName }}</h2>
          <p v-if="hostMeta" class="machine-host__meta">{{ hostMeta }}</p>
        </div>
      </div>
      <dl class="machine-host__stats">
        <div class="machine-stat">
          <dt><AppIcon name="processor" aria-hidden="true" />{{ t('machine.system.cpu') }}</dt>
          <dd class="machine-stat__value">
            <strong>{{ machine.cpuUsage }}</strong
            ><span>%</span>
          </dd>
          <dd
            class="machine-meter__track"
            :style="{ '--meter-value': `${machine.cpuUsage}%` }"
            aria-hidden="true"
          >
            <span class="machine-meter__fill"></span>
          </dd>
          <dd v-if="cores" class="machine-stat__detail">
            {{ t('machine.system.cores', { count: cores }) }}
          </dd>
        </div>
        <div class="machine-stat">
          <dt><AppIcon name="ram" aria-hidden="true" />{{ t('machine.system.memory') }}</dt>
          <dd class="machine-stat__value">
            <strong>{{ machine.memoryUsage }}</strong
            ><span>%</span>
          </dd>
          <dd
            class="machine-meter__track"
            :style="{ '--meter-value': `${machine.memoryUsage}%` }"
            aria-hidden="true"
          >
            <span class="machine-meter__fill"></span>
          </dd>
          <dd v-if="memory" class="machine-stat__detail">{{ memory }}</dd>
        </div>
        <div v-if="machine.procStats?.cpu_temp != null" class="machine-stat">
          <dt>
            <AppIcon name="thermometerHalf" aria-hidden="true" />{{
              t('machine.system.temperature')
            }}
          </dt>
          <dd class="machine-stat__value">
            <strong>{{ Math.round(machine.procStats.cpu_temp) }}</strong
            ><span>°C</span>
          </dd>
          <dd class="machine-stat__detail">{{ t('machine.system.temperatureSource') }}</dd>
        </div>
        <div class="machine-stat">
          <dt><AppIcon name="history" aria-hidden="true" />{{ t('machine.system.uptime') }}</dt>
          <dd class="machine-stat__value">
            <template v-if="uptime.days > 0">
              <strong>{{ uptime.days }}</strong
              ><span>{{ t('machine.system.uptimeDays') }}</span>
            </template>
            <strong>{{ uptime.hours }}</strong
            ><span>{{ t('machine.system.uptimeHours') }}</span>
          </dd>
          <dd v-if="bootedAt" class="machine-stat__detail">
            {{ t('machine.system.uptimeSince', { time: bootedAt }) }}
          </dd>
        </div>
        <div v-if="primaryNetwork" class="machine-stat">
          <dt><AppIcon name="lan" aria-hidden="true" />{{ t('machine.system.network') }}</dt>
          <dd class="machine-stat__value">
            <strong>{{ primaryNetwork.value }}</strong
            ><span>{{ primaryNetwork.unit }}</span>
          </dd>
          <dd class="machine-stat__detail">{{ primaryNetwork.detail }}</dd>
        </div>
        <div v-if="power" class="machine-stat" :data-tone="power.tone">
          <dt><AppIcon name="bolt" aria-hidden="true" />{{ t('machine.system.power') }}</dt>
          <dd class="machine-stat__value">
            <strong>{{ power.value }}</strong>
          </dd>
          <dd class="machine-stat__detail">{{ power.detail }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
