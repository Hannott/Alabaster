<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import type { MoonrakerSerialDevice } from '@/services/moonraker/types'
import { useMachineSystemStore, type MachineMcuModule } from '@/stores/machineSystem'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useToastsStore } from '@/stores/toasts'
import { copyToClipboard } from '@/utils/clipboard'

const { locale, t } = useI18n({ useScope: 'global' })
const machine = useMachineSystemStore()
const moonraker = useMoonrakerStore()
const printerConfig = usePrinterConfigStore()
const toasts = useToastsStore()

const loadFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
)
const frequencyFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)

function joinDetail(parts: (string | null | undefined)[]): string {
  const present = parts.filter((part): part is string => Boolean(part))
  if (present.length === 0) return ''
  return present.reduce((first, second) => t('machine.updates.detailJoin', { first, second }))
}

/** A disconnected controller is the one row here that needs a reader, so it leads. */
const controllers = computed(() =>
  [...machine.mcuModules].sort(
    (a, b) => Number(Boolean(b.isDisconnected)) - Number(Boolean(a.isDisconnected)),
  ),
)

const disconnectedCount = computed(
  () => machine.mcuModules.filter((module) => module.isDisconnected).length,
)

/** The build's git hash adds nothing a reader compares by eye; the full string stays in the title. */
function shortVersion(version: string): string {
  return version.replace(/-g[0-9a-f]{6,}(-dirty)?$/, '')
}

function controllerDetail(module: MachineMcuModule): string {
  if (module.isDisconnected && !module.version) return t('machine.peripherals.versionUnknown')
  const version = module.version
    ? shortVersion(
        module.app && module.app !== 'Klipper' ? `${module.app} ${module.version}` : module.version,
      )
    : t('machine.peripherals.versionUnknown')
  return joinDetail([
    module.chip,
    version,
    module.load !== null
      ? t('machine.peripherals.load', { value: loadFormatter.value.format(module.load) })
      : null,
  ])
}

/**
 * Which `[mcu]` section is configured against each serial path, read from the
 * running config: the question a reader opening this list is usually trying
 * to answer is "which of these is my board?".
 */
const mcuBySerialPath = computed(() => {
  const owners = new Map<string, string>()
  for (const [name, values] of Object.entries(printerConfig.settings)) {
    if (name !== 'mcu' && !name.startsWith('mcu ')) continue
    const serial = (values as Record<string, unknown> | null)?.serial
    if (typeof serial === 'string') owners.set(serial, name)
  }
  return owners
})

function serialPath(device: MoonrakerSerialDevice): string {
  return device.path_by_id ?? device.device_path
}

/**
 * `usb-Klipper_stm32f446xx_180042000651343437343531-if00` names the board as
 * its firmware reported it, followed by a serial number and an interface;
 * the first two are what a reader recognises. A path that is not shaped like
 * that falls back to the kernel's own device name.
 */
function serialName(device: MoonrakerSerialDevice): string {
  const id = device.path_by_id?.split('/').pop()
  const match = id?.match(/^usb-(.+?)(?:_[0-9A-Fa-f]{8,})?-if\d+$/)
  return match?.[1]?.replace(/_/g, ' ') ?? device.device_name
}

function serialDetail(device: MoonrakerSerialDevice): string {
  const owner = [
    mcuBySerialPath.value.get(device.path_by_id ?? ''),
    mcuBySerialPath.value.get(device.device_path),
  ].find(Boolean)
  return joinDetail([
    device.device_path,
    device.device_type === 'usb' ? null : t(`machine.peripherals.serialType.${device.device_type}`),
    owner ? t('machine.peripherals.usedBy', { name: owner }) : null,
  ])
}

const copiedPath = ref<string | null>(null)
let copiedTimeout: ReturnType<typeof setTimeout> | undefined

async function copyPath(device: MoonrakerSerialDevice): Promise<void> {
  const path = serialPath(device)
  if (!(await copyToClipboard(path))) {
    toasts.push(t('machine.peripherals.copyFailed'))
    return
  }
  copiedPath.value = path
  clearTimeout(copiedTimeout)
  copiedTimeout = setTimeout(() => (copiedPath.value = null), 1500)
}

onBeforeUnmount(() => clearTimeout(copiedTimeout))

/* A hub only carries other devices; the board a reader is looking for is never one. */
const usbDevices = computed(() => machine.usbDevices.filter((device) => device.class !== 'Hub'))
const usbHubs = computed(() => machine.usbDevices.filter((device) => device.class === 'Hub'))
const showHubs = ref(false)

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

const summary = computed(() =>
  joinDetail([
    machine.mcuModules.length
      ? t('machine.peripherals.summaryControllers', { count: machine.mcuModules.length })
      : null,
    disconnectedCount.value
      ? t('machine.peripherals.summaryDisconnected', { count: disconnectedCount.value })
      : null,
    machine.serialDevices.length
      ? t('machine.peripherals.summarySerial', { count: machine.serialDevices.length })
      : null,
    machine.usbDevices.length
      ? t('machine.peripherals.summaryUsb', { count: machine.usbDevices.length })
      : null,
  ]),
)
</script>

<template>
  <!--
    Serial, USB, and CAN are read once with the rest of `load()` and again only
    on an explicit request -- there is no notification for a device being
    plugged or unplugged, so a stale list would otherwise never correct itself.
  -->
  <section class="machine-status-panel machine-list-panel" aria-labelledby="machine-hardware-title">
    <header class="machine-panel-heading">
      <AppIcon name="usb" class="size-5 text-action" aria-hidden="true" />
      <h2 id="machine-hardware-title">{{ t('machine.peripherals.title') }}</h2>
      <div class="machine-panel-heading__actions">
        <AppButton
          size="sm"
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
    <p v-if="summary" class="machine-panel-summary" aria-live="polite">{{ summary }}</p>
    <div class="machine-list selectable">
      <template v-if="controllers.length">
        <p class="machine-list__label">{{ t('machine.peripherals.controllersTitle') }}</p>
        <div
          v-for="module in controllers"
          :key="module.id"
          class="machine-row machine-controller-row"
          :data-state="module.isDisconnected ? 'attention' : 'current'"
        >
          <AppIcon
            v-if="module.isDisconnected"
            name="warning"
            class="machine-row__state size-5"
            aria-hidden="true"
          />
          <span class="machine-row__detail" :title="module.version ?? undefined">
            <span class="machine-row__name machine-row__name--identifier">{{ module.name }}</span>
            <span class="machine-row__meta">{{ controllerDetail(module) }}</span>
          </span>
          <span
            class="machine-row__status"
            :data-tone="module.isDisconnected ? 'caution' : undefined"
          >
            <AppIcon v-if="!module.isDisconnected" name="check" class="size-4" aria-hidden="true" />
            {{
              module.isDisconnected
                ? t('machine.peripherals.disconnected')
                : t('machine.peripherals.connected')
            }}
          </span>
        </div>
      </template>

      <template v-if="machine.serialDevices.length">
        <p class="machine-list__label">{{ t('machine.peripherals.serialTitle') }}</p>
        <div
          v-for="device in machine.serialDevices"
          :key="device.device_path"
          class="machine-row machine-serial-row"
          data-state="current"
        >
          <span class="machine-row__detail" :title="serialPath(device)">
            <span class="machine-row__name">{{ serialName(device) }}</span>
            <span class="machine-row__meta">{{ serialDetail(device) }}</span>
          </span>
          <AppButton
            class="machine-row__action"
            size="sm"
            :icon="copiedPath === serialPath(device) ? 'check' : 'duplicate'"
            :label="
              copiedPath === serialPath(device)
                ? t('machine.peripherals.copied')
                : t('machine.peripherals.copyPath')
            "
            :aria-label="t('machine.peripherals.copyPathOne', { name: serialName(device) })"
            :title="serialPath(device)"
            @click="copyPath(device)"
          />
        </div>
      </template>

      <template v-if="machine.usbDevices.length">
        <p class="machine-list__label">{{ t('machine.peripherals.usbTitle') }}</p>
        <div
          v-for="device in showHubs ? [...usbDevices, ...usbHubs] : usbDevices"
          :key="`${device.bus_num}:${device.device_num}`"
          class="machine-row machine-usb-row"
          data-state="current"
        >
          <span class="machine-row__detail">
            <span class="machine-row__name">{{
              device.description || `${device.vendor_id}:${device.product_id}`
            }}</span>
            <span class="machine-row__meta">{{
              t('machine.peripherals.usbLocation', {
                bus: device.bus_num,
                device: device.device_num,
              })
            }}</span>
          </span>
        </div>
        <div v-if="usbHubs.length" class="machine-list__fold">
          <AppButton
            variant="quiet"
            size="sm"
            block
            :aria-expanded="showHubs"
            :label="
              showHubs
                ? t('machine.peripherals.hideHubs')
                : t('machine.peripherals.showHubs', { count: usbHubs.length })
            "
            @click="showHubs = !showHubs"
          />
        </div>
      </template>

      <!--
        `machine.peripherals.canbus` reports only UUIDs neither Klipper nor
        Katapult has claimed yet, so most rows here are the interface itself
        confirming "nothing pending" -- still worth showing, since it confirms
        the CAN adapter is seen at all.
      -->
      <template v-if="machine.canbusInterfaces.length">
        <p class="machine-list__label">{{ t('machine.peripherals.canbusTitle') }}</p>
        <template v-for="iface in machine.canbusInterfaces" :key="iface.interface">
          <div
            v-for="node in iface.uuids"
            :key="node.uuid"
            class="machine-row machine-canbus-row"
            data-state="current"
          >
            <span class="machine-row__detail">
              <span class="machine-row__name machine-row__name--identifier">{{ node.uuid }}</span>
              <span class="machine-row__meta">{{
                joinDetail([iface.interface, node.application, formatCanbusBitrate(iface.bitrate)])
              }}</span>
            </span>
          </div>
          <div
            v-if="iface.uuids.length === 0"
            class="machine-row machine-canbus-row"
            data-state="current"
          >
            <span class="machine-row__detail">
              <span class="machine-row__name machine-row__name--identifier">{{
                iface.interface
              }}</span>
              <span class="machine-row__meta">{{
                joinDetail([
                  formatCanbusBitrate(iface.bitrate),
                  iface.driver,
                  t('machine.peripherals.canbusNone'),
                ])
              }}</span>
            </span>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>
