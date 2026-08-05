<script setup lang="ts">
/**
 * The one place the product says why the printer is not running.
 *
 * The header's status text names the state — "Klipper could not start" — and
 * that is all a reader used to get: every module dimmed at once, with the
 * actual reason (a bad `[stepper_x]` section, an MCU that would not answer, a
 * thermistor reading past `max_temp`) reachable only by opening `klippy.log`
 * in another interface. A failed boot is the one printer state that will not
 * clear on its own and cannot be acted on without being read first, so it
 * earns a surface that quotes Klipper verbatim and puts the two restarts that
 * recover it next to that text.
 *
 * Mounted once in the shell rather than per page, and never per module: it has
 * to be there on whichever destination the reader happens to be on, and the
 * alternative — a copy on the dashboard, another on Machine — is the repeated
 * status panel ADR 0002 rules out.
 *
 * It collapses to its heading because fixing a config error means editing the
 * config: the reader goes to Configuration with this open, and a fault message
 * ten lines long would otherwise sit on top of the editor for the whole repair.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import DisclosureReveal from '@/components/DisclosureReveal.vue'
import { useAvailability } from '@/composables/useAvailability'
import { useAvailabilityStore } from '@/stores/availability'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { usePrinterStore } from '@/stores/printer'

const { t } = useI18n({ useScope: 'global' })
const router = useRouter()
const availabilityStore = useAvailabilityStore()
const { availability, messageKey } = useAvailability('klipper')
const { availability: moonrakerAvailability } = useAvailability('moonraker')
const printer = usePrinterStore()
const machineFiles = useMachineFilesStore()

/*
 * `error` is the availability phase for the two Klipper states that are
 * terminal — `error` and `shutdown`. Everything else Klipper does between
 * connections is a transition that resolves itself, which is the header's job
 * to report and not this one's: a notice that appeared during every ordinary
 * restart would be ignored by the time it meant something.
 */
const isFaulted = computed(() => availability.value.phase === 'error')
const message = computed(() => availabilityStore.klipperMessage.trim())
const isExpanded = ref(true)

// A different fault is a different thing to read, so it arrives open even if
// the reader had collapsed the previous one.
watch(message, () => {
  isExpanded.value = true
})

const isRestartBlocked = computed(() => !moonrakerAvailability.value.isAvailable)

function openLogs(): void {
  void machineFiles.setRoot('logs')
  void router.push({ name: 'configuration' })
}
</script>

<template>
  <section v-if="isFaulted" class="printer-fault" role="alert">
    <div class="printer-fault__heading">
      <AppIcon name="warning" class="size-5 shrink-0 text-danger-text" aria-hidden="true" />
      <h2 class="printer-fault__title text-card-title">{{ t(messageKey) }}</h2>
      <button
        type="button"
        class="button button--quiet button--sm button--icon shrink-0"
        :aria-expanded="isExpanded"
        aria-controls="printer-fault-detail"
        :title="isExpanded ? t('printerFault.collapse') : t('printerFault.expand')"
        :aria-label="isExpanded ? t('printerFault.collapse') : t('printerFault.expand')"
        @click="isExpanded = !isExpanded"
      >
        <AppIcon :name="isExpanded ? 'collapse' : 'expand'" class="size-4" aria-hidden="true" />
      </button>
    </div>

    <DisclosureReveal :open="isExpanded">
      <div id="printer-fault-detail" class="printer-fault__detail">
        <!--
          Reserved rather than sized to what it holds: the message is a second
          round trip behind the state that prompted it, so a box that grew when
          it landed would push the recovery buttons out from under a cursor
          already on its way to them.
        -->
        <p class="printer-fault__message selectable">{{ message }}</p>

        <div class="printer-fault__actions">
          <!--
            Primary, and deliberately the firmware restart rather than the
            gentler one: it recovers both faults this notice reports, and it is
            the command Klipper's own shutdown text tells the reader to use.
          -->
          <button
            type="button"
            class="button button--primary button--sm"
            :disabled="isRestartBlocked || printer.pendingCommands.firmwareRestart"
            :data-pending="printer.pendingCommands.firmwareRestart ? 'true' : undefined"
            @click="printer.firmwareRestart()"
          >
            <AppIcon name="refresh" class="size-4" aria-hidden="true" />
            {{ t('header.power.firmwareRestart') }}
          </button>
          <button
            type="button"
            class="button button--sm button--on-soft"
            :disabled="isRestartBlocked || printer.pendingCommands.restartKlipper"
            :data-pending="printer.pendingCommands.restartKlipper ? 'true' : undefined"
            @click="printer.restartKlipper()"
          >
            <AppIcon name="refresh" class="size-4" aria-hidden="true" />
            {{ t('header.power.restartKlipper') }}
          </button>
          <!--
            The logs are already a browsable root in Configuration, so this
            selects that root and goes there rather than adding a second way to
            reach the same files. A fault message names the cause; the log is
            where the lines leading up to it are.
          -->
          <button type="button" class="button button--sm button--on-soft" @click="openLogs">
            <AppIcon name="activity" class="size-4" aria-hidden="true" />
            {{ t('printerFault.openLogs') }}
          </button>
        </div>
      </div>
    </DisclosureReveal>
  </section>
</template>
