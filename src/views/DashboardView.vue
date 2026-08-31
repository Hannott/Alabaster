<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import DashboardModuleCard from '@/components/dashboard/DashboardModuleCard.vue'
import DashboardModuleHost from '@/components/dashboard/DashboardModuleHost.vue'
import DashboardModulePlaceholder from '@/components/dashboard/DashboardModulePlaceholder.vue'
import SettingsSurface from '@/components/dashboard/SettingsSurface.vue'
import PageHeading from '@/components/PageHeading.vue'
import type { PageHeadingAction } from '@/components/PageHeading.vue'
import { useDashboardCardDrag } from '@/composables/useDashboardCardDrag'
import { useDashboardViewport } from '@/composables/useDashboardViewport'
import {
  columnCountFor,
  columnWidthFractions,
  columnWidthUnits,
  dashboardColumnWidthNames,
  movePlacement,
  visibleIndexOf,
  type DashboardColumnWidth,
  type DashboardDropTarget,
  type DashboardViewport,
} from '@/dashboard/layout'
import { dashboardPresetIds, type DashboardPresetId } from '@/dashboard/presets'
import { moveCard } from '@/dashboard/cardMove'
import { moduleHasQuickSettings } from '@/dashboard/quickSettings'
import { dashboardModulesById, type DashboardModuleDefinition } from '@/dashboard/registry'
import { findDashboardCardElement } from '@/dashboard/reveal'
import { useDashboardLayoutStore, type RenderedDashboardInstance } from '@/stores/dashboardLayout'
import { usePrintersStore } from '@/stores/printers'
import { useServerCapabilitiesStore } from '@/stores/serverCapabilities'

interface RenderedDashboardModule extends RenderedDashboardInstance {
  definition: DashboardModuleDefinition
}

const { t } = useI18n({ useScope: 'global' })
const printers = usePrintersStore()
const layout = useDashboardLayoutStore()
const serverCapabilities = useServerCapabilitiesStore()
const { viewport: activeViewport } = useDashboardViewport()
const editing = ref(false)
const selectedViewport = ref<DashboardViewport>(activeViewport.value)
const openSettings = ref<string | null>(null)
/**
 * Which module's dialog and pane are open — set the instant `openSurface` is
 * called and cleared the instant `closeSurface`'s card starts its journey
 * home, on both ends slightly wider than `dockedInstance` below. Without its
 * own ref the dialog only opened once the card had already finished fading
 * out of the dashboard (`dockedInstance` was gated behind that), so the
 * backdrop and the pane both sat out that whole fade-out doing nothing instead
 * of starting the instant the gear was clicked.
 */
const surfaceOpenInstanceId = ref<string | null>(null)
/** Which card Teleport currently targets — physically where the card is. */
const dockedInstance = ref<string | null>(null)
/**
 * The card whose **dashboard slot** is showing its empty shell — one ghost,
 * in one place, for the whole round trip. It goes up before the card starts
 * fading out of its column and comes down only once the card has finished
 * fading back in there, so the card fades out onto it and back in over it and
 * it never itself appears or disappears while anyone is looking at that slot.
 *
 * That is the entire effect: with the shell already behind it, a card fading
 * out reads as its *contents* dissolving rather than as the whole module
 * going. Wider than `dockedInstance` at both ends, which only says where the
 * card physically is.
 *
 * There is deliberately no counterpart in the dock. A shell where the card
 * fades *in* is a second box appearing under it for the length of the fade,
 * which blinks.
 */
const ghostInstanceId = ref<string | null>(null)
/** Measured from the card in its column, so the dock never imposes a size. */
const dockedHeight = ref(0)
const dockedWidth = ref<number | null>(null)
const surface = ref<InstanceType<typeof SettingsSurface> | null>(null)
const surfaceDock = computed<HTMLElement | null>(() => surface.value?.dock ?? null)
const viewportWidth = ref(window.innerWidth)
/** The page scrolls, not the app shell — so this is what a drag auto-scrolls. */
const page = ref<HTMLElement | null>(null)

/**
 * The settings pane's readable measure, plus the surface's own padding and the
 * gap. The dock takes the card's width, so a card from a single-column
 * dashboard can be wider than the room left over — without a floor the pane is
 * what gets squeezed, which left it at 252px against a 942px card in review.
 */
const paneMinimumPx = 26 * 16
const surfaceChromePx = 3 * 16

/*
 * Whether the pair fits is not a question of viewport width alone: it depends
 * on how wide this particular card is. Measuring the real condition rather
 * than guessing a breakpoint means a wide card stacks even on a large screen,
 * which a media query could never express.
 */
const surfaceStacked = computed(
  () =>
    dockedWidth.value === null ||
    dockedWidth.value + paneMinimumPx + surfaceChromePx > viewportWidth.value,
)

watch(
  () => printers.activeScopeKeys,
  (scopeKeys) => layout.selectPrinterScope(scopeKeys),
  { immediate: true },
)
watch(activeViewport, (viewport) => {
  if (!editing.value) selectedViewport.value = viewport
})

const displayedViewport = computed(() =>
  editing.value ? selectedViewport.value : activeViewport.value,
)
const columnCount = computed(() => columnCountFor(displayedViewport.value))
const columnWidths = computed(() => layout.columnWidthsFor(selectedViewport.value))
/** Which column the width picker is currently pointed at. */
const selectedColumn = ref(0)
watch([selectedViewport, editing], () => {
  selectedColumn.value = 0
})

/** The smallest the width picker lets one of its segments get. */
const rulerSegmentMinimum = '1.75rem'

function trackTemplate(widths: DashboardColumnWidth[], viewport: DashboardViewport): string {
  return columnWidthFractions(widths, viewport)
    .map((fraction) => `${fraction}fr`)
    .join(' ')
}

const columnTemplate = computed(() =>
  trackTemplate(layout.columnWidthsFor(displayedViewport.value), displayedViewport.value),
)
/*
 * The cap, in normal-column widths. The grid multiplies it by
 * `--dashboard-column-width` and stops there, so a row of narrow columns keeps
 * its own modest total instead of stretching to whatever three columns of any
 * width would have filled — which is the difference between a narrow column and
 * a column that is merely narrower than its neighbour.
 */
const columnUnits = computed(() =>
  columnWidthUnits(layout.columnWidthsFor(displayedViewport.value), displayedViewport.value),
)
/**
 * The picker's own track, mirroring the real grid so it reads as a scale model.
 *
 * Its own floor, not the grid's: at the picker's fixed width a narrow column
 * beside two wide ones works out to under 24px, which is the target size this
 * project commits to. The floor costs the most extreme pairing a little of its
 * proportion and keeps every segment pressable; the dashboard behind it is
 * showing the true geometry either way.
 */
const rulerTemplate = computed(() =>
  columnWidthFractions(columnWidths.value, selectedViewport.value)
    .map((fraction) => `minmax(${rulerSegmentMinimum}, ${fraction}fr)`)
    .join(' '),
)
/*
 * Found in the document rather than held as template refs: the columns are
 * TransitionGroups, whose ref is a component instance rather than the element
 * the cards are laid out in, and a stale entry here would silently stop being
 * a drop target.
 */
function columnElements(): (HTMLElement | null)[] {
  return Array.from({ length: columnCount.value }, (_, index) =>
    document.querySelector<HTMLElement>(`[data-dashboard-column="${index}"]`),
  )
}

const drag = useDashboardCardDrag({
  columns: columnElements,
  scroller: () => page.value,
  origin: (instanceId) => {
    const committed = layout.profile.placements[displayedViewport.value]
    const placement = committed.find((candidate) => candidate.instanceId === instanceId)
    return { column: placement?.column ?? 0, index: visibleIndexOf(committed, instanceId) }
  },
  commit: (instanceId, target: DashboardDropTarget) =>
    layout.moveTo(displayedViewport.value, instanceId, target),
})

/**
 * The committed order with the drag's prospective move already applied — the
 * same call the drop itself makes, so what the columns show mid-drag is the
 * result rather than a guess at it. Nothing is written until the pointer is
 * released, which is what makes Escape a free cancel and keeps a drag across
 * eight cards from persisting the profile eight times.
 */
const previewPlacements = computed(() => {
  const committed = layout.profile.placements[displayedViewport.value]
  const dragged = drag.instanceId.value
  const slot = drag.target.value
  if (!dragged || !slot) return committed
  return movePlacement(committed, displayedViewport.value, dragged, slot)
})

const renderedModules = computed<RenderedDashboardModule[]>(() => {
  const instances = new Map(
    layout.itemsFor(displayedViewport.value).map((item) => [item.instance.instanceId, item]),
  )
  return previewPlacements.value.flatMap((placement) => {
    const item = instances.get(placement.instanceId)
    const definition = item && dashboardModulesById.get(item.instance.moduleId)
    if (!item || !definition) return []
    // A module built around a component this printer's Moonraker never
    // reported is excluded from the render list only — never from `instances`,
    // which stays capability-blind so the card comes back with its
    // configuration intact if the component shows up later. See ADR 0006.
    if (
      definition.requiresComponent &&
      !serverCapabilities.hasComponent(definition.requiresComponent)
    ) {
      return []
    }
    // The placement is the preview's, the instance is the store's: only order,
    // column, and nothing else can differ between the two.
    return [{ instance: item.instance, placement, definition }]
  })
})
const visibleModules = computed(() =>
  renderedModules.value.filter((item) => item.placement.visible),
)
const hiddenModules = computed(() =>
  renderedModules.value.filter((item) => !item.placement.visible),
)
const visibleColumns = computed<RenderedDashboardModule[][]>(() => {
  const count = columnCount.value
  const groups: RenderedDashboardModule[][] = Array.from({ length: count }, () => [])
  for (const item of visibleModules.value) {
    const column = Math.min(count - 1, Math.max(0, item.placement.column))
    groups[column]?.push(item)
  }
  return groups
})

function moduleTitle(item: RenderedDashboardModule): string {
  return item.instance.title ?? t(item.definition.titleKey)
}

function toggleEditing(): void {
  editing.value = !editing.value
  if (editing.value) {
    selectedViewport.value = activeViewport.value
    openSettings.value = null
    // Layout editing rearranges the very column the card would return to.
    closeSurface()
  }
}

const customizeAction = computed<PageHeadingAction>(() => ({
  label: editing.value ? t('dashboard.layout.done') : t('dashboard.layout.customize'),
  icon: 'customize',
  onClick: toggleEditing,
  pressed: editing.value,
}))

/** The ghost's own content, resolved once here rather than in the template. */
const draggedGhost = computed(() => {
  const position = drag.ghost.value
  const item = renderedModules.value.find(
    (candidate) => candidate.instance.instanceId === drag.instanceId.value,
  )
  if (!position || !item) return null
  return {
    ...position,
    // A ghost narrower than a hand is not recognisable as the card it came
    // from; a zero width means the source was never measured.
    width: Math.max(position.width, 180),
    icon: item.definition.dynamicIcon?.() ?? item.definition.icon,
    title: moduleTitle(item),
  }
})

/**
 * Whether the columns may animate entries and exits. Off for the whole drag,
 * and — the part that is easy to get wrong — for one tick past the end of it.
 *
 * Releasing or cancelling patches the columns in the same tick that the drag
 * state clears. Turning the transitions back on at that moment means the last
 * cross-column change is animated after all, which is exactly the interrupted
 * enter that strands a card in the column it was leaving.
 */
const columnsAnimated = ref(true)

watch(
  () => drag.instanceId.value,
  async (dragging) => {
    if (dragging !== null) {
      columnsAnimated.value = false
      return
    }
    await nextTick()
    columnsAnimated.value = true
  },
)

/**
 * A module that has promoted nothing into its quick layer has nothing for the
 * gear to disclose, so the click goes straight to the full settings surface
 * instead of opening an empty panel. Legacy modules — no
 * `quickSettingsDefaultKeys` on their registry entry — never hit this branch;
 * `moduleHasQuickSettings` treats their fixed layer as always non-empty.
 */
function toggleSettings(instanceId: string): void {
  const item = renderedModules.value.find((entry) => entry.instance.instanceId === instanceId)
  if (item && !moduleHasQuickSettings(item.definition, item.instance.config)) {
    void openSurface(instanceId)
    return
  }
  openSettings.value = openSettings.value === instanceId ? null : instanceId
}

function toggleCollapse(instanceId: string, currentlyCollapsed: boolean): void {
  layout.toggleCollapsed(displayedViewport.value, instanceId)
  // Collapsing unmounts the module, which is what the settings disclosure
  // layer lives inside — leaving it flagged open would reopen an empty layer
  // the instant the card expands again, and the header no longer even shows
  // the gear that would let a user close it themselves.
  if (!currentlyCollapsed && openSettings.value === instanceId) openSettings.value = null
}

const dockedModule = computed(
  () =>
    renderedModules.value.find(
      (item) => item.instance.instanceId === surfaceOpenInstanceId.value,
    ) ?? null,
)

/**
 * The surface's "Shown on the card" mirror exists for exactly one reason:
 * docking withdraws the gear, so a module whose quick settings are fixed
 * would otherwise become unreachable while its surface is open. A module that
 * lets the user promote individual settings instead (`quickSettingsDefaultKeys`
 * set) already renders every one of those settings, in place, with its own
 * `QuickSettingToggle` — repeating them in a mirror would show the same
 * control twice on the same screen, so this is null for those and the mirror
 * simply does not render.
 */
const legacyQuickSettingsComponent = computed(() =>
  dockedModule.value && dockedModule.value.definition.quickSettingsDefaultKeys === undefined
    ? (dockedModule.value.definition.quickSettingsComponent ?? null)
    : null,
)

const cardElement = findDashboardCardElement

/**
 * The placeholder holds the column open at the card's own height, and the dock
 * adopts the card's own width — so nothing below reflows and the card is never
 * resized to fit a container that chose its own measure.
 */
async function openSurface(instanceId: string): Promise<void> {
  const element = cardElement(instanceId)
  const rect = element?.getBoundingClientRect() ?? null
  /*
   * The height the card will have once its disclosure layer has gone —
   * subtracted rather than waited for. The layer collapses over an animation,
   * so measuring after closing it would catch a height mid-collapse, and
   * measuring before would size the hole to a card about to shrink. Either way
   * the column jumps; arithmetic gets it right on the first frame.
   */
  // Found through the panel rather than by class: the card body sits in a
  // reveal of its own, so the outermost one is the collapse, not the settings.
  const disclosure = element?.querySelector('.module-settings')?.closest('.disclosure-reveal')
  dockedHeight.value = (rect?.height ?? 0) - (disclosure?.getBoundingClientRect().height ?? 0)
  // A zero width is not a measurement — it is the absence of one, and handing
  // it to the dock as a literal size would squash the card flat. Null instead,
  // which reads as "cannot fit" and stacks.
  dockedWidth.value = rect && rect.width > 0 ? rect.width : null

  // The layer must not stay open behind the surface, leaving one module
  // configurable in two places.
  openSettings.value = null

  // Opens the dialog immediately — before the card has even started its own
  // fade-out — so the backdrop and the pane begin at the instant the gear was
  // clicked rather than only once the card has vanished.
  surfaceOpenInstanceId.value = instanceId

  // Before the fade-out, and behind the card rather than after it: the card
  // then dissolves onto a shell that is already sitting in its slot, which is
  // what makes the fade read as the module's contents going rather than the
  // module itself. It stays up for the whole round trip — see `closeSurface`.
  ghostInstanceId.value = instanceId

  // A fade works in either layout, including the stacked one where the card
  // genuinely re-lays out rather than only moving.
  cardMoving.value = true
  await moveCard(element, () => (dockedInstance.value = instanceId), {
    companion: surface.value?.pane ?? null,
    // Opening is the one direction the pane actually arrives somewhere with
    // the card, so it fades back to opaque with it rather than staying faded.
    companionArrives: true,
  })
  cardMoving.value = false
}

async function closeSurface(): Promise<void> {
  const instanceId = dockedInstance.value
  if (!instanceId) return
  // The width has to survive the move: it is what the dock is still sized by
  // while the card is on its way home.
  cardMoving.value = true
  await moveCard(
    cardElement(instanceId),
    () => {
      dockedInstance.value = null
      surfaceOpenInstanceId.value = null
    },
    // No `companionArrives`: the pane fades out with the card, matching it,
    // but stays faded out rather than fading back to opaque — it has nowhere
    // to arrive at, and the dialog is still visually present for a beat after
    // `applyMove` closes it (`allow-discrete` keeps it in the top layer
    // through its own exit transition), so forcing it back to opaque here
    // reappeared as a flash of empty pane rather than a continuation of
    // anything.
    { companion: surface.value?.pane ?? null },
  )
  cardMoving.value = false
  // Only now, with the card fully faded back in on top of it. Nothing new is
  // spawned for the journey home: this is the same shell that has been in the
  // slot since the open, so the card fades back in over it exactly as it faded
  // out onto it, and taking it down any earlier would put a hole under a card
  // that is still arriving.
  ghostInstanceId.value = null
  dockedWidth.value = null
  dockedHeight.value = 0
}

/**
 * A `supportsMultiple` module's own pane asked to dock a sibling instance
 * instead — Macros' group switcher. Still never a moment with two docked
 * cards: the current one is fully undocked before the next one docks. But
 * unlike `openSurface`/`closeSurface`, neither the dialog nor the pane ever
 * leaves — `surfaceOpenInstanceId` moves directly from one instance to the
 * other, so `SettingsSurface`'s own watcher (which only calls `showModal()`
 * or `close()` when its `instanceId` prop crosses null) never sees a reason
 * to touch the `<dialog>`. The backdrop staying up is what makes this a
 * within-surface swap rather than the surface itself blinking shut and open
 * again around it — running the two full open/close journeys back to back
 * did exactly that, and it read as the dashboard flashing back into view
 * mid-switch.
 *
 * The card swap itself is instant, the same way Configuration replaces one
 * folder's contents with another's without a crossfade: the surface, the
 * dock, and the backdrop are already stable, so nothing here is "arriving"
 * the way a card leaving or entering the dashboard grid is — only which
 * instance fills the stationary dock changes. `moveCard`'s `animate: false`
 * path is the same instant-swap code the reduced-motion and unmeasurable-card
 * cases already rely on, so this reuses it rather than adding a second way to
 * skip the fade.
 */
async function switchSurface(instanceId: string): Promise<void> {
  const previousInstanceId = dockedInstance.value
  if (instanceId === previousInstanceId) return

  if (previousInstanceId) {
    await moveCard(cardElement(previousInstanceId), () => (dockedInstance.value = null), {
      animate: false,
    })
  }

  const element = cardElement(instanceId)
  const rect = element?.getBoundingClientRect() ?? null
  const disclosure = element?.querySelector('.module-settings')?.closest('.disclosure-reveal')
  dockedHeight.value = (rect?.height ?? 0) - (disclosure?.getBoundingClientRect().height ?? 0)
  dockedWidth.value = rect && rect.width > 0 ? rect.width : null
  openSettings.value = null
  // Replaces the old instance's shell with the new one's in the same tick —
  // the old ghost was hidden behind its own now-returned, fully opaque card,
  // so nothing is visibly uncovered by dropping it here.
  ghostInstanceId.value = instanceId
  surfaceOpenInstanceId.value = instanceId

  await moveCard(element, () => (dockedInstance.value = instanceId), { animate: false })
}

/*
 * A resize while the surface is open changes the column width the dock copied.
 * Recomputed directly rather than animated: resizing switches geometry, exactly
 * as a breakpoint does.
 */
/*
 * The docked card keeps changing height — a leveling result arrives, an offset
 * row appears — and a placeholder frozen at the height the card had when it
 * left would leave the column visibly wrong for as long as the surface is
 * open. It tracks the live card instead.
 */
let dockedCardResize: ResizeObserver | null = null
/**
 * The card is mid-fade, and its disclosure layer may still be collapsing. Any
 * height read now is a frame of an animation rather than a resting size, so
 * the placeholder keeps the height that was worked out up front until the card
 * has arrived.
 */
const cardMoving = ref(false)

watch(
  dockedInstance,
  (instanceId) => {
    dockedCardResize?.disconnect()
    dockedCardResize = null
    if (!instanceId || typeof ResizeObserver === 'undefined') return
    const element = cardElement(instanceId)
    if (!element) return
    dockedCardResize = new ResizeObserver(() => {
      if (cardMoving.value) return
      const height = element.getBoundingClientRect().height
      if (height > 0) dockedHeight.value = height
    })
    dockedCardResize.observe(element)
  },
  { flush: 'post' },
)

function remeasureDockedCard(): void {
  viewportWidth.value = window.innerWidth
  const instanceId = dockedInstance.value
  if (!instanceId) return
  void nextTick(() => {
    const placeholder = document.querySelector(`[data-placeholder-for="${CSS.escape(instanceId)}"]`)
    if (placeholder instanceof HTMLElement && placeholder.offsetWidth > 0) {
      dockedWidth.value = placeholder.offsetWidth
    }
  })
}

window.addEventListener('resize', remeasureDockedCard)
onBeforeUnmount(() => {
  window.removeEventListener('resize', remeasureDockedCard)
  dockedCardResize?.disconnect()
})

function duplicate(instanceId: string): void {
  layout.duplicateInstance(displayedViewport.value, instanceId)
}

function remove(instanceId: string): void {
  if (openSettings.value === instanceId) openSettings.value = null
  // Removing the docked card would leave the surface holding nothing.
  if (dockedInstance.value === instanceId) closeSurface()
  layout.removeInstance(instanceId)
}

function applyPreset(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const preset = target.value as DashboardPresetId
  if (dashboardPresetIds.includes(preset)) layout.applyPreset(preset)
  target.value = ''
}

function setColumnWidth(width: DashboardColumnWidth): void {
  layout.setColumnWidth(selectedViewport.value, selectedColumn.value, width)
}
</script>

<template>
  <!--
    A single real wrapper rather than three template roots. Vue mounts
    multiple root nodes as siblings with nothing wrapping them, which is
    invisible until this view lands inside App.vue's
    `<Transition name="route-view">` — a `<Transition>` can only track one
    root, so it warned and silently gave up animating the page.

    Not `display: contents`: `.route-stage` stacks the outgoing and incoming
    pages in the same grid cell via `.route-stage > * { grid-area: 1 / 1 }`,
    keyed on being a *direct* child. A `contents` wrapper un-boxes itself and
    promotes its children into that position instead, one level below where
    the selector reaches, so they fall back to normal grid auto-placement —
    the outgoing and incoming page then stack in separate rows instead of on
    top of each other, which read as the new page shoving the old one down
    before snapping to full height. A plain block wrapper stays the one grid
    item the rule expects; the drag ghost and the settings dialog inside it
    are unaffected either way, since `position: fixed` and a closed `<dialog>`
    already escape normal flow.
  -->
  <div>
    <section ref="page" class="standard-page">
      <PageHeading :title="t('dashboard.operationalTitle')" :action="customizeAction" />

      <div v-if="editing" class="dashboard-edit-banner">
        <!--
        The heading takes the leftover space rather than the first control
        pushing itself right with an auto margin. Same result while the banner
        fits on one line, and the difference shows the moment it wraps: an auto
        margin belongs to whichever line the control lands on, so it would
        indent the whole second row by whatever space that row had left over.

        `grow`, never `flex-1`: the latter also sets the basis to zero, which
        takes the heading out of the calculation that decides where the row
        breaks. The controls then stay on its line and squeeze it down to one
        word per line instead of wrapping to a line of their own.
      -->
        <div class="flex min-w-0 grow items-center gap-3">
          <AppIcon name="drag" class="size-5 shrink-0 text-data-sky" aria-hidden="true" />
          <div class="min-w-0">
            <p class="text-card-title">{{ t('dashboard.layout.title') }}</p>
          </div>
        </div>
        <div class="segmented" :aria-label="t('dashboard.layout.viewportLabel')">
          <AppButton
            v-for="candidate in ['desktop', 'tablet', 'mobile'] as DashboardViewport[]"
            :key="candidate"
            size="sm"
            :aria-pressed="selectedViewport === candidate"
            @click="selectedViewport = candidate"
          >
            {{ t(`dashboard.layout.viewport.${candidate}`) }}
          </AppButton>
        </div>
        <!--
        Two controls rather than one per column: pick the column, then set its
        width. The ruler's own tracks are the layout's tracks, so it is a scale
        model of the grid behind it and the widths are legible without reading a
        single label — which is what lets its buttons be numbered rather than
        named, and is why a narrow column stays a comfortable target instead of
        shrinking to fit the word "Narrow".
      -->
        <div
          v-if="columnCountFor(selectedViewport) > 1"
          class="dashboard-column-width-picker"
          role="group"
          :aria-label="t('dashboard.layout.columnWidthLabel')"
        >
          <div
            class="segmented dashboard-column-ruler"
            :style="{ '--dashboard-ruler-template': rulerTemplate }"
          >
            <AppButton
              v-for="column in columnCountFor(selectedViewport)"
              :key="column"
              size="sm"
              :label="column"
              :aria-pressed="selectedColumn === column - 1"
              :aria-label="
                t('dashboard.layout.columnWidthOf', {
                  number: column,
                  width: t(`dashboard.layout.columnWidth.${columnWidths[column - 1] ?? 'normal'}`),
                })
              "
              @click="selectedColumn = column - 1"
            />
          </div>
          <div class="segmented dashboard-column-width-scale">
            <AppButton
              v-for="width in dashboardColumnWidthNames"
              :key="width"
              size="sm"
              :aria-pressed="(columnWidths[selectedColumn] ?? 'normal') === width"
              @click="setColumnWidth(width)"
            >
              {{ t(`dashboard.layout.columnWidth.${width}`) }}
            </AppButton>
          </div>
        </div>
        <label class="sr-only" for="dashboard-preset-select">
          {{ t('dashboard.layout.presetLabel') }}
        </label>
        <select
          id="dashboard-preset-select"
          class="field field--sm field--on-soft dashboard-preset-select"
          value=""
          @change="applyPreset"
        >
          <option value="" disabled>{{ t('dashboard.layout.presetLabel') }}</option>
          <option v-for="preset in dashboardPresetIds" :key="preset" :value="preset">
            {{ t(`dashboard.layout.preset.${preset}`) }}
          </option>
        </select>
        <AppButton
          on-soft
          :label="t('dashboard.layout.reset')"
          @click="layout.reset(selectedViewport)"
        />
      </div>

      <div v-if="editing" class="dashboard-module-tray">
        <div>
          <p class="text-card-title">{{ t('dashboard.layout.availableModules') }}</p>
          <p class="mt-0.5 text-xs text-muted">{{ t('dashboard.layout.availableDescription') }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <AppButton
            v-for="item in hiddenModules"
            :key="item.instance.instanceId"
            size="sm"
            on-soft
            icon="add"
            :label="moduleTitle(item)"
            @click="layout.setVisible(displayedViewport, item.instance.instanceId, true)"
          />
          <span v-if="hiddenModules.length === 0" class="text-xs text-muted">
            {{ t('dashboard.layout.noneHidden') }}
          </span>
        </div>
      </div>

      <div
        class="dashboard-columns"
        :data-layout-viewport="displayedViewport"
        :data-dragging="drag.instanceId.value ? true : undefined"
        :style="{
          '--dashboard-column-template': columnTemplate,
          '--dashboard-column-units': columnUnits,
        }"
      >
        <!--
        Each column is its own TransitionGroup, so a card previewed into another
        column leaves one list and enters another rather than sliding between
        them. During a drag that crossing has to be instant, which is what `css`
        does here: with it off Vue applies no enter or leave classes and resolves
        both immediately, while `-move` is unaffected, so the cards shifting to
        make room still slide — the slide *is* the drop preview.

        It has to be `css`, not a CSS override and not a second transition name.
        Both of those leave the class machinery running, and an enter interrupted
        by a leave — one wave of the pointer back across a gutter — strands the
        element holding `-enter-from` and `-leave-active` at once, with no
        transition left to finish it. The old column then keeps a second copy of
        the card for the rest of the session.
      -->
        <TransitionGroup
          v-for="(columnItems, columnIndex) in visibleColumns"
          :key="columnIndex"
          name="dashboard-grid"
          tag="div"
          class="dashboard-column"
          :css="columnsAnimated"
          :data-dashboard-column="columnIndex"
        >
          <AvailabilityRegion
            v-for="(item, index) in columnItems"
            :key="item.instance.instanceId"
            :requires="item.definition.requires"
            :disable-interaction="!editing"
            class="dashboard-column__item"
          >
            <!--
            First, so it paints behind the card with no z-index to keep in
            sync. It is up before the card starts fading out and stays until
            the card has finished fading back in, so at both ends the card is
            dissolving onto or out of a shell that is already in place — and
            in between it is what holds the column's geometry.
          -->
            <DashboardModulePlaceholder
              v-if="ghostInstanceId === item.instance.instanceId"
              :height="dockedInstance === item.instance.instanceId ? dockedHeight : null"
              :instance-id="item.instance.instanceId"
            />

            <!--
            Teleport rather than v-if: it moves the DOM while leaving the
            component where it is in the component tree, so the card's local
            state, its watchers, and its injected context all survive docking.
            Kept inside the region rather than wrapping it, so the column's
            TransitionGroup never sees a child leave.
          -->
            <Teleport
              :to="surfaceDock"
              :disabled="dockedInstance !== item.instance.instanceId || !surfaceDock"
            >
              <DashboardModuleCard
                :instance-id="item.instance.instanceId"
                :title="moduleTitle(item)"
                :default-title="t(item.definition.titleKey)"
                :icon="item.definition.dynamicIcon?.() ?? item.definition.icon"
                :editing="editing"
                :collapsed="item.placement.collapsed"
                :summary="
                  item.placement.collapsed
                    ? (item.definition.summary?.(item.instance.config) ?? null)
                    : null
                "
                :has-settings="item.definition.hasSettings === true"
                :settings-open="openSettings === item.instance.instanceId"
                :docked="dockedInstance === item.instance.instanceId"
                :can-rename="item.definition.supportsMultiple === true"
                :can-duplicate="item.definition.supportsMultiple === true"
                :can-remove="layout.instanceCountFor(item.instance.moduleId) > 1"
                :is-first="index === 0"
                :is-last="index === columnItems.length - 1"
                :can-move-to-previous-column="columnIndex > 0"
                :can-move-to-next-column="columnIndex < columnCount - 1"
                :dragging="drag.instanceId.value === item.instance.instanceId"
                @drag-start="drag.begin"
                @move="
                  (instanceId, direction) => layout.move(displayedViewport, instanceId, direction)
                "
                @move-column="
                  (instanceId, direction) =>
                    layout.moveColumn(displayedViewport, instanceId, direction)
                "
                @hide="layout.setVisible(displayedViewport, $event, false)"
                @toggle-collapse="
                  toggleCollapse(item.instance.instanceId, item.placement.collapsed)
                "
                @toggle-settings="toggleSettings"
                @open-surface="openSurface"
                @duplicate="duplicate"
                @remove="remove"
                @rename="(instanceId, title) => layout.renameInstance(instanceId, title)"
              >
                <!--
                `surface-open` was never passed, so `isSurfaceOpen` read false for
                every module's whole life — the boolean half of the documented
                module context did not mean what it says. Nothing needs it today
                (scroll position across a dock is restored in `cardMove.ts`, for
                every module at once), but a context member that silently lies is a
                trap for the next module to read it.
              -->
                <DashboardModuleHost
                  :instance-id="item.instance.instanceId"
                  :module-id="item.instance.moduleId"
                  :component="item.definition.component"
                  :settings-open="openSettings === item.instance.instanceId"
                  :surface-open="dockedInstance === item.instance.instanceId"
                  @open-settings="openSettings = $event"
                  @close-settings="openSettings = null"
                  @open-surface="openSurface"
                  @close-surface="closeSurface"
                />
              </DashboardModuleCard>
            </Teleport>
          </AvailabilityRegion>
        </TransitionGroup>
      </div>

      <div v-if="visibleModules.length === 0 && !editing" class="dashboard-empty-layout">
        <AppIcon name="customize" class="size-8 text-data-sky" aria-hidden="true" />
        <p class="mt-3 text-section-title">{{ t('dashboard.layout.empty') }}</p>
        <AppButton
          on-soft
          :label="t('dashboard.layout.customize')"
          class="mt-4"
          @click="toggleEditing"
        />
      </div>
    </section>

    <!--
    The card under the pointer. It carries the header alone rather than a copy
    of the module: a full-size duplicate of an eight-row card obscures the
    columns it is being dragged over, which is precisely where the user is
    trying to look. Its width is the source card's, so it still reads as that
    card rather than as a floating label.
  -->
    <div
      v-if="draggedGhost"
      class="dashboard-drag-ghost"
      :style="{
        width: `${draggedGhost.width}px`,
        transform: `translate3d(${draggedGhost.x}px, ${draggedGhost.y}px, 0)`,
      }"
      aria-hidden="true"
    >
      <AppIcon :name="draggedGhost.icon" class="size-5 shrink-0 text-data-sky" aria-hidden="true" />
      <span class="truncate">{{ draggedGhost.title }}</span>
    </div>

    <!--
    Always mounted so its dock exists as a teleport target before a card is
    ever moved into it; `instanceId` alone decides whether it is showing.
  -->
    <SettingsSurface
      ref="surface"
      :instance-id="surfaceOpenInstanceId"
      :module-id="dockedModule?.instance.moduleId ?? null"
      :title="dockedModule ? moduleTitle(dockedModule) : ''"
      :icon="dockedModule?.definition.dynamicIcon?.() ?? dockedModule?.definition.icon ?? null"
      :requires="dockedModule?.definition.requires ?? 'moonraker'"
      :quick-settings-component="legacyQuickSettingsComponent"
      :settings-component="dockedModule?.definition.settingsComponent ?? null"
      :dock-width="dockedWidth"
      :stacked="surfaceStacked"
      @close="closeSurface"
      @switch-surface="switchSurface"
    />
  </div>
</template>
