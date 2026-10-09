<script setup lang="ts">
import { ref, watch } from 'vue'

import MachineUpdateConsoleDialog from '@/components/MachineUpdateConsoleDialog.vue'
import { useMachineSystemStore } from '@/stores/machineSystem'

/*
 * Mounted in `App.vue` rather than on the Machine page: Moonraker broadcasts an
 * update's output to every client, so a run started from another browser opens
 * the console in this one wherever it happens to be, as other Klipper
 * interfaces do.
 */
const machine = useMachineSystemStore()

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
 * Opens itself the moment a run starts. For a run this tab started it is the
 * continuation of the user's own confirmation; for one started elsewhere it is
 * the printer's update manager becoming busy, which every update control here
 * now reflects. It stays open across the whole run and does not force itself
 * back open if the reader dismisses it early; the Machine page's Updates panel
 * reopens it for as long as there is a transcript to see.
 */
watch(
  () => machine.isUpdating,
  (isUpdating, wasUpdating) => {
    if (isUpdating && !wasUpdating) machine.isConsoleOpen = true
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
  machine.isConsoleOpen = false
  if (!alabasterReloadDue.value) return
  alabasterReloadDue.value = false
  window.location.reload()
}
</script>

<template>
  <MachineUpdateConsoleDialog
    :open="machine.isConsoleOpen"
    :lines="machine.outputLines"
    :running="machine.isUpdating"
    :failed="machine.updateFailed || machine.updateInterrupted"
    @close="closeConsole"
    @clear="machine.clearUpdateOutput()"
  />
</template>
