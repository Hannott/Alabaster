<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import MachineHardwarePanel from '@/components/machine/MachineHardwarePanel.vue'
import MachineHostStrip from '@/components/machine/MachineHostStrip.vue'
import MachineServicesPanel from '@/components/machine/MachineServicesPanel.vue'
import PageHeading from '@/components/PageHeading.vue'
import ReleaseNotesList from '@/components/ReleaseNotesList.vue'
import UpdateCommitList from '@/components/UpdateCommitList.vue'
import UpdateRecoveryDialog from '@/components/UpdateRecoveryDialog.vue'
import { useActionGuard } from '@/composables/useActionGuard'
import { fetchReleaseNotes, type ReleaseNote } from '@/features/machine/releaseNotes'
import type { MachineUpdateAvailability, MachineUpdateItem } from '@/stores/machineSystem'
import { releaseNotesUrl, updateAvailability, useMachineSystemStore } from '@/stores/machineSystem'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useMoonrakerStore } from '@/stores/moonraker'

const { locale, t } = useI18n({ useScope: 'global' })
const moonraker = useMoonrakerStore()
const machine = useMachineSystemStore()
const confirmations = useConfirmationsStore()
/*
 * `primary` emphasis: installing an update is a commitment rather than a
 * destruction, so it keeps the emphasis it has while the dialog is there and
 * escalates one step when the dialog is gone. One guard for both triggers,
 * because both answer to the same key -- an update installed one at a time and
 * an update-all are the same decision.
 */
const installGuard = useActionGuard({ tier: 'terminal', emphasis: 'primary', key: 'installUpdate' })
/**
 * The same decision as `installGuard`, at `neutral` emphasis: a row's Update
 * sits in a list beside Update all, and one filled control per panel is what
 * lets the panel-wide action read as the primary one.
 */
const rowInstallGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'neutral',
  key: 'installUpdate',
})
/**
 * `danger-quiet`: rolling back is a real regression, but the control sits in a
 * list of otherwise-quiet rows, the same reasoning that keeps the header
 * power menu's `rebootHost`/`shutdownHost` off the louder plain `danger`.
 */
const rollbackGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'rollbackUpdate',
})
let pollTimer: ReturnType<typeof setInterval> | undefined
const completeStatsRefreshMs = 5_000

/** Joining names with a literal ", " would not survive translation. */
const listFormatter = computed(
  () => new Intl.ListFormat(locale.value, { style: 'long', type: 'conjunction' }),
)

function updateVersion(update: MachineUpdateItem): string {
  if (update.configured_type === 'system') {
    return t('machine.updates.packages', { count: update.package_count ?? 0 })
  }
  return update.version || '—'
}

/**
 * The part of a target version a reader has not already read on the left of
 * the arrow: `v2026.07.00-48 → -60` rather than the whole describe string twice.
 * Only a shared prefix ending at the last `-` is dropped, so a release that
 * changes its base version is always shown whole.
 */
function shortTarget(from: string, to: string): string {
  const cut = from.lastIndexOf('-')
  return cut > 0 && to.startsWith(from.slice(0, cut + 1)) ? to.slice(cut) : to
}

function joinDetail(parts: string[]): string {
  return parts.reduce((first, second) => t('machine.updates.detailJoin', { first, second }))
}

/**
 * The line under a source's name. An available source says what it moves to
 * rather than only where it is, so the reader can judge an update without
 * opening its confirmation first; a source needing attention names the
 * condition Moonraker saw.
 */
function updateDetail(update: MachineUpdateItem): string {
  const availability = updateAvailability(update)
  if (availability === 'attention')
    return joinDetail([updateVersion(update), attentionReason(update)])
  if (availability !== 'available' || update.configured_type === 'system') {
    return updateVersion(update)
  }
  const parts = [
    update.version && update.remote_version && update.remote_version !== update.version
      ? t('machine.updates.versionChange', {
          from: update.version,
          to: shortTarget(update.version, update.remote_version),
        })
      : updateVersion(update),
  ]
  const commits = update.commits_behind_count ?? 0
  if (commits > 0) parts.push(t('machine.updates.commits', { count: commits }))
  return joinDetail(parts)
}

/** Moonraker raises `attention` for three different conditions; the row names the one it saw. */
function attentionReason(update: MachineUpdateItem): string {
  if (update.corrupt) return t('machine.updates.reasonCorrupt')
  if (update.is_valid === false) return t('machine.updates.reasonInvalid')
  return t('machine.updates.reasonDirty')
}

/** A downloaded release links to its notes; a git source's commits are its changelog instead. */
function rowReleaseNotesUrl(update: MachineUpdateItem): string | null {
  return updateAvailability(update) === 'available' ? releaseNotesUrl(update) : null
}

/**
 * Attention before available before current, so the rows that need a decision
 * are read first. Within a state the order stays Moonraker's own.
 */
const availabilityOrder: Record<MachineUpdateAvailability, number> = {
  attention: 0,
  available: 1,
  current: 2,
}

const sortedUpdates = computed(() =>
  machine.updates
    .map((update, index) => ({ update, index }))
    .sort(
      (a, b) =>
        availabilityOrder[updateAvailability(a.update)] -
          availabilityOrder[updateAvailability(b.update)] || a.index - b.index,
    )
    .map(({ update }) => update),
)

const updateCounts = computed(() => {
  const counts: Record<MachineUpdateAvailability, number> = {
    attention: 0,
    available: 0,
    current: 0,
  }
  for (const update of machine.updates) counts[updateAvailability(update)] += 1
  return counts
})

/*
 * Up-to-date sources fold away after the first two: they ask nothing of the
 * reader, and a dozen of them pushed the one row that did ask below the fold.
 * Folding a single row would spend a row on the button that replaces it, so a
 * fold only happens when it hides at least two.
 */
const visibleCurrentLimit = 2
const showAllCurrent = ref(false)

const hiddenCurrentCount = computed(() => {
  const hidden = updateCounts.value.current - visibleCurrentLimit
  return hidden >= 2 ? hidden : 0
})

const visibleUpdates = computed(() => {
  if (showAllCurrent.value || hiddenCurrentCount.value === 0) return sortedUpdates.value
  let shownCurrent = 0
  return sortedUpdates.value.filter(
    (update) => updateAvailability(update) !== 'current' || shownCurrent++ < visibleCurrentLimit,
  )
})

function checkedAgo(at: number): string {
  const minutes = Math.floor((machine.clockNow - at) / 60_000)
  if (minutes < 1) return t('machine.updates.summaryCheckedNow')
  const format = new Intl.RelativeTimeFormat(locale.value, { style: 'long' })
  const time =
    minutes < 60
      ? format.format(-minutes, 'minute')
      : minutes < 60 * 24
        ? format.format(-Math.floor(minutes / 60), 'hour')
        : format.format(-Math.floor(minutes / (60 * 24)), 'day')
  return t('machine.updates.summaryChecked', { time })
}

/** One line that answers "is anything waiting?" without reading every row. */
const updateSummary = computed(() => {
  const { attention, available, current } = updateCounts.value
  const parts =
    attention === 0 && available === 0
      ? [t('machine.updates.summaryAllCurrent', { count: current })]
      : [
          available > 0 ? t('machine.updates.summaryAvailable', { count: available }) : null,
          attention > 0 ? t('machine.updates.summaryAttention', { count: attention }) : null,
          current > 0 ? t('machine.updates.summaryCurrent', { count: current }) : null,
        ].filter((part): part is string => part !== null)
  if (machine.lastCheckedAt !== null) parts.push(checkedAgo(machine.lastCheckedAt))
  return joinDetail(parts)
})

/**
 * The leading glyph is a shape per state that needs a decision, so those rows
 * never read by colour alone; an up-to-date row leaves the slot empty and says
 * so in words at its trailing edge instead.
 */
const stateIcons = {
  available: 'arrowUpCircle',
  attention: 'warning',
} as const satisfies Record<Exclude<MachineUpdateAvailability, 'current'>, AppIconName>

function stateIcon(update: MachineUpdateItem): AppIconName | null {
  const availability = updateAvailability(update)
  return availability === 'current' ? null : stateIcons[availability]
}

/** The localized joiner `updateDetail` uses, for a detail line that ends in a link. */
const detailSeparator = computed(() => t('machine.updates.detailJoin', { first: '', second: '' }))

/** Names the version a rollback returns to whenever Moonraker reports one. */
function rollbackLabel(update: MachineUpdateItem): string {
  return update.rollback_version
    ? t('machine.updates.rollbackTo', { version: update.rollback_version })
    : t('machine.updates.rollback')
}

/** The full sentence a screen reader hears, which never depends on hover. */
function rowActionName(update: MachineUpdateItem): string {
  const key =
    updateAvailability(update) === 'attention'
      ? 'machine.updates.investigateOne'
      : 'machine.updates.updateOne'
  return t(key, { name: update.displayName })
}

/**
 * The install button's own visible label -- the generic verb, not the
 * name-including phrase `rowActionName` carries for assistive technology.
 */
function installLabel(update: MachineUpdateItem): string {
  return machine.runningUpdateId === update.id
    ? t('machine.updates.updating')
    : t('machine.updates.update')
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
 * `commits_behind` is the changelog for a `git_repo` source; a `system`
 * source has no commits at all, so its own package list stands in instead —
 * never both, since a source is only ever one of the two shapes.
 *
 * A `web` or `zip` source is a downloaded release archive, and Moonraker sends
 * no changelog for it at all. Its notes are read from the GitHub releases it
 * names (`features/machine/releaseNotes.ts`), every release between the
 * installed version and the available one, and the link to the release page
 * stays beside them — it is all there is while they load, or when GitHub
 * cannot be reached.
 */
const pendingUpdateCommits = computed(() => pendingUpdate.value?.commits_behind ?? [])
const pendingUpdatePackages = computed(() =>
  pendingUpdateCommits.value.length ? [] : (pendingUpdate.value?.package_list ?? []),
)
const pendingReleaseUrl = computed(() => releaseNotesUrl(pendingUpdate.value))
const pendingReleaseNotes = ref<ReleaseNote[]>([])
/*
 * The release-page link counts too: the notes arrive after the dialog opens,
 * and taking the wider measure only then would resize the dialog under the
 * reader.
 */
const hasChangelogDetails = computed(
  () =>
    pendingUpdateCommits.value.length > 0 ||
    pendingUpdatePackages.value.length > 0 ||
    pendingReleaseUrl.value !== null,
)

watch(pendingUpdate, (update) => {
  pendingReleaseNotes.value = []
  if (!update || releaseNotesUrl(update) === null) return
  const { owner, repo_name: repo, version, remote_version: available } = update
  if (!owner || !repo || !version || !available) return
  void fetchReleaseNotes(owner, repo, version, available).then((notes) => {
    if (notes && pendingUpdate.value?.id === update.id) pendingReleaseNotes.value = notes
  })
})

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

function requestInstall(update: MachineUpdateItem): void {
  if (updatesDisabled.value) return
  if (installGuard.guarded.value) pendingUpdate.value = update
  else runUpdate(update)
}

function investigate(update: MachineUpdateItem): void {
  if (updatesDisabled.value) return
  investigating.value = update
}

function checkSource(update: MachineUpdateItem): void {
  if (updatesDisabled.value) return
  void machine.checkForUpdates(update.id)
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
 * console popout, which opens itself the moment `isUpdating` goes true.
 */
function confirmRecovery(id: string): void {
  investigating.value = null
  void machine.recoverUpdate(id)
}

/**
 * Only a `git_repo`/`web` source has a previous version Moonraker can revert
 * to, and a source already needing attention is resolved through Investigate
 * instead -- a dirty or corrupt repository is no more rollback-able than it is
 * upgradeable.
 */
function canRollbackUpdate(update: MachineUpdateItem): boolean {
  return update.configured_type !== 'system' && updateAvailability(update) !== 'attention'
}

/*
 * Moonraker's `anomalies` are unexpected-but-tolerated conditions -- an
 * unofficial remote or branch is the common case -- that never raise
 * `attention` and so are never covered by Investigate. `attention` rows are
 * excluded here because their own recovery dialog already lists every
 * reported condition, anomalies included; showing this toggle there too would
 * be the same information behind two controls on the same row.
 */
function hasAnomalyToggle(update: MachineUpdateItem): boolean {
  return (update.anomalies?.length ?? 0) > 0 && updateAvailability(update) !== 'attention'
}

const expandedAnomalyIds = ref(new Set<string>())

function isAnomaliesExpanded(id: string): boolean {
  return expandedAnomalyIds.value.has(id)
}

function toggleAnomalies(id: string): void {
  const next = new Set(expandedAnomalyIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedAnomalyIds.value = next
}

const pendingRollback = ref<MachineUpdateItem | null>(null)

function requestRollback(update: MachineUpdateItem): void {
  if (updatesDisabled.value) return
  if (rollbackGuard.guarded.value) pendingRollback.value = update
  else void machine.rollbackUpdate(update.id)
}

function cancelRollback(): void {
  pendingRollback.value = null
}

/*
 * The dialog closes as the rollback starts: its progress belongs in the same
 * update console popout every other update action opens, via the shared
 * `isUpdating` watcher in `MachineUpdateConsoleHost`.
 */
function confirmRollback(): void {
  const target = pendingRollback.value
  pendingRollback.value = null
  if (target) void machine.rollbackUpdate(target.id)
}

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

    <!--
      No `flex-1`/`min-h-0`: this page has no nested scroll region, so the
      region should take its content's natural height like any other flex
      item. `min-h-0` used to sit here needlessly and, combined with the
      default `flex-shrink: 1`, let `.standard-page`'s flex layout shrink the
      region below its content height once Updates made the page taller than
      the viewport -- the overflow stayed in `.standard-page`'s scrollable
      area but past where its own `padding-block-end` reserves room for the
      mobile nav bar, so the last update row rendered underneath it.
    -->
    <AvailabilityRegion requires="moonraker">
      <div v-if="machine.error" class="machine-system-error selectable" role="alert">
        {{ t('machine.error') }}
      </div>

      <MachineHostStrip />

      <div class="machine-system-grid">
        <MachineServicesPanel v-if="machine.services.length" />
        <!--
          Hidden entirely rather than shown empty: a printer whose Moonraker
          never implemented the peripheral endpoints (or is not running on
          Linux) simply never populates any of these lists.
        -->
        <MachineHardwarePanel
          v-if="
            machine.mcuModules.length ||
            machine.serialDevices.length ||
            machine.usbDevices.length ||
            machine.canbusInterfaces.length
          "
        />

        <!--
          ADR 0004 asks the region affected by an async operation to expose
          `aria-busy`, which is also what tells assistive technology why every
          control inside it is disabled.
        -->
        <section
          class="machine-status-panel machine-list-panel"
          aria-labelledby="machine-updates-title"
          :aria-busy="machine.isUpdateManagerBusy || undefined"
        >
          <header class="machine-panel-heading">
            <AppIcon name="systemUpdate" class="size-5 text-action" aria-hidden="true" />
            <h2 id="machine-updates-title">{{ t('machine.updates.title') }}</h2>
            <div class="machine-panel-heading__actions">
              <AppButton
                v-if="machine.outputLines.length > 0 || machine.isUpdating"
                variant="quiet"
                size="sm"
                :pending="machine.isUpdating"
                icon="console"
                :label="t('machine.output.openConsole')"
                @click="machine.isConsoleOpen = true"
              />
              <AppButton
                icon-only
                :pending="machine.checkingUpdateId === ''"
                :icon="machine.checkingUpdateId === '' ? 'spinner' : 'refresh'"
                :disabled="updatesDisabled"
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
              />
              <AppButton
                v-if="machine.hasAvailableUpdates"
                size="sm"
                :guard="installGuard"
                :pending="machine.isUpdatingAll"
                icon="download"
                :label="t('machine.updates.updateAllCount', { count: updateCounts.available })"
                :disabled="updatesDisabled"
                @click="requestUpdateAll"
              />
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

          <p v-if="machine.updates.length" class="machine-panel-summary" aria-live="polite">
            {{ updateSummary }}
          </p>

          <div v-if="machine.updates.length" class="machine-list">
            <template v-for="update in visibleUpdates" :key="update.id">
              <!--
                Plain content with one visible verb, not a click target whose
                meaning changes with state. Read left to right: the state's
                shape (only when it asks for a decision), what the source is and
                where it would move to, the anomalies toggle when Moonraker
                reported one, the one action the state asks for or "Up to date"
                when it asks for none, and the menu holding what a reader rarely
                needs.
              -->
              <div class="machine-row" :data-state="updateAvailability(update)">
                <AppIcon
                  v-if="stateIcon(update)"
                  :name="stateIcon(update)!"
                  class="machine-row__state size-5"
                  aria-hidden="true"
                />
                <span class="machine-row__detail">
                  <span class="machine-row__name">{{ update.displayName }}</span>
                  <span v-if="updateAvailability(update) !== 'current'" class="sr-only">
                    {{ t(`machine.updates.status.${updateAvailability(update)}`) }}
                  </span>
                  <span class="machine-row__meta" :title="updateDetail(update)">
                    {{ updateDetail(update)
                    }}<template v-if="rowReleaseNotesUrl(update)"
                      >{{ detailSeparator
                      }}<a
                        class="machine-row__link"
                        :href="rowReleaseNotesUrl(update)!"
                        target="_blank"
                        rel="noopener noreferrer"
                        :aria-label="
                          t('machine.updates.releaseNotes', { version: update.remote_version })
                        "
                        >{{ t('machine.updates.releaseNotesLink') }}</a
                      ></template
                    >
                  </span>
                </span>
                <!--
                  A disclosure toggle for `anomalies` Moonraker reports outside the
                  attention state -- see `hasAnomalyToggle`'s reasoning. It stays on
                  the row rather than in the menu, because the condition it reveals
                  is one a reader would never think to go looking for.
                -->
                <AppButton
                  v-if="hasAnomalyToggle(update)"
                  variant="quiet"
                  size="sm"
                  icon-only
                  icon="info"
                  class="machine-row__aside"
                  :aria-pressed="isAnomaliesExpanded(update.id)"
                  :aria-controls="`machine-list__notes-${update.id}`"
                  :aria-label="
                    t(
                      isAnomaliesExpanded(update.id)
                        ? 'machine.updates.anomaliesHide'
                        : 'machine.updates.anomaliesShow',
                      { name: update.displayName },
                    )
                  "
                  :title="t('machine.updates.anomalies')"
                  @click="toggleAnomalies(update.id)"
                />
                <AppButton
                  v-if="updateAvailability(update) === 'available'"
                  class="machine-row__action"
                  size="sm"
                  :guard="rowInstallGuard"
                  :label="installLabel(update)"
                  :disabled="updatesDisabled"
                  :pending="machine.runningUpdateId === update.id"
                  :aria-label="rowActionName(update)"
                  :title="rowActionName(update)"
                  @click="requestInstall(update)"
                />
                <AppButton
                  v-else-if="updateAvailability(update) === 'attention'"
                  class="machine-row__action"
                  size="sm"
                  :label="t('machine.updates.investigate')"
                  :disabled="updatesDisabled"
                  :aria-label="rowActionName(update)"
                  :title="rowActionName(update)"
                  @click="investigate(update)"
                />
                <span v-else class="machine-row__status">
                  <AppIcon name="check" class="size-4" aria-hidden="true" />
                  {{
                    machine.checkingUpdateId === update.id
                      ? t('machine.updates.checking')
                      : t('machine.updates.status.current')
                  }}
                </span>
                <HeaderMenu
                  class="machine-row__menu"
                  :label="t('machine.updates.moreActions', { name: update.displayName })"
                  align="end"
                  trigger-size="sm"
                  trigger-icon-only
                >
                  <template #trigger>
                    <AppIcon name="more" class="size-5" aria-hidden="true" />
                  </template>
                  <template #default="{ close }">
                    <AppButton
                      variant="quiet"
                      size="sm"
                      start
                      block
                      icon="refresh"
                      class="machine-row__check"
                      :label="t('machine.updates.check')"
                      :disabled="updatesDisabled"
                      @click="
                        () => {
                          checkSource(update)
                          close()
                        }
                      "
                    />
                    <AppButton
                      v-if="canRollbackUpdate(update)"
                      size="sm"
                      start
                      block
                      icon="undo"
                      class="machine-row__rollback"
                      :guard="rollbackGuard"
                      :label="rollbackLabel(update)"
                      :disabled="updatesDisabled"
                      @click="
                        () => {
                          requestRollback(update)
                          close()
                        }
                      "
                    />
                  </template>
                </HeaderMenu>
              </div>
              <ul
                v-if="hasAnomalyToggle(update) && isAnomaliesExpanded(update.id)"
                :id="`machine-list__notes-${update.id}`"
                class="machine-list__notes selectable"
              >
                <li v-for="message in update.anomalies" :key="message">
                  <AppIcon name="info" class="size-4" aria-hidden="true" />
                  <span>{{ message }}</span>
                </li>
              </ul>
            </template>
            <div v-if="hiddenCurrentCount > 0" class="machine-list__fold">
              <AppButton
                variant="quiet"
                size="sm"
                block
                :aria-expanded="showAllCurrent"
                :label="
                  showAllCurrent
                    ? t('machine.updates.showFewer')
                    : t('machine.updates.showMoreCurrent', { count: hiddenCurrentCount })
                "
                @click="showAllCurrent = !showAllCurrent"
              />
            </div>
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
      show-skip-option
      @confirm="confirmUpdate"
      @cancel="cancelConfirm"
      @skip="confirmations.setSkip('installUpdate', true)"
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
      <template v-else-if="pendingReleaseUrl" #details>
        <template v-if="pendingReleaseNotes.length">
          <p class="update-recovery-section-note">
            {{ t('machine.updates.changelogReleases', { count: pendingReleaseNotes.length }) }}
          </p>
          <ReleaseNotesList :releases="pendingReleaseNotes" />
        </template>
        <a
          class="button button--quiet button--sm update-release-notes"
          :href="pendingReleaseUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <AppIcon name="popout" class="size-4" aria-hidden="true" />
          {{ t('machine.updates.releaseNotes', { version: pendingUpdate?.remote_version }) }}
        </a>
      </template>
    </ConfirmDialog>

    <UpdateRecoveryDialog
      :update="investigatingUpdate"
      :busy="machine.isUpdateManagerBusy"
      @reset="confirmRecovery"
      @close="investigating = null"
    />

    <ConfirmDialog
      :open="pendingRollback !== null"
      :title="
        t('machine.updates.rollbackConfirmTitle', { name: pendingRollback?.displayName ?? '' })
      "
      :description="t('machine.updates.rollbackConfirmDescription')"
      :confirm-label="t('machine.updates.rollback')"
      tone="danger"
      show-skip-option
      @confirm="confirmRollback"
      @cancel="cancelRollback"
      @skip="confirmations.setSkip('rollbackUpdate', true)"
    />
  </section>
</template>
