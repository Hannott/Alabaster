<!--
  The prompt a manual probe puts on screen — dialog-system.md's Shape 6, the
  live procedure dialog, and its reference implementation.

  Klipper's `manual_probe` helper stops the machine mid-command and waits for a
  person to say where the bed is. Anything can start it: `MANUAL_PROBE`,
  `Z_ENDSTOP_CALIBRATE`, `PROBE_CALIBRATE`, or a user macro such as
  `CALIBRATE_NOZZLE_Z`, from the console, a macro button, the printer's own
  screen, or a second browser. Without this dialog the wait is invisible: the
  only sign is a line in the console transcript and a machine that has stopped
  answering, and the only way out is typing `TESTZ` by hand.

  Not `BED_SCREWS_ADJUST`, which is its own Klipper helper and has its own
  prompt in `BedScrewsDialog.vue` — see the note in `stores/manualProbe.ts`.

  Two rules shape everything below. **The probe is machine state, not dialog
  state** — closing this cannot accept or abort anything, so Escape and the
  close control put the prompt aside and the header's own control brings it
  back. And **nothing here infers**: every number is read from the subscribed
  `manual_probe` object, so a step taken from the console or another browser
  moves this readout too.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import { offsetMagnitude, signedOffsetStep } from '@/components/dashboard/modules/movementSteps'
import { useAvailability } from '@/composables/useAvailability'
import { useManualProbeStore } from '@/stores/manualProbe'
import { usePrinterStore, type ManualProbeStep } from '@/stores/printer'

/**
 * The ladder of explicit distances, in millimetres, coarsest first. Klipper
 * clamps every bisection to 0.2mm per press (see `bisectMax` below), so the
 * halving control cannot reach the bed however many times it is pressed. These
 * can, which is the point: a probe that begins five millimetres up needs a
 * coarse rung to get down, and the paper test at the end needs the finest one.
 *
 * Labels come from Movement's babystep formatter rather than a second copy of
 * the same rule, for the reason that function documents: a row of fixed
 * magnitudes is read against its neighbors, where telling `.05` from `.005` at
 * a glance matters more than matching the surrounding prose. The magnitudes
 * themselves are this dialog's own — a babystep row deliberately stops at
 * 0.1mm, and a probe five millimetres above the bed cannot.
 */
const stepLadder = [1, 0.1, 0.05, 0.01, 0.005] as const

/**
 * Klipper's own `BISECT_MAX`. Every `TESTZ Z=+`/`-`/`++`/`--` is clamped to it —
 * `min(check_z, z_pos + BISECT_MAX)` in `manual_probe.py`, unconditionally — so
 * no bisection can move further than this in one press.
 */
const bisectMax = 0.2

/**
 * What a halving press will actually move, in millimetres, from the bracket the
 * machine reports: half the distance to the nearest height already tried in that
 * direction, or the clamp, whichever is smaller. Null while the probe has not
 * reported a position yet.
 *
 * **This is why `++` and `--` are gone.** Klipper offers four bisection words:
 * halve the gap, and go the whole way to the height already tried. But the clamp
 * applies to both, so the two forms move the same distance until the gap is
 * narrower than twice the clamp — with nothing tried in that direction, which is
 * how every probe starts, all four move exactly 0.2mm. Four buttons that mostly
 * do two things, labeled with a notation the user has to be taught, bought
 * nothing that the ladder below does not already offer; and once each button
 * carries the distance it will move, the duplicates would have been two pairs of
 * identical labels. The one thing halving genuinely adds — a step that gets finer
 * on its own as the bracket closes — is kept, and now says what it is about to do.
 */
function halveDistance(direction: 1 | -1): number | null {
  const z = manualProbe.zPosition
  if (z === null) return null
  const bound = direction > 0 ? manualProbe.zPositionUpper : manualProbe.zPositionLower
  const remaining = bound === null ? Number.POSITIVE_INFINITY : Math.abs(bound - z) / 2
  return Math.min(remaining, bisectMax)
}

const { locale, t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const manualProbe = useManualProbeStore()
const { isAvailable } = useAvailability('klipper')

const dialog = ref<HTMLDialogElement | null>(null)

const isOpen = computed(() => manualProbe.isPromptOpen)

/**
 * Three decimals, which is what Klipper's own console report prints and finer
 * than the paper test can resolve. Locale-formatted, unlike the step labels:
 * this is a measurement being read, not one of a row of magnitudes being
 * compared against each other.
 */
const heightFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
)

function formatHeight(value: number | null): string | null {
  return value === null ? null : heightFormatter.value.format(value)
}

const height = computed(() => formatHeight(manualProbe.zPosition))
const lowerBound = computed(() => formatHeight(manualProbe.zPositionLower))
const upperBound = computed(() => formatHeight(manualProbe.zPositionUpper))

/** A step may be taken while Klipper is answering and no earlier step is still moving. */
const canStep = computed(() => isAvailable.value && !printer.pendingCommands.manualProbe)
/** Accept and Abort are the two ways out, and each blocks the other, not the ladder. */
const canFinish = computed(() => isAvailable.value && !printer.pendingCommands.manualProbeFinish)

function stepLabel(millimetres: number): string {
  const magnitude = offsetMagnitude(Math.abs(millimetres), 'millimetre')
  return t(millimetres < 0 ? 'manualProbe.stepDown' : 'manualProbe.stepUp', { step: magnitude })
}

/**
 * The two halving controls, each carrying the distance it will move. The face
 * and the accessible name are the same number the ladder's buttons use, so the
 * only thing distinguishing this pair is that its number changes as the bracket
 * closes — which is what the group's own label and hint are for.
 *
 * `isSpent` is the end of the bisection: enough halvings and the remaining gap
 * rounds away below the three decimals Klipper itself reports, at which point
 * the press would move nothing and the honest thing is to say so rather than
 * offer a button labeled `+0`.
 */
const halveControls = computed(() =>
  ([1, -1] as const).map((direction) => {
    const distance = halveDistance(direction)
    const signed = distance === null ? null : distance * direction
    const magnitude = distance === null ? null : offsetMagnitude(distance, 'millimetre')
    // Spent covers both "no distance left to halve" and "no position reported",
    // and both take the dash: a button reading `−0` states a move it will not
    // make, which is worse than saying there is no number to show.
    const isSpent = magnitude === null || magnitude === '0'
    const step: ManualProbeStep = direction > 0 ? '+' : '-'
    return {
      direction,
      step,
      isSpent,
      face: isSpent || signed === null ? '—' : signedOffsetStep(signed, 'millimetre'),
      name: isSpent || signed === null ? t('manualProbe.bracketClosed') : stepLabel(signed),
    }
  }),
)

/**
 * The shared shell's open/close watcher, plus a sync on mount that the other
 * shapes do not need. Every other dialog is mounted closed and opened later by
 * a click, so a watcher alone can never miss the transition. This one is opened
 * by the machine: reloading the page while a probe is waiting sets the state
 * before this component exists, and a watcher that only reacts to changes would
 * leave the prompt shut with a probe still holding the machine still.
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
    class="confirm-dialog manual-probe-dialog"
    aria-labelledby="manual-probe-title"
    aria-describedby="manual-probe-description"
    @cancel.prevent="manualProbe.dismiss()"
  >
    <header class="manual-probe-dialog__header">
      <h2 id="manual-probe-title" class="manual-probe-dialog__title text-dialog-title">
        <AppIcon name="probe" class="size-5 shrink-0" aria-hidden="true" />
        {{ t('manualProbe.title') }}
      </h2>
      <!--
        Puts the prompt aside; it never touches the probe. Its title says so,
        because a close control on a dialog that is holding the machine still
        would otherwise read as the way to call the whole thing off — which is
        Abort, below, and says so.
      -->
      <AppButton
        variant="quiet"
        icon-only
        icon="close"
        :aria-label="t('manualProbe.dismiss')"
        :title="t('manualProbe.dismissTitle')"
        @click="manualProbe.dismiss()"
      />
    </header>

    <!--
      Everything between the header and the actions scrolls, so the two ways out
      of the probe stay reachable at any viewport height. This dialog is taller
      than a confirmation by the two grids' worth of controls it carries — enough
      that a short phone in landscape, or a browser with a toolbar, could
      otherwise push Accept and Abort under the fold of a modal that blocks the
      document's own scrolling.
    -->
    <div class="manual-probe-dialog__body">
      <p id="manual-probe-description" class="manual-probe-dialog__description">
        {{ t('manualProbe.description') }}
      </p>

      <!--
        The bracket either side of the height, which is the whole state a
        bisection has: the nearest height already tried below and above. Klipper
        writes an unknown bound as `??????` in its own console line; this names it
        instead, because a row of question marks reads as a fault rather than as
        "nothing has been tried that way yet".
      -->
      <!--
        A live region, which no other dialog in the product needs. Every step
        here changes a number the user is deciding on, and a reader who cannot
        see it would otherwise press a button and be told nothing at all — the
        move is silent, the prompt stays open, and there is no reply. `atomic`
        so the three cells are announced as the one reading Klipper itself
        prints ("4.950 → 4.997 → 5.050") rather than as whichever cell changed.

        It also takes the opening focus, which is why it is focusable at all.
        `showModal()` otherwise focuses the first control in the dialog — the
        close button — so a reflexive Enter on a freshly opened prompt would put
        it away again. Every other candidate is worse: focus on a step button
        makes Enter move the nozzle. Landing on the reading announces the state
        and does nothing, and `tabindex="-1"` keeps it out of the tab order
        afterwards.
      -->
      <div
        class="manual-probe-dialog__readout"
        tabindex="-1"
        autofocus
        aria-live="polite"
        aria-atomic="true"
      >
        <span class="manual-probe-dialog__bound">
          <span class="text-field-label text-muted">{{ t('manualProbe.triedBelow') }}</span>
          <span class="text-value-micro" :class="{ 'text-muted': !lowerBound }">
            {{ lowerBound ?? t('manualProbe.noBound') }}
          </span>
        </span>
        <span class="manual-probe-dialog__height">
          <span class="text-field-label text-muted">{{ t('manualProbe.height') }}</span>
          <strong class="text-value-large">
            {{ height ?? t('manualProbe.noHeight') }}
          </strong>
        </span>
        <span class="manual-probe-dialog__bound">
          <span class="text-field-label text-muted">{{ t('manualProbe.triedAbove') }}</span>
          <span class="text-value-micro" :class="{ 'text-muted': !upperBound }">
            {{ upperBound ?? t('manualProbe.noBound') }}
          </span>
        </span>
      </div>

      <!--
        Both control grids share one column track and one direction: every
        magnitude is a column, the top row of each grid moves away from the bed
        and the bottom row toward it. Nothing states that in words, because every
        label carries its own sign and the height above it moves as you press —
        `TESTZ Z=-0.05` lowers the nozzle by 0.05mm and means nothing else.
        (Movement's babystep row does carry a legend, and needs one: there,
        negative closes the gap while the probe's own `z_offset` runs the other
        way, so the sign genuinely is ambiguous. Here it is not.)

        The first arrangement split direction horizontally — negatives descending
        into the middle, positives ascending out of it, the way that same babystep
        row does — and that is right for a row that stays a row. This one cannot:
        ten cells do not fit a phone-width dialog, so it wraps to two, and the
        mirrored order then stacked `−1` on top of `+.005`. A column that pairs the
        largest step down with the smallest step up is worse than no column at all,
        because the eye reads a stack as a pair.
      -->
      <div class="manual-probe-dialog__group">
        <p class="text-field-label text-muted">{{ t('manualProbe.bisectTitle') }}</p>
        <div class="manual-probe-dialog__ladder">
          <div
            v-for="halve in halveControls"
            :key="halve.direction"
            class="manual-probe-dialog__row"
          >
            <AppButton
              mono
              :label="halve.face"
              class="manual-probe-dialog__halve"
              :disabled="!canStep || halve.isSpent"
              :aria-label="halve.name"
              :title="halve.name"
              @click="printer.testZ(halve.step)"
            />
          </div>
        </div>
        <p class="text-hint text-muted">{{ t('manualProbe.bisectHint') }}</p>
      </div>

      <div class="manual-probe-dialog__group">
        <p class="text-field-label text-muted">{{ t('manualProbe.stepsTitle') }}</p>
        <div class="manual-probe-dialog__ladder">
          <div class="manual-probe-dialog__row">
            <AppButton
              v-for="step in stepLadder"
              :key="`probe-plus-${step}`"
              size="sm"
              mono
              :label="signedOffsetStep(step, 'millimetre')"
              :disabled="!canStep"
              :aria-label="stepLabel(step)"
              :title="stepLabel(step)"
              @click="printer.testZ(step)"
            />
          </div>
          <div class="manual-probe-dialog__row">
            <AppButton
              v-for="step in stepLadder"
              :key="`probe-minus-${step}`"
              size="sm"
              mono
              :label="signedOffsetStep(-step, 'millimetre')"
              :disabled="!canStep"
              :aria-label="stepLabel(-step)"
              :title="stepLabel(-step)"
              @click="printer.testZ(-step)"
            />
          </div>
        </div>
      </div>
    </div>

    <!--
      Accept first and Abort second, on the shared equal-width track: the
      affirmative action leads, exactly as it does in every confirmation. Abort
      is `danger` — it throws the position away and leaves whatever started the
      probe without an answer — and Accept is this surface's one `primary`,
      since finishing the probe is what the dialog exists for.
    -->
    <div class="confirm-dialog__actions">
      <AppButton
        variant="primary"
        :pending="printer.pendingCommands.manualProbeFinish"
        :label="t('manualProbe.accept')"
        :disabled="!canFinish"
        @click="printer.acceptManualProbe()"
      />
      <AppButton
        variant="danger"
        :label="t('manualProbe.abort')"
        :disabled="!canFinish"
        @click="printer.abortManualProbe()"
      />
    </div>
  </dialog>
</template>
