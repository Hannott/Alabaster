<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView } from 'vue-router'

import ActivityList from '@/components/ActivityList.vue'
import AlabasterMark from '@/components/AlabasterMark.vue'
import AppButton from '@/components/AppButton.vue'
import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'
import BedScrewsDialog from '@/components/BedScrewsDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import ManualProbeDialog from '@/components/ManualProbeDialog.vue'
import PrinterFaultNotice from '@/components/PrinterFaultNotice.vue'
import SaveConfigDialog from '@/components/SaveConfigDialog.vue'
import ToastStack from '@/components/ToastStack.vue'
import { useAvailability } from '@/composables/useAvailability'
import { useConsoleFont } from '@/composables/useConsoleFont'
import { useConsoleWeight } from '@/composables/useConsoleWeight'
import { useContextMenuGuard } from '@/composables/useContextMenuGuard'
import { useFont } from '@/composables/useFont'
import { useHiddenDestinations } from '@/composables/useHiddenDestinations'
import { useMinimalisticSidebar } from '@/composables/useMinimalisticSidebar'
import { useSelectValueOnFocus } from '@/composables/useSelectValueOnFocus'
import { useSidebar } from '@/composables/useSidebar'
import { useTheme } from '@/composables/useTheme'
import { useTextWeight } from '@/composables/useTextWeight'
import { useWakeLock } from '@/composables/useWakeLock'
import {
  isDestinationVisible,
  navigationDestinations,
  type NavigationDestination,
} from '@/navigation/destinations'
import { readPendingConfig } from '@/features/config/pendingConfig'
import { pagePrefetch } from '@/router/prefetch'
import { useAnnouncementsStore } from '@/stores/announcements'
import { useAuthStore } from '@/stores/auth'
import { useBedScrewsStore } from '@/stores/bedScrews'
import { useActionGuard } from '@/composables/useActionGuard'
import { useSettingsCategory } from '@/composables/useSettingsCategory'
import { useDevicePowerStore } from '@/stores/devicePower'
import { useMachineFilesStore } from '@/stores/machineFiles'
import { useManualProbeStore } from '@/stores/manualProbe'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrinterStore } from '@/stores/printer'
import { printerDisplayLabel, printerHost, usePrintersStore } from '@/stores/printers'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'
import { useServerWarningsStore, type ServerNotice } from '@/stores/serverWarnings'

const { t, locale } = useI18n({ useScope: 'global' })
// Only Settings reads the rest of this composable's return value, but the
// module-level effect that actually holds the lock has to be live from the
// moment the app boots, on whichever page that happens to be — not deferred
// until the reader first opens Settings.
useWakeLock()
// Same reasoning as the wake lock above: the chosen typeface has to apply to
// the whole document from boot, not only once Settings happens to be visited.
// The reactive handles are kept (rather than calling these for their side
// effect alone, as before) because the sidebar-width measurement below has to
// re-run on exactly the changes these two report.
const { fontId } = useFont()
const { mode: textWeightMode } = useTextWeight()
useConsoleFont()
useConsoleWeight()
const { isSidebarCollapsed, toggleSidebar } = useSidebar()
const { isMinimalisticSidebar } = useMinimalisticSidebar()
const { themePack } = useTheme()
const hiddenDestinations = useHiddenDestinations()
const { availability: printerAvailability, messageKey: printerAvailabilityMessageKey } =
  useAvailability('klipper')
const { availability: moonrakerAvailability } = useAvailability('moonraker')

/*
 * The status pill's label is collapsed by default and only reveals itself on
 * hover or focus (`.header-status__label` in main.css) -- but a status change
 * is exactly the moment nobody is hovering it yet it is most worth reading.
 * `status-flash` mirrors that reveal for `statusFlashDurationMs` after every
 * change to the reason, refreshing on each new one, so a reader who glances at
 * the header right after a reconnect sees the reason rather than only the dot.
 */
const statusFlashDurationMs = 5000
const isStatusFlashing = ref(false)
let statusFlashTimer: ReturnType<typeof window.setTimeout> | null = null

watch(
  () => printerAvailability.value.reason,
  () => {
    isStatusFlashing.value = true
    if (statusFlashTimer !== null) window.clearTimeout(statusFlashTimer)
    statusFlashTimer = window.setTimeout(() => {
      isStatusFlashing.value = false
      statusFlashTimer = null
    }, statusFlashDurationMs)
  },
)

onBeforeUnmount(() => {
  if (statusFlashTimer !== null) window.clearTimeout(statusFlashTimer)
})
const printer = usePrinterStore()
const auth = useAuthStore()
const devicePower = useDevicePowerStore()
const announcements = useAnnouncementsStore()
const machineFiles = useMachineFilesStore()
const manualProbe = useManualProbeStore()
const bedScrews = useBedScrewsStore()
const printerConfig = usePrinterConfigStore()
const printers = usePrintersStore()
const moonraker = useMoonrakerStore()

const serverCapabilities = useServerCapabilitiesStore()
const serverWarnings = useServerWarningsStore()

useContextMenuGuard()
useSelectValueOnFocus()

/*
 * Warm every page's module while the browser is idle, in rail order, so the
 * first visit to a destination costs no more than the second one. Deliberately
 * the whole list rather than `supportedDestinations`: capabilities arrive with
 * the connection, and waiting for them would start the warm-up at exactly the
 * moment the reader starts clicking. An unsupported page costs one small request
 * once; a cold page costs a click that appears to do nothing.
 */
onMounted(() => {
  pagePrefetch.warmAll(navigationDestinations.map((destination) => destination.name))
})

onBeforeUnmount(() => {
  pagePrefetch.cancel()
})

/*
 * Restarting Klipper and restarting the firmware were the two sharpest holes in
 * the whole button system: both end an active print outright, both fired on one
 * click, and both wore `quiet` -- the lowest-emphasis variant there is, meant
 * for menu entries and row chrome. Two items further down the same menu, behind
 * the same divider, Reboot and Shutdown were already `danger-quiet` and already
 * confirmed. Four entries in one menu, two of which killed a print silently and
 * looked like the quietest things on screen.
 *
 * They join the same mechanism, but as tier 3b rather than 3a: their whole
 * consequence is that a job is loaded. Against an idle machine a Klipper
 * restart is something you do ten times while editing `printer.cfg`, so the
 * dialog and the livery both arrive only when there is a print to lose.
 */
type ConfirmableAction =
  'emergencyStop' | 'rebootHost' | 'shutdownHost' | 'restartKlipper' | 'firmwareRestart'
const confirmingAction = ref<ConfirmableAction | null>(null)

// Optional-called, so an environment without matchMedia still animates
// rather than silently losing the motion — as dashboard/reveal.ts already does.
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

const estopIcon = ref<InstanceType<typeof AppIcon> | null>(null)

function estopIconSvg(): SVGSVGElement | undefined {
  return estopIcon.value?.$el as SVGSVGElement | undefined
}

/**
 * `emergencyStop`'s draw-in is SMIL (`<animate>`), not CSS, so it sits outside
 * main.css's blanket `prefers-reduced-motion` rule — that rule only collapses
 * `animation`/`transition` durations, a different mechanism than an SVG's own
 * SMIL timeline. Reduced motion is honoured by hand instead: parked at its
 * final frame on mount rather than left to play, and never rewound on hover
 * or focus.
 */
function replayEstopIcon(): void {
  if (prefersReducedMotion()) return
  estopIconSvg()?.setCurrentTime?.(0)
}

onMounted(() => {
  // 2s safely clears the animation's last frame (its final `<animate>` ends
  // at 1.7s), landing on the fully-drawn glyph instead of an empty one.
  if (prefersReducedMotion()) estopIconSvg()?.setCurrentTime?.(2)
})

const hasNotice = computed(
  () =>
    !printerAvailability.value.isAvailable ||
    printer.lastCommandError !== null ||
    announcements.hasEntries ||
    serverWarnings.hasNotices,
)

function serverWarningTitle(notice: ServerNotice): string {
  return notice.component
    ? t('header.notifications.componentFailedTitle', { component: notice.component })
    : t('header.notifications.warningTitle')
}

/**
 * A server configuration problem outranks every other reason the bell has
 * something to say: it is an active, fixable problem rather than a release
 * notice or a lifecycle state the header's own status pill already reports.
 * `bellNew` — the pre-existing dot-bell — is left to the conditions it always
 * covered (a lost connection, a failed command, an announcement) once no
 * server warning is present.
 */
const notificationIconName = computed<AppIconName>(() => {
  if (serverWarnings.hasUnread) return 'bellAlertTwotone'
  if (serverWarnings.hasNotices) return 'bellTwotone'
  return hasNotice.value ? 'bellNew' : 'bell'
})

const notificationBellIcon = ref<InstanceType<typeof AppIcon> | null>(null)

function notificationBellIconSvg(): SVGSVGElement | undefined {
  return notificationBellIcon.value?.$el as SVGSVGElement | undefined
}

/**
 * `bellAlertTwotone` is the one glyph in the product with a `repeatCount`
 * that never ends, so seeking past its draw-in with `setCurrentTime` (the
 * `emergencyStop` trick above) is not enough by itself — the loop would keep
 * advancing right past the point it was seeked to. `pauseAnimations` is the
 * SMIL call that actually freezes a timeline, SVG's equivalent of
 * `estopIconSvg`'s reduced-motion handling for a timeline that repeats
 * forever instead of playing once.
 */
function settleNotificationBellIcon(): void {
  if (!prefersReducedMotion()) return
  const svg = notificationBellIconSvg()
  svg?.setCurrentTime?.(2)
  svg?.pauseAnimations?.()
}

watch(notificationIconName, () => nextTick(settleNotificationBellIcon))
onMounted(settleNotificationBellIcon)

/** Which server warning, if any, has its "next reboot / never" choice open. */
const expandedWarningId = ref<string | null>(null)

function toggleWarningRemind(id: string): void {
  expandedWarningId.value = expandedWarningId.value === id ? null : id
}

function snoozeWarning(id: string): void {
  serverWarnings.snooze(id)
  if (expandedWarningId.value === id) expandedWarningId.value = null
}

function muteWarning(id: string): void {
  serverWarnings.mute(id)
  if (expandedWarningId.value === id) expandedWarningId.value = null
}

/**
 * The account shortcut, unlike the emergency stop, notifications, and power
 * beside it, has nothing to say on the overwhelming majority of printers —
 * `auth.info` only reports `login_required: true` once an operator has
 * deliberately configured `[authorization]`, and `auth.currentUser` is null
 * everywhere else. `auth.ts`'s own `start()` keeps both current from the
 * moment a connection exists, so this is accurate before the reader has ever
 * opened Settings.
 */
const showAccountLink = computed(
  () => auth.info?.login_required === true || auth.currentUser !== null,
)

const { setActiveCategory } = useSettingsCategory()

/** Jumps straight to the Users category rather than leaving Settings on whatever it last showed. */
function openAccountSettings(): void {
  setActiveCategory('users')
}

/** Jumps straight to the Printers category rather than leaving Settings on whatever it last showed. */
function openPrinterSettings(): void {
  setActiveCategory('printers')
}

/**
 * The rail renders every destination this machine can serve. The mobile bar
 * shows the few that earn a permanent cell at 390 px and the overflow menu holds
 * the rest — never a shorter list with the remainder dropped, which would leave
 * a shipped destination unreachable on a phone.
 */
const supportedDestinations = computed(() =>
  navigationDestinations.filter((destination) =>
    isDestinationVisible(
      destination,
      {
        hasRoot: (root) => serverCapabilities.hasRoot(root),
        hasComponent: (component) => serverCapabilities.hasComponent(component),
        hasConfigSection: (section) => printerConfig.hasSection(section),
        savedPrinters: printers.entries.length,
      },
      hiddenDestinations.hidden.value,
    ),
  ),
)

/*
 * The desktop rail's expanded widths in components.css used to be fixed rem
 * guesses sized against one label ("Utskriftsfiler") at the default typeface
 * and weight — so a wider font, a heavier weight, or a theme pack's own
 * label transform (Terminal renders nav labels bold, uppercase, and
 * letter-spaced) could all render text wider than the guess and clip it
 * against `.sidebar-nav-label`'s `overflow: hidden`. `--sidebar-label-width`
 * replaces the guess with the actual rendered width of the widest label, so
 * the CSS `max()` floor in components.css only ever grows the rail, never
 * shrinks it below today's calibrated minimum. `scrollWidth` reports a
 * label's true laid-out width regardless of the clipping that would
 * otherwise hide the overflow, because `white-space: nowrap` keeps it on one
 * line rather than wrapping into a smaller box.
 *
 * `.sidebar-measuring` (components.css) brackets the write: switching from
 * Public Sans to OpenDyslexic live (no reload) updates the custom property
 * correctly but otherwise leaves `.desktop-sidebar`'s rendered `inline-size`
 * pinned at whatever it last resolved to, clipping every label — Blink does
 * not re-resolve a `transition`-listed property's used value from a `var()`
 * dependency changing on its own, only from a matching class/attribute
 * change. Adding the class, forcing a synchronous layout with the new value
 * in effect, then removing the class makes the browser apply that value as a
 * plain style recalculation instead of a transition target that never gets
 * asked to move. This also matches AGENTS.md's general rule against
 * animating responsive geometry: a font/theme swap correcting the rail's
 * width is not the explicit collapse/expand action ADR 0004 sanctions
 * animating, so it should snap instead of ease regardless of the browser
 * quirk this works around.
 */
function measureSidebarLabelWidth(): void {
  const labels = document.querySelectorAll<HTMLElement>('.sidebar-nav-label')
  let widest = 0
  labels.forEach((label) => {
    if (label.scrollWidth > widest) widest = label.scrollWidth
  })
  const root = document.documentElement
  root.classList.add('sidebar-measuring')
  root.style.setProperty('--sidebar-label-width', `${widest}px`)
  void document.querySelector('.desktop-sidebar')?.getBoundingClientRect()
  root.classList.remove('sidebar-measuring')
}

/**
 * Deferred a tick so measurement runs after the label text that triggered it
 * has actually rendered, and again once `document.fonts.ready` resolves —
 * a freshly picked font is lazy-loaded (`ensureFontLoaded`) and the browser
 * still measures the fallback face until the real one finishes downloading.
 */
function scheduleSidebarLabelMeasure(): void {
  void nextTick(measureSidebarLabelWidth)
  void document.fonts.ready.then(measureSidebarLabelWidth)
}

onMounted(scheduleSidebarLabelMeasure)
watch(supportedDestinations, scheduleSidebarLabelMeasure)
watch(fontId, scheduleSidebarLabelMeasure)
watch(textWeightMode, scheduleSidebarLabelMeasure)
watch(themePack, scheduleSidebarLabelMeasure)
watch(locale, scheduleSidebarLabelMeasure)

/*
 * The desktop rail is itself `display: none` below the responsive breakpoint
 * (`.desktop-sidebar`, components.css), and a `display: none` ancestor zeroes
 * every descendant's layout measurements — so a reader who opens Alabaster in
 * a narrow window measures every label at `0`, same as an empty list. None of
 * the watchers above fire on a plain window resize, so widening back past the
 * breakpoint needs its own trigger or `--sidebar-label-width` stays parked at
 * that stale `0` and the rail silently falls back to its static floor.
 */
window.addEventListener('resize', scheduleSidebarLabelMeasure)
onBeforeUnmount(() => window.removeEventListener('resize', scheduleSidebarLabelMeasure))

const mobileBarDestinations = computed(() =>
  supportedDestinations.value.filter((destination) => destination.mobile === 'bar'),
)

const mobileOverflowDestinations = computed(() =>
  supportedDestinations.value.filter((destination) => destination.mobile === 'overflow'),
)

const sidebarLabel = computed(() =>
  isSidebarCollapsed.value ? t('navigation.expandSidebar') : t('navigation.collapseSidebar'),
)

function isUnsavedNavItem(item: NavigationDestination): boolean {
  return item.name === 'configuration' && machineFiles.hasUnsavedFiles
}

/** The link's full accessible name: its label, plus the unsaved flag when one is set. */
function navLinkName(item: NavigationDestination): string {
  const label = t(item.labelKey)
  return isUnsavedNavItem(item) ? `${label} — ${t('navigation.unsavedChanges')}` : label
}

function navLinkTitle(item: NavigationDestination): string | undefined {
  return isSidebarCollapsed.value ? navLinkName(item) : undefined
}

/** True when a destination the mobile bar does not show has unsaved work behind it. */
const hasUnsavedOverflowItem = computed(() =>
  mobileOverflowDestinations.value.some((destination) => isUnsavedNavItem(destination)),
)

const confirmDialogCopy = computed(() => {
  if (confirmingAction.value === 'rebootHost') {
    return {
      title: t('header.power.rebootHost'),
      description: t('header.power.rebootHostConfirm'),
      confirmLabel: t('header.power.rebootHost'),
    }
  }
  if (confirmingAction.value === 'shutdownHost') {
    return {
      title: t('header.power.shutdownHost'),
      description: t('header.power.shutdownHostConfirm'),
      confirmLabel: t('header.power.shutdownHost'),
    }
  }
  if (confirmingAction.value === 'restartKlipper') {
    return {
      title: t('header.power.restartKlipper'),
      description: t('header.power.restartKlipperConfirm'),
      confirmLabel: t('header.power.restartKlipper'),
    }
  }
  if (confirmingAction.value === 'firmwareRestart') {
    return {
      title: t('header.power.firmwareRestart'),
      description: t('header.power.firmwareRestartConfirm'),
      confirmLabel: t('header.power.firmwareRestart'),
    }
  }
  return {
    title: t('dashboard.emergencyStop'),
    description: t('dashboard.emergencyStopConfirm'),
    confirmLabel: t('dashboard.emergencyStopShort'),
  }
})

function performAction(action: ConfirmableAction): Promise<unknown> {
  if (action === 'rebootHost') return printer.rebootHost()
  if (action === 'shutdownHost') return printer.shutdownHost()
  if (action === 'restartKlipper') return printer.restartKlipper()
  if (action === 'firmwareRestart') return printer.firmwareRestart()
  return printer.emergencyStop()
}

/*
 * One guard per menu entry rather than one for the menu, because the tier is
 * per action: the three host-level ones are terminal whatever the printer is
 * doing, the two restarts only once a job is loaded, and restarting Moonraker
 * is not terminal at all -- it drops the socket while Klipper keeps printing,
 * which ADR 0002 already requires the interface to survive without a reload.
 * Marking that one terminal would teach the reader to distrust the signal.
 */
const printDerived = () =>
  printer.hasActivePrint ? ('terminal' as const) : ('reversible' as const)

const powerGuards = {
  emergencyStop: useActionGuard({ tier: 'terminal', key: 'emergencyStop' }),
  rebootHost: useActionGuard({ tier: 'terminal', emphasis: 'danger-quiet', key: 'rebootHost' }),
  shutdownHost: useActionGuard({
    tier: 'terminal',
    emphasis: 'danger-quiet',
    key: 'shutdownHost',
  }),
  restartKlipper: useActionGuard({
    tier: printDerived,
    emphasis: 'quiet',
    key: 'restartKlipper',
  }),
  firmwareRestart: useActionGuard({
    tier: printDerived,
    emphasis: 'quiet',
    key: 'firmwareRestart',
  }),
} as const

const restartMoonrakerGuard = useActionGuard({
  tier: () => (printer.hasActivePrint ? 'disruptive' : 'reversible'),
})

async function confirmPendingAction(): Promise<void> {
  const action = confirmingAction.value
  confirmingAction.value = null
  if (action) await performAction(action)
}

/** Opens the confirmation, or skips straight to the action if the user turned it off. */
function requestAction(action: ConfirmableAction): void {
  powerGuards[action].request(
    () => void performAction(action),
    () => (confirmingAction.value = action),
  )
}

/**
 * `machine.device_power.*` keeps working while Klipper is down — this is the
 * one control in the header power menu that only ever asks the state it
 * already has for the opposite of itself, never a bare "toggle", so a stale
 * read costs one more click rather than sending the command the wrong way.
 */
function toggleDevice(device: { device: string; status: string }): void {
  void devicePower.setDevice(device.device, device.status === 'on' ? 'off' : 'on')
}

/*
 * Writing the config is one printer-wide fact, so it gets one gate in the one
 * place that is always on screen.
 *
 * It used to be two buttons on two cards, each appearing only when *that*
 * surface had done the staging — so a mesh saved from Calibration staged a
 * change and offered nothing at all, and the same pending state was reported by
 * up to two cards and no page. `configfile.save_config_pending` is a fact about
 * the printer, not about a card.
 *
 * The button appears only while something is staged rather than sitting
 * permanently disabled: a header control that is dead most of the time is dead
 * chrome, and its presence here *is* the notice that something is waiting.
 */
const isSaveConfigOpen = ref(false)

const pendingConfigSections = computed(() =>
  readPendingConfig(printer.saveConfigPendingItems, printerConfig.settings),
)

/**
 * Driven by the subscribed flag rather than by the section list, so the button
 * still appears on a firmware that reports `save_config_pending` without the
 * items beside it — the list would be empty there, and offering no way to write
 * a change Klipper is holding is worse than offering one that cannot describe
 * itself.
 */
const hasPendingConfig = computed(() => printer.saveConfigPending)

function closeSaveConfig(): void {
  isSaveConfigOpen.value = false
}

/**
 * `SAVE_CONFIG` writes the file and restarts Klipper in one step — the restart
 * is not separable, see the dialog. The dialog closes first so the reconnect is
 * not happening behind a modal.
 */
async function saveConfig(): Promise<void> {
  isSaveConfigOpen.value = false
  await printer.saveConfig()
}

/**
 * Klipper has no command that unstages a pending block, so the only way to be
 * rid of one is to make it re-read `printer.cfg` from disk. A firmware restart
 * does that, and the button's own label says it restarts.
 */
async function discardPendingConfig(): Promise<void> {
  isSaveConfigOpen.value = false
  await printer.firmwareRestart()
}
</script>

<template>
  <a
    href="#main-content"
    class="fixed start-4 top-4 z-50 -translate-y-24 rounded-full bg-cta px-4 py-3 font-semibold text-on-action shadow-lg transition-transform focus:translate-y-0"
  >
    {{ t('app.skipToContent') }}
  </a>

  <div
    class="app-shell min-h-screen bg-canvas text-primary"
    :data-sidebar-collapsed="isSidebarCollapsed"
    :data-sidebar-minimal="isMinimalisticSidebar"
  >
    <aside class="desktop-sidebar border-e border-subtle bg-raised p-7 text-primary">
      <div class="brand-grid" aria-hidden="true"></div>

      <div v-if="!isMinimalisticSidebar" class="sidebar-brand relative flex items-center gap-3">
        <AlabasterMark class="size-11" />
        <div class="sidebar-copy">
          <p class="text-xl font-black tracking-[-0.04em]">{{ t('app.name') }}</p>
        </div>
      </div>

      <nav
        id="desktop-primary-navigation"
        class="sidebar-navigation relative mt-8"
        :aria-label="t('navigation.label')"
      >
        <ol class="space-y-2">
          <li v-for="item in supportedDestinations" :key="item.name">
            <RouterLink
              :to="{ name: item.name }"
              class="button button--quiet button--start button--block sidebar-nav-link group relative"
              :class="{ 'nav-link--unsaved button--badged': isUnsavedNavItem(item) }"
              :title="navLinkTitle(item)"
              @pointerenter="pagePrefetch.prefetch(item.name)"
              @focus="pagePrefetch.prefetch(item.name)"
            >
              <AppIcon
                :name="item.icon"
                class="size-5 shrink-0"
                :class="
                  isUnsavedNavItem(item)
                    ? 'text-caution-text'
                    : 'text-muted group-[.router-link-active]:text-action'
                "
                aria-hidden="true"
              />
              <span class="sidebar-nav-label">
                {{ t(item.labelKey) }}
                <span v-if="isUnsavedNavItem(item)" class="sr-only">
                  — {{ t('navigation.unsavedChanges') }}
                </span>
              </span>
            </RouterLink>
          </li>
        </ol>
      </nav>

      <AppButton
        icon-only
        :icon="isSidebarCollapsed ? 'sidebarExpand' : 'sidebarCollapse'"
        class="sidebar-toggle relative mt-auto shrink-0 self-start"
        :aria-label="sidebarLabel"
        :aria-expanded="!isSidebarCollapsed"
        aria-controls="desktop-primary-navigation"
        :title="sidebarLabel"
        @click="toggleSidebar"
      />
    </aside>

    <div class="app-content min-w-0 flex-1">
      <header
        class="app-header sticky top-0 z-30 flex min-h-20 items-center justify-between gap-3 border-b border-subtle bg-canvas-glass px-4 backdrop-blur-xl sm:px-6 lg:px-10"
      >
        <div class="header-identity flex min-w-0 items-center gap-3">
          <AlabasterMark :label="t('app.name')" class="mobile-brand size-9 shrink-0" />
          <div class="min-w-0">
            <p class="text-eyebrow text-muted">
              {{ t('header.printerLabel') }}
            </p>
            <div class="flex min-w-0 items-center gap-2">
              <p class="truncate text-sm font-weight-base sm:text-base">
                {{ printer.printerName || t('header.printerName') }}
              </p>
              <HeaderMenu
                class="shrink-0"
                :label="t('header.printers.label')"
                align="start"
                trigger-variant="quiet"
                trigger-size="xs"
                trigger-icon-only
              >
                <template #trigger>
                  <AppIcon name="down" class="size-4" aria-hidden="true" />
                </template>
                <template #default="{ close }">
                  <p class="header-menu__section-title">{{ t('header.printers.title') }}</p>
                  <ul class="grid gap-0.5">
                    <li v-for="entry in printers.entries" :key="entry.id">
                      <AppButton
                        variant="quiet"
                        size="sm"
                        start
                        block
                        :aria-current="entry.id === printers.activeId ? 'true' : undefined"
                        @click="
                          () => {
                            close()
                            moonraker.selectPrinter(entry.id)
                          }
                        "
                      >
                        <AppIcon
                          :name="entry.id === printers.activeId ? 'print' : 'globe'"
                          class="size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span class="min-w-0 flex-1 text-start">
                          <strong class="block truncate">{{ printerDisplayLabel(entry) }}</strong>
                          <span
                            v-if="printerDisplayLabel(entry) !== printerHost(entry.endpoint)"
                            class="block truncate text-[0.68rem] font-medium text-muted"
                            >{{ printerHost(entry.endpoint) }}</span
                          >
                        </span>
                      </AppButton>
                    </li>
                  </ul>
                  <div class="header-menu__divider" role="none"></div>
                  <RouterLink
                    :to="{ name: 'settings' }"
                    class="button button--quiet button--sm button--start button--block"
                    @click="
                      () => {
                        close()
                        openPrinterSettings()
                      }
                    "
                  >
                    <AppIcon name="add" class="size-4" aria-hidden="true" />
                    {{ t('header.printers.manage') }}
                  </RouterLink>
                </template>
              </HeaderMenu>
              <div
                class="header-status text-xs font-semibold"
                :class="{ 'header-status--flash': isStatusFlashing }"
                role="status"
                tabindex="0"
                :aria-label="`${t('status.label')}: ${t(printerAvailabilityMessageKey)}`"
              >
                <span
                  class="status-mark"
                  :class="`status-mark--${printerAvailability.phase}`"
                  aria-hidden="true"
                ></span>
                <span class="header-status__label" aria-hidden="true">{{
                  t(printerAvailabilityMessageKey)
                }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="header-actions">
          <!--
            One gate for writing the config, in the one place always on screen.
            Shown only while Klipper is holding changes: a permanently disabled
            header control is dead chrome, and its presence here is itself the
            notice that something is waiting to be written. Nothing else in
            the interface can write the config, so it stays at every width.

            `primary`, which is this system's variant for "the one action a
            surface exists to perform: Save, Print, Apply", and the header has no
            other. A caution tint was the first idea and is not available: it
            would put a `--status-caution-text` label on a translucent tint of
            its own hue, which is the exact convergence `button-system.md`
            measured at 3.3:1 and rejected when it made `danger` an outline
            variant.

            Icon and text, like the stop beside it: this is the only route to
            writing the config, and a lone glyph is a poor way to name an action
            nothing else in the interface offers. It fits because the row is
            allowed to wrap at phone widths — see `.header-actions`.
          -->
          <!--
            The way back into a manual probe that has been put aside, and the
            only notice that one is waiting at all. Same reasoning as the save
            gate below it: a probe holds the machine still until someone answers
            it, and its presence in the one place always on screen is itself the
            notice. Gone the instant the probe ends, from here or anywhere else.

            Neutral, not `primary` — the save gate already holds this surface's
            one primary, and both can be present at once: staging a probe offset
            and then running another calibration is an ordinary evening.
          -->
          <AppButton
            v-if="manualProbe.isActive"
            size="sm"
            icon-lg
            :title="t('manualProbe.openTitle')"
            @click="manualProbe.reopen()"
          >
            <AppIcon name="probe" class="size-5" aria-hidden="true" />
            {{ t('manualProbe.open') }}
          </AppButton>
          <!--
            The same gate for a bed-screw round that has been put aside. A
            separate control rather than one shared "a procedure is waiting"
            button: the two helpers are different waits with different answers,
            they can be told apart at a glance only by saying which, and Klipper
            can only ever have one of them running — so the pair never both
            appear and the row never grows by two.
          -->
          <AppButton
            v-if="bedScrews.isActive"
            size="sm"
            icon-lg
            :title="t('bedScrews.openTitle')"
            @click="bedScrews.reopen()"
          >
            <AppIcon name="maintenance" class="size-5" aria-hidden="true" />
            {{ t('bedScrews.open') }}
          </AppButton>
          <AppButton
            v-if="hasPendingConfig"
            variant="primary"
            size="sm"
            icon-lg
            :pending="printer.pendingCommands.saveConfig"
            :title="t('saveConfig.open')"
            @click="isSaveConfigOpen = true"
          >
            <AppIcon name="save" class="size-5" aria-hidden="true" />
            {{ t('saveConfig.open') }}
          </AppButton>
          <!--
            The notice that a saved config file has not taken effect yet, and the
            action that applies it — one control, for the same reason the save
            gate above is one: a header control that is only ever a notice is
            chrome you cannot act on, and the action is the only thing anyone
            wants once they have read it.

            It exists because saving is not applying. `printer.cfg` on disk
            changes the moment Save finishes, and Klipper runs the config it
            loaded at startup until a firmware restart — while the editor's own
            "Save and restart" disables itself the instant the buffer is clean.
            So the state right after a plain Save had nothing anywhere saying the
            change was not live, which is how a value gets edited, saved, and then
            measured against a printer still running the old one.

            Neutral, not `primary`: the save gate holds this surface's one
            primary, and both can be present at once — Klipper holding staged
            values and a file waiting for a restart are different waits. It reuses
            the power menu's own `firmwareRestart` guard rather than declaring a
            second one, so the confirmation, the tier that resolves to terminal
            only while a print is running, and the variant are all decided once.
          -->
          <AppButton
            v-if="machineFiles.hasUnappliedConfigChanges"
            size="sm"
            icon-lg
            :guard="powerGuards.firmwareRestart"
            :pending="printer.pendingCommands.firmwareRestart"
            :disabled="
              !moonrakerAvailability.isAvailable || printer.pendingCommands.firmwareRestart
            "
            :title="t('header.applyConfig.title')"
            @click="requestAction('firmwareRestart')"
          >
            <AppIcon name="refresh" class="size-5" aria-hidden="true" />
            {{ t('header.applyConfig.label') }}
          </AppButton>
          <!--
            Text, not a button — outlier 1 in button-system.md. The one control
            that has to be found before it is read, so shape (all caps, the
            brake-alert glyph) and a fixed danger colour carry that instead of
            button chrome. Still a real `<button>` for click, keyboard, and
            `:disabled`; named in full rather than abbreviated to "Stop" for the
            same reason as before — the row wraps now, so there is no width to
            buy back by shortening the most consequential label in the product.
          -->
          <button
            type="button"
            class="header-estop"
            :disabled="!printerAvailability.isAvailable || printer.pendingCommands.emergencyStop"
            :data-pending="printer.pendingCommands.emergencyStop ? 'true' : undefined"
            :title="t('dashboard.emergencyStop')"
            @click="requestAction('emergencyStop')"
            @mouseenter="replayEstopIcon"
            @focus="replayEstopIcon"
          >
            <AppIcon ref="estopIcon" name="emergencyStop" class="size-6" aria-hidden="true" />
            {{ t('dashboard.emergencyStop') }}
          </button>

          <HeaderMenu
            :label="t('header.notifications.label')"
            align="end"
            trigger-variant="quiet"
            trigger-size="md"
            trigger-icon-only
            trigger-class="header-icon"
            @open="serverWarnings.markRead()"
          >
            <template #trigger>
              <AppIcon
                ref="notificationBellIcon"
                :name="notificationIconName"
                class="size-6"
                aria-hidden="true"
              />
            </template>
            <template #default>
              <!--
                `server.info`'s failed_components and warnings — a component
                Moonraker could not load, most often a sensor or macro
                referencing a section nobody configured. First in the menu:
                unlike an announcement or activity entry, this is an active
                configuration problem, not something read once and skimmed.
              -->
              <template v-if="serverWarnings.hasNotices">
                <p class="header-menu__section-title">
                  {{ t('header.notifications.warningsTitle') }}
                </p>
                <ul class="grid gap-1">
                  <li
                    v-for="notice in serverWarnings.visibleNotices"
                    :key="notice.id"
                    class="header-notice-row header-notice-row--high"
                  >
                    <AppIcon
                      name="warning"
                      class="size-4 shrink-0 text-caution-text"
                      aria-hidden="true"
                    />
                    <div class="min-w-0 flex-1">
                      <strong class="block truncate text-xs">{{
                        serverWarningTitle(notice)
                      }}</strong>
                      <span class="mt-0.5 block text-[0.68rem] text-muted">{{
                        notice.message
                      }}</span>
                      <!--
                        Mainsail's own shape for this exact choice: a label and
                        two `xs` buttons in place of a second floating popover
                        stacked on top of the one already open.
                      -->
                      <div
                        v-if="expandedWarningId === notice.id"
                        class="mt-1 flex flex-wrap items-center gap-1"
                      >
                        <span class="text-[0.68rem] text-muted">{{
                          t('header.notifications.remindLabel')
                        }}</span>
                        <AppButton
                          variant="quiet"
                          size="xs"
                          :label="t('header.notifications.remindNextReboot')"
                          @click="snoozeWarning(notice.id)"
                        />
                        <AppButton
                          variant="quiet"
                          size="xs"
                          :label="t('header.notifications.remindNever')"
                          @click="muteWarning(notice.id)"
                        />
                      </div>
                    </div>
                    <AppButton
                      variant="quiet"
                      size="xs"
                      icon-only
                      icon="bellSlash"
                      class="shrink-0"
                      :aria-expanded="expandedWarningId === notice.id"
                      :aria-label="
                        t('header.notifications.remind', { title: serverWarningTitle(notice) })
                      "
                      :title="
                        t('header.notifications.remind', { title: serverWarningTitle(notice) })
                      "
                      @click="toggleWarningRemind(notice.id)"
                    />
                  </li>
                </ul>
                <p class="header-menu__divider" role="separator"></p>
              </template>
              <!--
                Moonraker/Klipper/component release notices — the header
                notice docs/design/navigation-plan.md names as a real gap.
                Above the activity feed: an announcement is something to act
                on (read, dismiss), the activity feed is something to skim.
              -->
              <template v-if="announcements.hasEntries">
                <p class="header-menu__section-title">
                  {{ t('header.notifications.announcementsTitle') }}
                </p>
                <ul class="grid gap-1">
                  <li
                    v-for="entry in announcements.entries"
                    :key="entry.entry_id"
                    class="header-notice-row"
                    :class="{ 'header-notice-row--high': entry.priority === 'high' }"
                  >
                    <AppIcon
                      v-if="entry.priority === 'high'"
                      name="warning"
                      class="size-4 shrink-0 text-caution-text"
                      aria-hidden="true"
                    />
                    <div class="min-w-0 flex-1">
                      <span v-if="entry.priority === 'high'" class="sr-only">
                        {{ t('header.notifications.highPriority') }}
                      </span>
                      <a
                        v-if="entry.url"
                        :href="entry.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-action block truncate text-xs font-black"
                      >
                        {{ entry.title }}
                      </a>
                      <strong v-else class="block truncate text-xs">{{ entry.title }}</strong>
                      <span v-if="entry.description" class="mt-0.5 block text-[0.68rem] text-muted">
                        {{ entry.description }}
                      </span>
                    </div>
                    <AppButton
                      variant="quiet"
                      size="xs"
                      icon-only
                      icon="close"
                      class="shrink-0"
                      :disabled="announcements.dismissingIds.has(entry.entry_id)"
                      :aria-label="t('header.notifications.dismiss', { title: entry.title })"
                      :title="t('header.notifications.dismiss', { title: entry.title })"
                      @click="announcements.dismiss(entry.entry_id)"
                    />
                  </li>
                </ul>
                <p class="header-menu__divider" role="separator"></p>
              </template>
              <p class="header-menu__section-title">{{ t('header.notifications.title') }}</p>
              <ActivityList variant="menu" />
            </template>
          </HeaderMenu>

          <!--
            A direct link, not a menu: unlike notifications and power, there is
            nothing to choose between, only Settings' Users category to jump
            to. Hidden on the overwhelming majority of printers that never
            configure `[authorization]` — see `showAccountLink` for the two
            conditions that bring it back.
          -->
          <RouterLink
            v-if="showAccountLink"
            :to="{ name: 'settings' }"
            class="button button--quiet button--icon header-icon"
            :aria-label="t('header.account.label')"
            :title="t('header.account.label')"
            @click="openAccountSettings"
          >
            <AppIcon name="user" class="size-5" aria-hidden="true" />
          </RouterLink>

          <HeaderMenu
            :label="t('header.power.label')"
            align="end"
            trigger-variant="quiet"
            trigger-size="md"
            trigger-icon-only
            trigger-class="header-icon"
          >
            <template #trigger>
              <AppIcon name="power" class="size-6" aria-hidden="true" />
            </template>
            <template #default="{ close }">
              <p class="header-menu__section-title">{{ t('header.power.klipperControl') }}</p>
              <AppButton
                size="sm"
                start
                block
                :guard="powerGuards.restartKlipper"
                icon="refresh"
                :label="t('header.power.restartKlipper')"
                :disabled="
                  !moonrakerAvailability.isAvailable || printer.pendingCommands.restartKlipper
                "
                @click="
                  () => {
                    requestAction('restartKlipper')
                    close()
                  }
                "
              />
              <AppButton
                size="sm"
                start
                block
                :guard="powerGuards.firmwareRestart"
                icon="refresh"
                :label="t('header.power.firmwareRestart')"
                :disabled="
                  !moonrakerAvailability.isAvailable || printer.pendingCommands.firmwareRestart
                "
                @click="
                  () => {
                    requestAction('firmwareRestart')
                    close()
                  }
                "
              />

              <p class="header-menu__divider" role="separator"></p>
              <p class="header-menu__section-title">{{ t('header.power.serviceControl') }}</p>
              <AppButton
                size="sm"
                start
                block
                :guard="restartMoonrakerGuard"
                icon="refresh"
                :label="t('header.power.restartMoonraker')"
                :disabled="
                  !moonrakerAvailability.isAvailable || printer.pendingCommands.restartMoonraker
                "
                @click="
                  () => {
                    printer.restartMoonraker()
                    close()
                  }
                "
              />

              <p class="header-menu__divider" role="separator"></p>
              <p class="header-menu__section-title">{{ t('header.power.hostControl') }}</p>
              <AppButton
                variant="danger-quiet"
                size="sm"
                start
                block
                icon="power"
                :label="t('header.power.rebootHost')"
                :disabled="!moonrakerAvailability.isAvailable"
                @click="
                  () => {
                    requestAction('rebootHost')
                    close()
                  }
                "
              />
              <AppButton
                variant="danger-quiet"
                size="sm"
                start
                block
                icon="power"
                :label="t('header.power.shutdownHost')"
                :disabled="!moonrakerAvailability.isAvailable"
                @click="
                  () => {
                    requestAction('shutdownHost')
                    close()
                  }
                "
              />

              <!--
                Auxiliary switches — a PSU relay, an enclosure light — live here
                rather than on the dashboard: `machine.device_power.*` keeps
                answering while Klipper is down, which is exactly when a user
                reaches for it, and a `klipper`-gated module would be unavailable
                at that moment. See docs/design/navigation-plan.md.
              -->
              <template v-if="devicePower.hasDevices">
                <p class="header-menu__divider" role="separator"></p>
                <p class="header-menu__section-title">{{ t('header.power.devicePower') }}</p>
                <AppButton
                  v-for="device in devicePower.devices"
                  :key="device.device"
                  size="sm"
                  start
                  block
                  :variant="device.status === 'on' ? 'danger-quiet' : 'quiet'"
                  icon="power"
                  :label="
                    device.status === 'on'
                      ? t('header.power.turnDeviceOff', { name: device.device })
                      : t('header.power.turnDeviceOn', { name: device.device })
                  "
                  :disabled="
                    !moonrakerAvailability.isAvailable ||
                    devicePower.pendingDevices.has(device.device) ||
                    (device.locked_while_printing && printer.hasActivePrint)
                  "
                  :title="
                    device.locked_while_printing && printer.hasActivePrint
                      ? t('header.power.deviceLockedWhilePrinting')
                      : undefined
                  "
                  @click="toggleDevice(device)"
                />
              </template>
            </template>
          </HeaderMenu>
        </div>
      </header>

      <main id="main-content" class="app-main w-full">
        <!--
          Above the routed page and inside the same column, so a printer that
          failed to boot explains itself on whichever destination the reader is
          on. One instance for the whole application — see the component for why
          this is not a card on the dashboard.
        -->
        <PrinterFaultNotice />
        <div class="route-stage">
          <RouterView v-slot="{ Component, route }">
            <Transition name="route-view" appear>
              <component :is="Component" :key="route.fullPath" />
            </Transition>
          </RouterView>
        </div>
      </main>

      <nav
        class="mobile-navigation fixed inset-x-3 bottom-3 z-40 rounded-3xl border border-subtle bg-canvas-glass p-2 shadow-xl backdrop-blur-xl"
        :aria-label="t('navigation.label')"
      >
        <!--
          Icon-only cells: the name travels as `title` plus an sr-only span
          rather than visible text, because a visible label costs the one axis
          a phone is short on — "Print files" wrapped to two lines and, in a
          grid whose cells stretch to the tallest, grew the whole bar to match.
          The icons are not carrying meaning alone: every cell keeps its full
          localized name for assistive technology and for hover at the narrow
          desktop widths that also show this bar.
        -->
        <ul class="grid grid-cols-5 gap-1">
          <li v-for="item in mobileBarDestinations" :key="item.name">
            <RouterLink
              :to="{ name: item.name }"
              class="button button--quiet button--block mobile-nav-link"
              :class="{ 'nav-link--unsaved button--badged': isUnsavedNavItem(item) }"
              :title="navLinkName(item)"
              @pointerenter="pagePrefetch.prefetch(item.name)"
              @focus="pagePrefetch.prefetch(item.name)"
            >
              <AppIcon :name="item.icon" class="size-5" aria-hidden="true" />
              <span class="sr-only">{{ navLinkName(item) }}</span>
            </RouterLink>
          </li>
          <li v-if="mobileOverflowDestinations.length > 0">
            <HeaderMenu
              class="w-full"
              :label="t('navigation.more')"
              align="end"
              placement="above"
              trigger-variant="quiet"
              trigger-size="md"
              trigger-block
              trigger-class="mobile-nav-link"
              :badge="hasUnsavedOverflowItem"
            >
              <template #trigger>
                <AppIcon name="more" class="size-5" aria-hidden="true" />
              </template>
              <template #default="{ close }">
                <RouterLink
                  v-for="item in mobileOverflowDestinations"
                  :key="item.name"
                  :to="{ name: item.name }"
                  class="button button--quiet button--sm button--start button--block"
                  :class="{ 'nav-link--unsaved': isUnsavedNavItem(item) }"
                  @pointerenter="pagePrefetch.prefetch(item.name)"
                  @focus="pagePrefetch.prefetch(item.name)"
                  @click="close"
                >
                  <AppIcon :name="item.icon" class="size-4 shrink-0" aria-hidden="true" />
                  {{ t(item.labelKey) }}
                  <span v-if="isUnsavedNavItem(item)" class="sr-only">
                    — {{ t('navigation.unsavedChanges') }}
                  </span>
                </RouterLink>
              </template>
            </HeaderMenu>
          </li>
        </ul>
      </nav>
    </div>

    <ConfirmDialog
      :open="confirmingAction !== null"
      :title="confirmDialogCopy.title"
      :description="confirmDialogCopy.description"
      :confirm-label="confirmDialogCopy.confirmLabel"
      tone="danger"
      @confirm="confirmPendingAction"
      @cancel="confirmingAction = null"
    />

    <SaveConfigDialog
      :open="isSaveConfigOpen"
      :sections="pendingConfigSections"
      :busy="printer.pendingCommands.saveConfig || printer.pendingCommands.firmwareRestart"
      :is-printing="printer.isPrinting"
      @save="saveConfig"
      @discard="discardPendingConfig"
      @close="closeSaveConfig"
    />

    <!--
      Mounted here rather than on any page: a manual probe can be started from
      the console, a macro button, another browser, or the printer's own screen,
      and it holds the machine still wherever the user happens to be looking.
      It opens itself off the subscribed object, so it needs no `open` prop.
    -->
    <ManualProbeDialog />
    <BedScrewsDialog />

    <ToastStack />
  </div>
</template>
