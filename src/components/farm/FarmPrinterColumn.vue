<script setup lang="ts">
/**
 * One printer on the farm rail, at one of two sizes.
 *
 * Collapsed is the default and holds every row the reader watches — camera,
 * state, progress, temperatures, filament, queue. Expanding adds exactly two
 * things: the slicer preview beside its data, and the control dock. That is
 * what keeps the two sizes one design rather than two: a collapsed column is
 * never missing information, only room.
 *
 * It renders a `FarmPrinterSnapshot` and nothing else, so it cannot tell
 * whether its printer is driven by a page-scoped farm connection or by the
 * live stores — see `stores/farm.ts`.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import CameraTile from '@/components/camera/CameraTile.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FarmFilesDialog from '@/components/farm/FarmFilesDialog.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { isFarmSnapshotStale, type FarmConfirmableAction } from '@/farm/types'
import type { FarmPrinterView } from '@/stores/farm'
import { useFarmStore } from '@/stores/farm'

const props = defineProps<{
  printer: FarmPrinterView
  expanded: boolean
}>()

const emit = defineEmits<{
  toggle: []
  open: []
  visibility: [visible: boolean]
}>()

const { t } = useI18n({ useScope: 'global' })
const farm = useFarmStore()

const root = ref<HTMLElement | null>(null)
const snapshot = computed(() => props.printer.snapshot)
const stale = computed(() => isFarmSnapshotStale(snapshot.value))

/**
 * Whether the column is on screen, reported to the store so it can open and
 * close this printer's connection. One viewport of overscan either side, so a
 * column just past the edge is already connected by the time it is scrolled
 * to; the store's own grace period handles the other direction.
 */
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !root.value) {
    // No observer means no gating: every column connects, which is the
    // behaviour a small farm has anyway.
    emit('visibility', true)
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1]
      if (entry) emit('visibility', entry.isIntersecting)
    },
    { root: root.value.parentElement, rootMargin: '0px 100% 0px 100%' },
  )
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  emit('visibility', false)
})

/**
 * Expanding must leave the column exactly where it is on screen.
 *
 * Growing a card by a couple of hundred pixels changes the rail's scroll width
 * under a fixed `scrollLeft`, and anything that then scrolls — the browser's
 * own anchoring, or a well-meant `scrollIntoView` — slides the card the reader
 * just clicked out from under the cursor. So the card's left edge is measured
 * before the size change and the rail's scroll is corrected by the difference
 * after it: the clicked column stays put, and whatever is to its right moves
 * instead, which is where the space has to come from anyway.
 */
watch(
  () => props.expanded,
  async () => {
    const element = root.value
    const rail = element?.parentElement
    if (!element || !rail) return
    const before = element.getBoundingClientRect().left
    await nextTick()
    const after = element.getBoundingClientRect().left
    const drift = after - before
    if (drift !== 0) rail.scrollLeft += drift
  },
)

const camera = computed(() => snapshot.value.cameras.find((entry) => entry.enabled) ?? null)

/**
 * The address, under the name — but only for a printer somebody has named.
 * An unnamed entry already *is* its address, and printing it twice reads as a
 * rendering fault rather than as extra information.
 */
const showsHost = computed(() => props.expanded && props.printer.label !== props.printer.host)

const isOffline = computed(
  () => snapshot.value.connection === 'offline' || snapshot.value.connection === 'idle',
)
const isRefused = computed(() => snapshot.value.connection === 'originRefused')
const isKlipperFaulted = computed(
  () =>
    snapshot.value.connection === 'connected' &&
    (snapshot.value.klipper === 'error' || snapshot.value.klipper === 'shutdown'),
)
const isPrinting = computed(() => snapshot.value.state === 'printing')
const isPaused = computed(() => snapshot.value.state === 'paused')
const hasJobRunning = computed(() => isPrinting.value || isPaused.value)

/**
 * The one chip. Connection first, because a printer nobody can reach has no
 * print state worth reporting; then Klipper's fault; then what it is doing.
 * The active printer says so instead — its state is already the header's job.
 */
const status = computed<{ key: string; tone: string }>(() => {
  if (props.printer.isActive && snapshot.value.connection === 'connected')
    return { key: 'active', tone: 'active' }
  if (isRefused.value) return { key: 'refused', tone: 'error' }
  if (isOffline.value)
    return snapshot.value.hasConnected
      ? { key: 'offline', tone: 'offline' }
      : { key: 'unreached', tone: 'offline' }
  if (snapshot.value.connection === 'connecting') return { key: 'connecting', tone: 'muted' }
  if (snapshot.value.connection === 'reconnecting') return { key: 'reconnecting', tone: 'muted' }
  if (isKlipperFaulted.value) return { key: 'klipperError', tone: 'error' }
  if (snapshot.value.klipper === 'startup') return { key: 'klipperStarting', tone: 'muted' }
  if (isPrinting.value) return { key: 'printing', tone: 'printing' }
  if (isPaused.value) return { key: 'paused', tone: 'paused' }
  if (snapshot.value.state === 'error') return { key: 'printError', tone: 'error' }
  return { key: 'idle', tone: 'idle' }
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
 * printer sitting idle answers exactly that, with nothing wrong. The chip
 * therefore appears only when something is actually being held back.
 */
const queueHeld = computed(() => queue.value?.state === 'paused' && queueJobs.value.length > 0)

/**
 * Whether a command can be sent at all.
 *
 * `stale` is the wrong question and answered it wrongly: a printer this browser
 * has *never* reached is not stale — it has nothing to be stale about — so
 * every control gated on staleness alone was live on a column that could not
 * accept a single one of them. Homing was the visible case, because it is the
 * one control here whose enablement does not otherwise depend on a print state
 * the machine never reported.
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

const axes = ['X', 'Y', 'Z'] as const
const homedAxes = computed(() => snapshot.value.homedAxes.toUpperCase())
const isHomed = (axis: string): boolean => homedAxes.value.includes(axis)
const isFullyHomed = computed(() => axes.every((axis) => isHomed(axis)))

/**
 * Homing is refused while a job is *loaded* — paused as well as printing — and
 * the reasoning is the Movement card's, repeated because this is a second
 * surface offering the same command: `G28 Z` on a probe-homed machine drives
 * the nozzle down at the bed with a printed part in the way, and a paused print
 * is exactly when somebody is tempted to reach for it.
 *
 * A machine nobody can reach cannot be homed either, so staleness disables it
 * for the ordinary reason every other control here is disabled.
 */
const canHome = computed(
  () => canCommand.value && !hasJobRunning.value && !pending('home') && !isKlipperFaulted.value,
)

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
 * The column owns its own confirmation, the way a dashboard module does. The
 * dialog is rendered only while one is pending, so a rail of twenty columns
 * still has at most one `<dialog>` in the document.
 */
const confirming = ref<FarmConfirmableAction | null>(null)

/**
 * The file picker is a dialog rather than a link to Print files, because the
 * whole value of choosing a file from here is not losing the wall to do it.
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
    // The file, not only the printer: on a rail of near-identical columns the
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
    class="farm-column"
    :class="{
      'farm-column--wide': expanded,
      'farm-column--active': printer.isActive,
      'farm-column--stale': stale,
    }"
    :aria-label="printer.label"
  >
    <header class="farm-column__head">
      <button
        type="button"
        class="farm-column__chevron"
        :aria-expanded="expanded"
        :aria-label="
          expanded
            ? t('farm.collapse', { printer: printer.label })
            : t('farm.expand', { printer: printer.label })
        "
        @click="emit('toggle')"
      >
        <AppIcon :name="expanded ? 'down' : 'right'" class="size-4" aria-hidden="true" />
      </button>
      <span class="farm-column__name">
        {{ printer.label }}
        <span v-if="showsHost" class="farm-column__host">{{ printer.host }}</span>
      </span>
      <!--
        Text and a fixed danger colour rather than button chrome — the emergency
        stop is outlier 5 in `button-system.md`, and this is its second
        instance. It stays on a *collapsed* column deliberately: the reason to
        have it here at all is spotting a crash on a machine nobody is driving,
        and a chevron first would be one click too many.
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
      The state gets its own row rather than sharing the header with the name.
      Sharing it cost the name almost all of a 200 px column: a chip is as wide
      as its longest translated word, and what got squeezed was the one thing
      that tells two identical-looking columns apart.
    -->
    <p class="farm-column__state">
      <span class="farm-chip" :data-tone="status.tone">{{ t(`farm.status.${status.key}`) }}</span>
    </p>

    <CameraTile
      v-if="camera"
      :key="camera.uid"
      class="farm-column__camera"
      :camera="camera"
      :selected="!stale"
      :show-label="false"
      :show-frame-rate="false"
      fit="cover"
      compact
    />
    <div v-else class="farm-column__camera farm-column__camera--empty">
      <AppIcon name="cameraOff" class="size-5" aria-hidden="true" />
      <span>{{ t('farm.noCamera') }}</span>
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

    <div class="farm-job">
      <p class="farm-job__name" :class="{ 'farm-job__name--past': !hasJobRunning }">
        {{ snapshot.job ? snapshot.job.filename : t('farm.noJob') }}
      </p>
      <div v-if="snapshot.job && progressPercent !== null" class="farm-bar">
        <span
          :style="{ width: `${progressPercent}%` }"
          :data-paused="isPaused ? 'true' : undefined"
        ></span>
      </div>
      <div v-if="snapshot.job" class="farm-job__meta">
        <span v-if="progressPercent !== null">{{
          t('farm.percent', { value: progressPercent })
        }}</span>
        <span v-if="hasJobRunning">{{ formatDuration(snapshot.job.remainingSeconds) }}</span>
        <span v-else>{{ t(`farm.ended.${snapshot.state}`) }}</span>
        <span v-if="expanded && snapshot.job.totalLayer">
          {{
            t('farm.layers', {
              current: snapshot.job.currentLayer ?? 0,
              total: snapshot.job.totalLayer,
            })
          }}
        </span>
      </div>
    </div>

    <div class="farm-body" :class="{ 'farm-body--split': expanded }">
      <div v-if="expanded" class="farm-preview">
        <img
          v-if="snapshot.job?.thumbnailUrl"
          class="farm-preview__image"
          :src="snapshot.job.thumbnailUrl"
          :alt="t('farm.previewAlt', { file: snapshot.job.filename })"
        />
        <div v-else class="farm-preview__empty">{{ t('farm.noPreview') }}</div>
      </div>

      <div class="farm-data">
        <dl class="farm-temps">
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
        </dl>

        <p v-if="snapshot.spool" class="farm-filament">
          <span
            class="farm-filament__swatch"
            :style="snapshot.spool.color ? { background: snapshot.spool.color } : undefined"
            aria-hidden="true"
          ></span>
          <b>{{ snapshot.spool.material || t('farm.unknownMaterial') }}</b>
          <span v-if="expanded && snapshot.spool.remainingWeight !== null">
            {{ t('farm.grams', { value: Math.round(snapshot.spool.remainingWeight) }) }}
          </span>
        </p>

        <section v-if="queue" class="farm-queue" :aria-label="t('farm.queue')">
          <header class="farm-queue__head">
            <span>{{ t('farm.queueCount', { count: queueJobs.length }) }}</span>
            <span v-if="queueHeld" class="farm-chip" data-tone="paused">{{
              t('farm.queueHeld')
            }}</span>
            <span v-else-if="queueJobs.length > 0" class="farm-chip" data-tone="idle">
              {{ t('farm.queueRunning') }}
            </span>
          </header>
          <ol v-if="queueJobs.length > 0" class="farm-queue__list">
            <li v-for="(job, index) in queueJobs" :key="job.jobId">
              <span>{{ index + 1 }}</span>
              <span class="farm-queue__file">{{ job.filename }}</span>
            </li>
          </ol>
          <p v-else class="farm-queue__empty">{{ t('farm.queueEmpty') }}</p>
        </section>
      </div>
    </div>

    <!--
      The dock is at both sizes, and what expanding adds to it is the *queue*
      layer: holding the line, dropping the next job. The split is what the
      column is about at each size — collapsed acts on the machine in front of
      you, expanded manages what it does next — rather than "some controls are
      hidden until you ask", which would make a collapsed column a worse copy
      of an expanded one.
    -->
    <footer class="farm-dock">
      <div class="farm-dock__grid">
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
        <template v-if="expanded">
          <AppButton
            size="xs"
            :label="queueHeld ? t('farm.startQueue') : t('farm.holdQueue')"
            :disabled="!canQueue || pending('queue')"
            :pending="pending('queue')"
            @click="queueHeld ? farm.startQueue(printer.id) : farm.holdQueue(printer.id)"
          />
          <AppButton
            size="xs"
            variant="danger-quiet"
            :label="t('farm.removeNext')"
            :disabled="!canRemoveNext || pending('removeNext')"
            :pending="pending('removeNext')"
            @click="farm.removeNextJob(printer.id)"
          />
        </template>
      </div>

      <!--
        Homing is `G28` — a native Klipper command on every machine, which is
        why it can be here at all on a page that discovers nothing about a
        printer's configuration. Each button says whether its axis is already
        homed in its accessible name rather than by colour, and the row states
        the machine's homed state in words above it.
      -->
      <div class="farm-home">
        <span class="farm-home__state" :data-homed="isFullyHomed ? 'true' : 'false'">
          {{ isFullyHomed ? t('farm.homed') : t('farm.notHomed') }}
        </span>
        <div class="farm-home__row">
          <AppButton
            size="xs"
            icon="home"
            :label="t('farm.homeAllShort')"
            :title="t('farm.homeAll')"
            :disabled="!canHome"
            :pending="pending('home')"
            @click="farm.home(printer.id)"
          />
          <AppButton
            v-for="axis in axes"
            :key="axis"
            size="xs"
            variant="quiet"
            :label="axis"
            :title="
              !canHome
                ? t('farm.homeBlocked', { axis })
                : isHomed(axis)
                  ? t('farm.homeAxisHomed', { axis })
                  : t('farm.homeAxisNotHomed', { axis })
            "
            :disabled="!canHome"
            @click="farm.home(printer.id, axis)"
          />
        </div>
      </div>

      <div class="farm-dock__utilities">
        <AppButton
          size="xs"
          variant="quiet"
          icon="snowflake"
          :label="t('farm.cooldown')"
          :disabled="!canCooldown || pending('cooldown')"
          :pending="pending('cooldown')"
          @click="farm.cooldown(printer.id)"
        />
        <AppButton
          v-if="snapshot.power"
          size="xs"
          :guard="powerGuard"
          icon="power"
          :label="snapshot.power.on ? t('farm.powerOff') : t('farm.powerOn')"
          :disabled="!canCommand || pending('power')"
          :pending="pending('power')"
          @click="requestPower"
        />
        <AppButton
          size="xs"
          variant="quiet"
          icon="jobs"
          :label="t('farm.files.open')"
          :disabled="!canCommand"
          @click="browsingFiles = true"
        />
        <AppButton
          v-if="!canCommand"
          size="xs"
          variant="quiet"
          icon="refresh"
          :label="t('farm.retry')"
          @click="farm.retry(printer.id)"
        />
      </div>

      <!--
        Two different actions, so two different words. Switching retargets the
        live connection and leaves you here — the wall is where you were looking
        and the column marks itself as the one Alabaster is driving. Only the
        card that is already active offers to leave, and it is the only one for
        which leaving means anything.
      -->
      <AppButton
        block
        size="sm"
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
