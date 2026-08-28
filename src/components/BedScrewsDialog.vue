<!--
  The prompt `BED_SCREWS_ADJUST` puts on screen — dialog-system.md's Shape 6,
  the live procedure dialog, and its second instance after `ManualProbeDialog`.

  Klipper's `bed_screws` helper moves the nozzle to one screw at a time and then
  stops the machine until someone says that screw is done. It is a *different*
  helper from the manual probe, with its own status object and its own three
  commands, so the probe prompt never appears for it: before this dialog the
  procedure could be started from the card and then only finished by typing
  `ACCEPT` into the console, once per screw. See `stores/bedScrews.ts`.

  Two rules shape everything below, the same two the probe prompt follows. **The
  procedure is machine state, not dialog state** — closing this cannot accept or
  abort anything, so Escape and the close control put the prompt aside and the
  header's own control brings it back. And **nothing here infers**: which screw
  and which pass are read from the subscribed object, so an ACCEPT typed into
  the console moves this prompt on too.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useAvailability } from '@/composables/useAvailability'
import { useBedScrewsStore } from '@/stores/bedScrews'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'

const { locale, t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const bedScrews = useBedScrewsStore()
const { isAvailable } = useAvailability('klipper')

const dialog = ref<HTMLDialogElement | null>(null)

const isOpen = computed(() => bedScrews.isPromptOpen)

const coordinateFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)

/**
 * The screws this pass visits, in the order it visits them. The coarse round
 * takes every screw; the fine round takes only those given a
 * `screwN_fine_adjust` coordinate, which is the same filter Klipper applies when
 * it builds its two lists — so `currentScrew`, an index into whichever list is
 * live, lands on the same screw here as it does there.
 */
const passScrews = computed(() => {
  const screws = printerConfig.bedScrews
  return bedScrews.pass === 'fine' ? screws.filter((screw) => screw.hasFineAdjust) : screws
})

/**
 * What to call the screw the machine is standing at. `screwN_name` where the
 * config gives one — that is the whole point of naming them, and "front left" is
 * worth more at the machine than a coordinate pair. Otherwise the coordinate,
 * formatted here where the locale is, the way Klipper's own fallback does it.
 *
 * A number as the last resort, not a blank: the config could name fewer screws
 * than the helper visits only if `configfile.settings` has not arrived yet, and
 * "Screw 2" is still true while that is outstanding.
 */
const screwName = computed(() => {
  const screw = passScrews.value[bedScrews.currentScrew]
  if (!screw) return t('bedScrews.screwNumber', { number: bedScrews.currentScrew + 1 })
  if (screw.name) return screw.name
  return t('bedScrews.unnamedScrew', {
    x: coordinateFormatter.value.format(screw.x),
    y: coordinateFormatter.value.format(screw.y),
  })
})

/**
 * How far through the round the machine is. Counted in accepted screws rather
 * than in the current index, because the two disagree in the one case that
 * matters: `ADJUSTED` sends the round back to the beginning, and a readout built
 * on the index would show it marching forward while Klipper started over.
 *
 * The total is the configured count, which the object itself never reports.
 * Suppressed entirely where the configuration has not arrived, since "1 of 0" is
 * worse than saying nothing.
 */
const progress = computed(() => {
  const total = passScrews.value.length
  if (total === 0) return null
  return t('bedScrews.progressValue', { accepted: bedScrews.acceptedScrews, total })
})

const passLabel = computed(() =>
  bedScrews.pass === 'fine' ? t('bedScrews.passFine') : t('bedScrews.passCoarse'),
)

/** Every answer ends the same wait, so one pending flag disables all three. */
const canAnswer = computed(() => isAvailable.value && !printer.pendingCommands.bedScrews)

/**
 * The shared shell's open/close watcher, plus the sync on mount that only this
 * shape needs: the prompt is opened by the machine, so reloading the page while
 * a screw is waiting sets the state before this component exists and a watcher
 * that only reacts to changes would leave it shut.
 */
function syncDialog(): void {
  const element = dialog.value
  if (!element) return
  if (isOpen.value && !element.open) element.showModal()
  if (!isOpen.value && element.open) element.close()
}

watch(isOpen, syncDialog, { flush: 'post' })
onMounted(syncDialog)

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog bed-screws-dialog"
    aria-labelledby="bed-screws-title"
    aria-describedby="bed-screws-description"
    @cancel.prevent="bedScrews.dismiss()"
  >
    <header class="bed-screws-dialog__header">
      <h2 id="bed-screws-title" class="bed-screws-dialog__title text-dialog-title">
        <AppIcon name="maintenance" class="size-5 shrink-0" aria-hidden="true" />
        {{ t('bedScrews.title') }}
      </h2>
      <!--
        Puts the prompt aside; it never answers the machine. Its title says so,
        because a close control on a dialog holding the machine still would
        otherwise read as the way to call the whole thing off — which is Abort,
        below, and says so.
      -->
      <AppButton
        variant="quiet"
        icon-only
        icon="close"
        :aria-label="t('bedScrews.dismiss')"
        :title="t('bedScrews.dismissTitle')"
        @click="bedScrews.dismiss()"
      />
    </header>

    <div class="bed-screws-dialog__body">
      <p id="bed-screws-description" class="bed-screws-dialog__description">
        {{ t('bedScrews.description') }}
      </p>

      <!--
        Which pass, which screw, and how far through the round — the whole state
        the helper has. A live region for the reason the probe's readout is one:
        every answer changes which screw is being talked about, the machine moves
        silently, and a reader who cannot see the change would press Accept and be
        told nothing at all. `atomic`, so the three cells are announced as one
        reading rather than as whichever changed.

        It also takes the opening focus, which is why it is focusable. Left to
        `showModal()` the focus lands on the first control — the close button —
        so a reflexive Enter would put the prompt away; and every other candidate
        is worse, since Enter on Accept answers for a screw nobody has looked at.
      -->
      <div
        class="bed-screws-dialog__readout"
        tabindex="-1"
        autofocus
        aria-live="polite"
        aria-atomic="true"
      >
        <span class="bed-screws-dialog__cell">
          <span class="text-field-label text-muted">{{ t('bedScrews.pass') }}</span>
          <span class="text-value-micro">{{ passLabel }}</span>
        </span>
        <span class="bed-screws-dialog__cell bed-screws-dialog__screw">
          <span class="text-field-label text-muted">{{ t('bedScrews.screw') }}</span>
          <strong class="text-value-large">{{ screwName }}</strong>
        </span>
        <span class="bed-screws-dialog__cell">
          <span class="text-field-label text-muted">{{ t('bedScrews.accepted') }}</span>
          <span class="text-value-micro" :class="{ 'text-muted': !progress }">
            {{ progress ?? t('bedScrews.noProgress') }}
          </span>
        </span>
      </div>

      <!--
        The one thing about this procedure nobody knows from the buttons: a screw
        turned by a noticeable amount changes the others, so Klipper starts the
        round again rather than moving on. Without it "Adjusted" reads as a
        politer Accept, and a round that restarts reads as the dialog having lost
        its place.
      -->
      <p class="text-hint text-muted">{{ t('bedScrews.adjustedHint') }}</p>
    </div>

    <!--
      Three buttons on the shared equal-width track, and the documented order
      still holds: the affirmatives lead, likeliest first, and the dismissive
      one is last. `Accept` is this surface's one `primary` because finishing a
      screw is what the dialog exists for; `Adjusted` is the same answer with a
      consequence, so it is neutral rather than a second primary; `Abort` is
      `danger` — it leaves the procedure without an answer and the bed
      half-adjusted.
    -->
    <div class="confirm-dialog__actions">
      <AppButton
        variant="primary"
        :pending="printer.pendingCommands.bedScrews"
        :label="t('bedScrews.accept')"
        :disabled="!canAnswer"
        :title="t('bedScrews.acceptTitle')"
        @click="printer.answerBedScrew('accept')"
      />
      <AppButton
        size="sm"
        :label="t('bedScrews.adjusted')"
        :disabled="!canAnswer"
        :title="t('bedScrews.adjustedTitle')"
        @click="printer.answerBedScrew('adjusted')"
      />
      <AppButton
        size="sm"
        variant="danger"
        :label="t('bedScrews.abort')"
        :disabled="!canAnswer"
        @click="printer.answerBedScrew('abort')"
      />
    </div>
  </dialog>
</template>
