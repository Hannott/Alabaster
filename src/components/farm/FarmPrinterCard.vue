<script setup lang="ts">
/**
 * One printer on the farm grid.
 *
 * Five rows, and the camera is the middle three quarters of them. That is the
 * whole design: the destination exists so somebody can look at their machines,
 * and the rail this replaced spent 17% of a card on the picture and 18% on a
 * control dock. Everything the dock carried is still reachable — two commands
 * on the card, the rest one menu away — but nothing else is allowed to take
 * space from the stream.
 *
 * It renders a `FarmPrinterSnapshot` and nothing else, so it cannot tell
 * whether its printer is driven by a page-scoped farm connection or by the
 * live stores — see `stores/farm.ts`.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'
import CameraTile from '@/components/camera/CameraTile.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FarmFilesDialog from '@/components/farm/FarmFilesDialog.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { useFarmCameraChoice } from '@/composables/useFarmCameraChoice'
import { isFarmSnapshotStale, type FarmConfirmableAction } from '@/farm/types'
import type { FarmPrinterView } from '@/stores/farm'
import { useFarmStore } from '@/stores/farm'

const props = defineProps<{ printer: FarmPrinterView }>()

const emit = defineEmits<{
  open: []
  visibility: [visible: boolean]
}>()

const { t } = useI18n({ useScope: 'global' })
const farm = useFarmStore()
const { chosenCamera, chooseCamera } = useFarmCameraChoice()

const root = ref<HTMLElement | null>(null)
const snapshot = computed(() => props.printer.snapshot)
const stale = computed(() => isFarmSnapshotStale(snapshot.value))

/**
 * Whether the card is on screen, reported to the store so it can open and close
 * this printer's connection.
 *
 * The root is the viewport rather than a named ancestor: the page shell is the
 * scroller and it fills the viewport, so the two ask the same question, and a
 * card no longer has to assume anything about what its parent is. Overscan is
 * half a viewport either way — one card row at every width the grid has — so a
 * card just past the fold is already connected by the time it is scrolled to,
 * without paying for two rows nobody has reached.
 */
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !root.value) {
    // No observer means no gating: every card connects, which is the behavior
    // a small farm has anyway.
    emit('visibility', true)
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1]
      if (entry) emit('visibility', entry.isIntersecting)
    },
    { rootMargin: '50% 0px' },
  )
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  emit('visibility', false)
})

/**
 * Every camera this printer has switched on, and which one this card draws.
 *
 * The disabled ones are filtered here rather than in the connection, because
 * the settings editor needs them and both producers of a snapshot meet in this
 * component. Picking the first enabled camera silently is a coin toss on a
 * machine with a nozzle cam and a chamber cam, so the choice is the reader's
 * and is remembered per printer.
 */
const cameras = computed(() => snapshot.value.cameras.filter((entry) => entry.enabled))
const camera = computed(() => {
  const uid = chosenCamera(props.printer.id)
  return cameras.value.find((entry) => entry.uid === uid) ?? cameras.value[0] ?? null
})

/**
 * The address, under the name — but only for a printer somebody has named. An
 * unnamed entry already *is* its address, and printing it twice reads as a
 * rendering fault rather than as extra information. It is unconditional now
 * that a card is wide enough for both: on a wall of near-identical machines the
 * address is what tells two printers called "Voron 2.4" apart, and the rail hid
 * it behind a chevron only because 300 px could not hold two lines.
 */
const showsHost = computed(() => props.printer.label !== props.printer.host)

const isOffline = computed(
  () => snapshot.value.connection === 'offline' || snapshot.value.connection === 'idle',
)
const isRefused = computed(() => snapshot.value.connection === 'originRefused')
const isUnauthorized = computed(() => snapshot.value.connection === 'unauthorized')
const isKlipperFaulted = computed(
  () =>
    snapshot.value.connection === 'connected' &&
    (snapshot.value.klipper === 'error' || snapshot.value.klipper === 'shutdown'),
)
const isPrinting = computed(() => snapshot.value.state === 'printing')
const isPaused = computed(() => snapshot.value.state === 'paused')
const hasJobRunning = computed(() => isPrinting.value || isPaused.value)

/**
 * The state, as the row's own word rather than as a chip.
 *
 * Connection first, because a printer nobody can reach has no print state worth
 * reporting; then Klipper's fault; then what it is doing. The precedence is the
 * rail's, unchanged — what changed is that a 570 px card has room to say it in
 * words at the size of the question being asked, so the chip that needed a row
 * of its own in a 300 px column is now the row.
 */
const status = computed<{ key: string; icon: AppIconName; tone: string }>(() => {
  if (isRefused.value) return { key: 'refused', icon: 'warning', tone: 'error' }
  if (isUnauthorized.value) return { key: 'unauthorized', icon: 'lock', tone: 'error' }
  if (isOffline.value)
    return snapshot.value.hasConnected
      ? { key: 'offline', icon: 'cameraNoSignal', tone: 'offline' }
      : { key: 'unreached', icon: 'warning', tone: 'offline' }
  if (snapshot.value.connection === 'connecting')
    return { key: 'connecting', icon: 'lan', tone: 'muted' }
  if (snapshot.value.connection === 'reconnecting')
    return { key: 'reconnecting', icon: 'lan', tone: 'muted' }
  if (isKlipperFaulted.value) return { key: 'klipperError', icon: 'warning', tone: 'error' }
  if (snapshot.value.klipper === 'startup')
    return { key: 'klipperStarting', icon: 'lan', tone: 'muted' }
  if (isPrinting.value) return { key: 'printing', icon: 'print', tone: 'printing' }
  if (isPaused.value) return { key: 'paused', icon: 'pause', tone: 'paused' }
  if (snapshot.value.state === 'error') return { key: 'printError', icon: 'warning', tone: 'error' }
  if (snapshot.value.state === 'complete') return { key: 'complete', icon: 'check', tone: 'idle' }
  if (snapshot.value.state === 'cancelled') return { key: 'cancelled', icon: 'close', tone: 'idle' }
  return { key: 'idle', icon: 'machine', tone: 'idle' }
})

const progressPercent = computed(() => {
  const progress = snapshot.value.job?.progress
  if (progress === null || progress === undefined) return null
  return Math.round(progress * 100)
})

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return t('farm.noValue')
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return t('farm.durationHours', { hours, minutes })
  return t('farm.durationMinutes', { minutes })
}

function formatTemperature(value: number | null): string {
  if (value === null) return t('farm.noValue')
  return String(Math.round(value))
}

function formatTarget(value: number | null): string {
  if (value === null || value <= 0) return t('farm.targetOff')
  return t('farm.targetValue', { value: Math.round(value) })
}

const queue = computed(() => snapshot.value.queue)
const queueJobs = computed(() => queue.value?.jobs ?? [])
/**
 * An empty queue that Moonraker reports as `paused` is not a held line — a
 * printer sitting idle answers exactly that, with nothing wrong. So the strip
 * says "held" only when something is actually being held back.
 */
const queueHeld = computed(() => queue.value?.state === 'paused' && queueJobs.value.length > 0)

/**
 * Whether a command can be sent at all.
 *
 * `stale` is the wrong question and answered it wrongly: a printer this browser
 * has *never* reached is not stale — it has nothing to be stale about — so
 * every control gated on staleness alone was live on a card that could not
 * accept a single one of them.
 */
const canCommand = computed(() => snapshot.value.connection === 'connected')

const canPause = computed(() => isPrinting.value && canCommand.value)
const canResume = computed(() => isPaused.value && canCommand.value)
const canCancel = computed(() => hasJobRunning.value && canCommand.value)
const canCooldown = computed(
  () =>
    canCommand.value &&
    ((snapshot.value.extruder.target ?? 0) > 0 || (snapshot.value.bed.target ?? 0) > 0),
)
const canQueue = computed(() => queue.value !== null && canCommand.value)
const canRemoveNext = computed(() => queueJobs.value.length > 0 && canCommand.value)

const homedAxes = computed(() => snapshot.value.homedAxes.toUpperCase())
const isFullyHomed = computed(() => ['X', 'Y', 'Z'].every((axis) => homedAxes.value.includes(axis)))

/**
 * Homing is refused while a job is *loaded* — paused as well as printing — and
 * the reasoning is the Movement card's, repeated because this is a second
 * surface offering the same command: `G28 Z` on a probe-homed machine drives
 * the nozzle down at the bed with a printed part in the way, and a paused print
 * is exactly when somebody is tempted to reach for it.
 *
 * It can be offered here at all only because `G28` is native to Klipper, so it
 * needs nothing discovered about the machine beyond the one subscribed field
 * that says which axes are already homed. That field now feeds a *status* — the
 * header's "not homed" chip — rather than four per-axis buttons: a farm reader
 * homes a machine or does not, and choosing an axis is a Movement-card act on a
 * machine you are driving.
 */
const canHome = computed(
  () => canCommand.value && !hasJobRunning.value && !pending('home') && !isKlipperFaulted.value,
)

/**
 * The one conditional chip, between the name and the emergency stop.
 *
 * It is a status rather than a control, so its appearing never moves a control:
 * the stop is pinned to the inline end and the name is what flexes. Only one
 * card can ever be "active", and "not homed" is the state worth noticing —
 * homed is unremarkable and says nothing.
 *
 * **"Active" is the word Settings' printer rows already use** for exactly this
 * fact: the printer the rest of the application is pointed at. It is not a
 * machine state and must not read like one — an earlier revision said
 * "driving", which on an idle machine looked like a claim that the printer was
 * running. One vocabulary for one fact, and `printers.active` is where it is
 * defined.
 */
const headerChip = computed<{ key: string; tone: string } | null>(() => {
  if (props.printer.isActive && canCommand.value) return { key: 'active', tone: 'active' }
  if (canCommand.value && !hasJobRunning.value && !isFullyHomed.value)
    return { key: 'notHomed', tone: 'paused' }
  return null
})

/*
 * Cancel ends a print that cannot be brought back, so it is terminal whenever
 * one is loaded and nothing at all when the machine is idle — the same
 * print-derived tier the header's restarts use. The emergency stop is terminal
 * unconditionally, and power is terminal only while a print is running, which
 * is the case where cutting the supply loses the job.
 */
const cancelGuard = useActionGuard({
  tier: () => (hasJobRunning.value ? 'terminal' : 'reversible'),
  key: 'farmCancelPrint',
})
const estopGuard = useActionGuard({ tier: 'terminal', key: 'emergencyStop' })
const powerGuard = useActionGuard({
  tier: () => (hasJobRunning.value ? 'terminal' : 'reversible'),
  emphasis: 'quiet',
  key: 'farmPowerOff',
})

/**
 * The card owns its own confirmation, the way a dashboard module does. The
 * dialog is rendered only while one is pending, so a wall of twenty cards still
 * has at most one `<dialog>` in the document.
 */
const confirming = ref<FarmConfirmableAction | null>(null)

/**
 * The file picker is a dialog rather than a link to Print files, because the
 * whole value of choosing a file from here is not losing the wall to do it.
 * It carries this printer's queue on a second tab, which is where the job list
 * the card reduced to a count went.
 */
const browsingFiles = ref(false)

function requestCancel(): void {
  cancelGuard.request(
    () => void farm.cancel(props.printer.id),
    () => (confirming.value = 'cancel'),
  )
}

function requestEmergencyStop(): void {
  estopGuard.request(
    () => void farm.emergencyStop(props.printer.id),
    () => (confirming.value = 'emergencyStop'),
  )
}

function requestPower(): void {
  powerGuard.request(
    () => void farm.togglePower(props.printer.id),
    () => (confirming.value = 'power'),
  )
}

const confirmCopy = computed(() => {
  const printerName = props.printer.label
  if (confirming.value === 'emergencyStop') {
    return {
      title: t('farm.confirm.emergencyStop.title', { printer: printerName }),
      description: t('farm.confirm.emergencyStop.description'),
      confirmLabel: t('farm.confirm.emergencyStop.confirm'),
    }
  }
  if (confirming.value === 'power') {
    return {
      title: t('farm.confirm.power.title', { printer: printerName }),
      description: t('farm.confirm.power.description'),
      confirmLabel: t('farm.confirm.power.confirm'),
    }
  }
  return {
    title: t('farm.confirm.cancel.title', { printer: printerName }),
    // The file, not only the printer: on a wall of near-identical cards the
    // machine's name alone is not enough to catch a wrong click.
    description: t('farm.confirm.cancel.description', {
      file: snapshot.value.job?.filename ?? '',
    }),
    confirmLabel: t('farm.confirm.cancel.confirm'),
  }
})

function runConfirmed(): void {
  const action = confirming.value
  confirming.value = null
  if (action === 'cancel') void farm.cancel(props.printer.id)
  else if (action === 'emergencyStop') void farm.emergencyStop(props.printer.id)
  else if (action === 'power') void farm.togglePower(props.printer.id)
}

function pending(command: string): boolean {
  return farm.isPending(props.printer.id, command)
}
</script>

<template>
  <article
    ref="root"
    class="farm-card"
    :class="{
      'farm-card--active': printer.isActive,
      'farm-card--stale': stale,
    }"
    :aria-label="printer.label"
  >
    <header class="farm-card__head">
      <span class="farm-card__name">
        <b>{{ printer.label }}</b>
        <span v-if="showsHost" class="farm-card__host">{{ printer.host }}</span>
      </span>
      <span v-if="headerChip" class="farm-chip" :data-tone="headerChip.tone">
        {{ t(`farm.chip.${headerChip.key}`) }}
      </span>
      <!--
        Text and a fixed danger color rather than button chrome — the emergency
        stop is outlier 5 in `button-system.md`, and this is its second
        instance. The reason this destination has one at all is spotting a crash
        on a machine nobody is driving, so it is never a click away.
      -->
      <button
        type="button"
        class="farm-estop"
        :disabled="!canCommand || pending('emergencyStop')"
        :data-pending="pending('emergencyStop') ? 'true' : undefined"
        :title="t('farm.emergencyStopFor', { printer: printer.label })"
        v-bind="estopGuard.bind.value"
        @click="requestEmergencyStop"
      >
        <AppIcon name="emergencyStop" class="size-4" aria-hidden="true" />
        <span class="sr-only">{{ t('farm.emergencyStopFor', { printer: printer.label }) }}</span>
      </button>
    </header>

    <!--
      The camera, at the size that makes the difference between "something is
      moving" and "that first layer is down". `fit="cover"` keeps the 16:9 box
      whatever the stream's own shape is, because a card that changed height
      when a 4:3 camera connected would reflow its whole grid row.

      Where there is no camera the slicer's preview takes the box instead. That
      is the one place a preview earns 320 px: it is worth the space exactly
      when nothing else is filling it, and worth almost none beside a live
      stream.
    -->
    <div class="farm-card__camera">
      <CameraTile
        v-if="camera"
        :key="camera.uid"
        :camera="camera"
        :selected="!stale"
        :show-label="cameras.length > 1"
        :show-frame-rate="false"
        fit="cover"
      />
      <img
        v-else-if="snapshot.job?.thumbnailUrl"
        class="farm-card__preview"
        :src="snapshot.job.thumbnailUrl"
        :alt="t('farm.previewAlt', { file: snapshot.job.filename })"
      />
      <div v-else class="farm-card__camera-empty">
        <AppIcon name="cameraOff" class="size-6" aria-hidden="true" />
        <span>{{ t('farm.noCamera') }}</span>
      </div>

      <HeaderMenu
        v-if="cameras.length > 1"
        class="farm-card__cameras"
        :label="t('farm.chooseCamera')"
        align="start"
        trigger-variant="quiet"
        trigger-size="sm"
        trigger-on-strong
        trigger-icon-only
      >
        <template #trigger>
          <AppIcon name="camera" class="size-4" aria-hidden="true" />
        </template>
        <template #default="{ close }">
          <p class="header-menu__section-title">{{ t('farm.chooseCamera') }}</p>
          <AppButton
            v-for="entry in cameras"
            :key="entry.uid"
            variant="quiet"
            size="sm"
            start
            block
            :label="entry.name"
            :aria-current="entry.uid === camera?.uid ? 'true' : undefined"
            @click="
              () => {
                chooseCamera(printer.id, entry.uid)
                close()
              }
            "
          />
        </template>
      </HeaderMenu>

      <!--
        Progress on the camera's own bottom edge rather than in a row of its
        own: it reads as part of the picture and costs four pixels instead of
        seventy. Paused recolors it *and* the state row says Paused, so it never
        carries the difference by color alone.
      -->
      <div v-if="progressPercent !== null" class="farm-card__bar">
        <span
          :style="{ width: `${progressPercent}%` }"
          :data-paused="isPaused ? 'true' : undefined"
        ></span>
      </div>
    </div>

    <p v-if="isRefused" class="farm-notice" role="status">
      <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
      <span>{{ t('farm.originRefused') }}</span>
    </p>
    <p v-else-if="isOffline && !snapshot.hasConnected" class="farm-notice" role="status">
      <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
      <span>{{ t('farm.neverReached') }}</span>
    </p>
    <p v-else-if="isKlipperFaulted && snapshot.klipperMessage" class="farm-notice" role="status">
      <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
      <span class="farm-notice__message">{{ snapshot.klipperMessage }}</span>
    </p>

    <div class="farm-state">
      <AppIcon :name="status.icon" class="farm-state__glyph size-6" aria-hidden="true" />
      <span class="farm-state__main">
        <span class="farm-state__word" :data-tone="status.tone">{{
          t(`farm.status.${status.key}`)
        }}</span>
        <span class="farm-state__file">
          <template v-if="snapshot.job">
            {{ snapshot.job.filename
            }}<template v-if="snapshot.job.totalLayer">
              ·
              {{
                t('farm.layers', {
                  current: snapshot.job.currentLayer ?? 0,
                  total: snapshot.job.totalLayer,
                })
              }}</template
            >
          </template>
          <template v-else>{{ t('farm.noJob') }}</template>
        </span>
      </span>
      <!--
        Percent over remaining time, and the remaining time only while a job is
        actually running: on a finished print the state word above already says
        how it ended, and repeating it here as a second "Completed" reads as a
        rendering fault rather than as information.
      -->
      <span v-if="snapshot.job" class="farm-state__right">
        <span v-if="progressPercent !== null" class="farm-state__percent">{{
          t('farm.percent', { value: progressPercent })
        }}</span>
        <span v-if="hasJobRunning" class="farm-state__eta">{{
          formatDuration(snapshot.job.remainingSeconds)
        }}</span>
      </span>
    </div>

    <!--
      One strip for every fact the card carries, in place of the rail's three
      separate blocks. Only capability removes a cell — no Spoolman, no filament
      cell; no `job_queue` answer, no queue cell — and preference never does, so
      two cards are always comparable rather than being two dashboards side by
      side.
    -->
    <dl class="farm-facts">
      <div>
        <dt>{{ t('farm.hotend') }}</dt>
        <dd>
          {{ formatTemperature(snapshot.extruder.temperature) }}
          <i>{{ formatTarget(snapshot.extruder.target) }}</i>
        </dd>
      </div>
      <div>
        <dt>{{ t('farm.bed') }}</dt>
        <dd>
          {{ formatTemperature(snapshot.bed.temperature) }}
          <i>{{ formatTarget(snapshot.bed.target) }}</i>
        </dd>
      </div>
      <div v-if="snapshot.spool">
        <dt>{{ t('farm.filament') }}</dt>
        <dd>
          <span
            class="farm-facts__swatch"
            :style="snapshot.spool.color ? { background: snapshot.spool.color } : undefined"
            aria-hidden="true"
          ></span>
          {{ snapshot.spool.material || t('farm.unknownMaterial') }}
          <i v-if="snapshot.spool.remainingWeight !== null">{{
            t('farm.grams', { value: Math.round(snapshot.spool.remainingWeight) })
          }}</i>
        </dd>
      </div>
      <div v-if="queue">
        <dt>{{ t('farm.queue') }}</dt>
        <!--
          The bare count, because the cell's own label already says Queue —
          "Queue · 0" under a QUEUE label reads as a rendering fault. The
          dialog's tab keeps the labelled form, where it has no label beside it.
        -->
        <dd>
          {{ queueJobs.length }}
          <i v-if="queueHeld">{{ t('farm.queueHeld') }}</i>
        </dd>
      </div>
    </dl>

    <!--
      Two commands on the card and the rest in one menu.
      `interface-standards.md`'s rule holds through the change: controls are
      disabled, never removed, because a control that moves position between
      states is how a wall of near-identical cards produces a wrong click. Pause
      and Cancel are here because they are what somebody reaches for *because*
      they were watching; behind a menu they would make the card worse at the
      one job it has.
    -->
    <footer class="farm-actions">
      <AppButton
        v-if="canResume"
        size="xs"
        variant="primary"
        :label="t('farm.resume')"
        :disabled="pending('resume')"
        :pending="pending('resume')"
        @click="farm.resume(printer.id)"
      />
      <AppButton
        v-else
        size="xs"
        :label="t('farm.pause')"
        :disabled="!canPause || pending('pause')"
        :pending="pending('pause')"
        @click="farm.pause(printer.id)"
      />
      <AppButton
        size="xs"
        :guard="cancelGuard"
        :label="t('farm.cancel')"
        :disabled="!canCancel || pending('cancel')"
        :pending="pending('cancel')"
        @click="requestCancel"
      />

      <span class="farm-actions__gap"></span>

      <AppButton
        v-if="!canCommand"
        size="xs"
        variant="quiet"
        icon="refresh"
        :label="t('farm.retry')"
        @click="farm.retry(printer.id)"
      />
      <!--
        Opening upward, not downward: the trigger is on the card's bottom edge,
        so a panel placed below it would fall off the last row of the grid.
        Placement is a variant rather than a measurement, which is what keeps
        every menu in the product the same surface.
      -->
      <HeaderMenu
        v-else
        :label="t('farm.moreActions', { printer: printer.label })"
        align="end"
        placement="above"
        trigger-variant="quiet"
        trigger-icon-only
      >
        <template #trigger>
          <AppIcon name="more" class="size-4" aria-hidden="true" />
        </template>
        <template #default="{ close }">
          <AppButton
            variant="quiet"
            size="sm"
            start
            block
            icon="home"
            :label="t('farm.homeAll')"
            :disabled="!canHome"
            :pending="pending('home')"
            @click="
              () => {
                farm.home(printer.id)
                close()
              }
            "
          />
          <AppButton
            variant="quiet"
            size="sm"
            start
            block
            icon="snowflake"
            :label="t('farm.cooldown')"
            :disabled="!canCooldown || pending('cooldown')"
            :pending="pending('cooldown')"
            @click="
              () => {
                farm.cooldown(printer.id)
                close()
              }
            "
          />
          <AppButton
            v-if="snapshot.power"
            :guard="powerGuard"
            size="sm"
            start
            block
            icon="power"
            :label="snapshot.power.on ? t('farm.powerOff') : t('farm.powerOn')"
            :disabled="pending('power')"
            :pending="pending('power')"
            @click="
              () => {
                requestPower()
                close()
              }
            "
          />
          <AppButton
            variant="quiet"
            size="sm"
            start
            block
            icon="jobs"
            :label="t('farm.files.open')"
            @click="
              () => {
                browsingFiles = true
                close()
              }
            "
          />
          <AppButton
            variant="quiet"
            size="sm"
            start
            block
            :icon="queueHeld ? 'play' : 'pause'"
            :label="queueHeld ? t('farm.startQueue') : t('farm.holdQueue')"
            :disabled="!canQueue || pending('queue')"
            :pending="pending('queue')"
            @click="
              () => {
                queueHeld ? farm.startQueue(printer.id) : farm.holdQueue(printer.id)
                close()
              }
            "
          />
          <AppButton
            variant="danger-quiet"
            size="sm"
            start
            block
            icon="skipForward"
            :label="t('farm.removeNext')"
            :disabled="!canRemoveNext || pending('removeNext')"
            :pending="pending('removeNext')"
            @click="
              () => {
                farm.removeNextJob(printer.id)
                close()
              }
            "
          />
        </template>
      </HeaderMenu>

      <!--
        Two different actions, so two different words. Switching retargets the
        live connection and leaves you here — the wall is where you were looking
        and the card marks itself as the one Alabaster is driving. Only the card
        that is already active offers to leave, and it is the only one for which
        leaving means anything. The card body is deliberately not a click
        target: a page built for glancing must not turn a stray click into a
        connection change.
      -->
      <AppButton
        size="xs"
        :variant="printer.isActive ? 'primary' : 'neutral'"
        :label="printer.isActive ? t('farm.openActive') : t('farm.switch')"
        :title="printer.isActive ? undefined : t('farm.switchTo', { printer: printer.label })"
        @click="emit('open')"
      />
    </footer>

    <FarmFilesDialog
      v-if="browsingFiles"
      open
      :printer-id="printer.id"
      :printer-label="printer.label"
      :busy="hasJobRunning"
      :queue="queue"
      @close="browsingFiles = false"
    />

    <ConfirmDialog
      v-if="confirming"
      open
      :title="confirmCopy.title"
      :description="confirmCopy.description"
      :confirm-label="confirmCopy.confirmLabel"
      tone="danger"
      @confirm="runConfirmed"
      @cancel="confirming = null"
    />
  </article>
</template>
