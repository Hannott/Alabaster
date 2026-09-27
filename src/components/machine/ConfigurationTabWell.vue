<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import DisclosureReveal from '@/components/DisclosureReveal.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import ConfigurationTab from '@/components/machine/ConfigurationTab.vue'
import { collapsedTabRow, packTabRows } from '@/features/machine/tabRows'
import type { MachineFileTab, OpenMachineFile } from '@/stores/machineFiles'

/**
 * The Configuration viewer's tab well: pinned files on a row of their own,
 * then every other open file, wrapping onto as many rows as it needs. Scrolling
 * over the well folds those rows down to one or brings them all back; the
 * chevron does the same for a keyboard and a touch screen, which have no wheel
 * to scroll with.
 */
const props = defineProps<{
  pinned: readonly OpenMachineFile[]
  tabs: readonly MachineFileTab[]
  activePath: string | null
  dirtyPaths: readonly string[]
  root: string
  disabled?: boolean | undefined
}>()

const emit = defineEmits<{
  activate: [path: string]
  keep: [path: string]
  close: [path: string]
  pin: [path: string]
  unpin: [path: string]
  menu: [event: MouseEvent, path: string]
}>()

defineSlots<{ tools(): unknown }>()

const { t } = useI18n({ useScope: 'global' })

const collapsedStorageKey = 'alabaster.machine.tabRowsCollapsed'

function initialCollapsed(): boolean {
  try {
    return localStorage.getItem(collapsedStorageKey) === 'true'
  } catch {
    return false
  }
}

const collapsed = ref(initialCollapsed())
const rowsElement = ref<HTMLElement | null>(null)
const measureElement = ref<HTMLElement | null>(null)
const widths = ref<number[]>([])
const available = ref(Number.POSITIVE_INFINITY)
const gap = ref(0)

const dirty = computed(() => new Set(props.dirtyPaths))

/*
 * Rows are computed from measured widths rather than left to `flex-wrap`, so
 * the first row and the rest can be separate elements: the rest has to sit
 * inside `DisclosureReveal` for the fold to animate its own height, which is
 * the one kind of height animation ADR 0004 allows. The measuring strip holds
 * every tab at its natural width, out of sight and out of the accessibility
 * tree.
 */
function measure(): void {
  const strip = measureElement.value
  const rows = rowsElement.value
  if (!strip || !rows) return
  widths.value = [...strip.children].map((child) => (child as HTMLElement).offsetWidth)
  available.value = rows.clientWidth || Number.POSITIVE_INFINITY
  gap.value = Number.parseFloat(getComputedStyle(strip).columnGap) || 0
}

const rows = computed(() =>
  widths.value.length === props.tabs.length
    ? packTabRows(widths.value, available.value, gap.value)
    : [props.tabs.map((_, index) => index)],
)
const hasMultipleRows = computed(() => rows.value.length > 1)
const activeIndex = computed(() =>
  props.tabs.findIndex((tab) => tab.file.path === props.activePath),
)
const collapsedRow = computed(() =>
  collapsedTabRow(rows.value, widths.value, activeIndex.value, available.value, gap.value, 0),
)
const isFolded = computed(() => collapsed.value && hasMultipleRows.value)
const firstRow = computed(() =>
  (isFolded.value ? collapsedRow.value.visible : (rows.value[0] ?? [])).flatMap(
    (index) => props.tabs[index] ?? [],
  ),
)
const laterRows = computed(() =>
  rows.value.slice(1).map((row) => row.flatMap((index) => props.tabs[index] ?? [])),
)
const foldedCount = computed(() => (isFolded.value ? collapsedRow.value.folded : 0))

/** The one tab the Tab key lands on: the shown file's, or the first on screen. */
const focusablePath = computed(() => {
  const rendered = [
    ...props.pinned.map((file) => file.path),
    ...firstRow.value.map((tab) => tab.file.path),
    ...(isFolded.value ? [] : laterRows.value.flat().map((tab) => tab.file.path)),
  ]
  return props.activePath && rendered.includes(props.activePath)
    ? props.activePath
    : (rendered[0] ?? null)
})

const allTabs = computed(() => [
  ...props.pinned.map((file) => ({ file, pinned: true })),
  ...props.tabs.map((tab) => ({ file: tab.file, pinned: false })),
])

function setCollapsed(value: boolean): void {
  collapsed.value = value
  try {
    localStorage.setItem(collapsedStorageKey, String(value))
  } catch {
    // A preference that cannot be stored still applies for this visit.
  }
}

/*
 * One toggle per gesture. A trackpad reports a swipe as a burst of small
 * deltas followed by inertia, so the deltas are summed to a threshold and then
 * ignored until the wheel has been quiet for a moment — without that, one
 * swipe folds and unfolds the well several times over. The event is only
 * claimed when it actually toggles, so scrolling over a well with nothing to
 * fold, or already folded the way the wheel is asking, still scrolls the page.
 */
const WHEEL_THRESHOLD_PX = 40
const WHEEL_QUIET_MS = 250
const WHEEL_LINE_PX = 16
let wheelAccumulated = 0
let wheelQuietUntil = 0

function onWheel(event: WheelEvent): void {
  if (!hasMultipleRows.value || event.deltaY === 0) return
  const wantsExpand = event.deltaY > 0
  if (collapsed.value !== wantsExpand) return
  event.preventDefault()
  const now = performance.now()
  if (now < wheelQuietUntil) {
    wheelQuietUntil = now + WHEEL_QUIET_MS
    return
  }
  const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : 1
  wheelAccumulated += Math.abs(event.deltaY) * scale
  if (wheelAccumulated < WHEEL_THRESHOLD_PX) return
  wheelAccumulated = 0
  wheelQuietUntil = now + WHEEL_QUIET_MS
  setCollapsed(!wantsExpand)
}

/*
 * The WAI-ARIA tab-list keyboard: the arrows move between tabs across rows in
 * reading order, Home and End jump to either end, and Delete closes the
 * focused tab. Focus only moves; activating stays with Enter and Space, since
 * opening a file costs a fetch and should not happen on every arrow press.
 */
function onKeydown(event: KeyboardEvent): void {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tab-path]')
  const container = rowsElement.value
  if (!target || !container) return
  const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
  const index = tabs.indexOf(target)
  const path = target.dataset.tabPath ?? ''
  let next: number
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = index + 1
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      next = index - 1
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = tabs.length - 1
      break
    case 'Delete':
      event.preventDefault()
      emit('close', path)
      return
    default:
      return
  }
  const element = tabs[next]
  if (!element) return
  event.preventDefault()
  element.focus()
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  measure()
  if (typeof ResizeObserver === 'undefined' || !rowsElement.value) return
  resizeObserver = new ResizeObserver(measure)
  resizeObserver.observe(rowsElement.value)
})

onBeforeUnmount(() => resizeObserver?.disconnect())

watch(
  () => props.tabs.map((tab) => `${tab.file.path}:${tab.preview}`).join('\n'),
  () => void nextTick(measure),
  { flush: 'post' },
)
</script>

<template>
  <div class="document-tabs" @wheel="onWheel">
    <div
      ref="rowsElement"
      class="document-tabs__rows"
      role="tablist"
      :aria-label="t('configuration.tabs.label')"
      @keydown="onKeydown"
    >
      <!-- Divided from the rest only when there is a rest to divide it from. -->
      <div
        v-if="pinned.length > 0"
        class="document-tabs__row document-tabs__row--pinned"
        :class="{ 'document-tabs__row--divided': firstRow.length > 0 }"
      >
        <ConfigurationTab
          v-for="file in pinned"
          :key="`pin:${file.path}`"
          :name="file.name"
          :path="file.path"
          :root="root"
          :active="file.path === activePath"
          :dirty="dirty.has(file.path)"
          pinned
          :focusable="focusablePath === file.path"
          :disabled="disabled"
          @activate="emit('activate', file.path)"
          @close="emit('close', file.path)"
          @unpin="emit('unpin', file.path)"
          @menu="emit('menu', $event, file.path)"
        />
      </div>
      <div v-if="firstRow.length > 0" class="document-tabs__row">
        <ConfigurationTab
          v-for="tab in firstRow"
          :key="tab.file.path"
          :name="tab.file.name"
          :path="tab.file.path"
          :root="root"
          :active="tab.file.path === activePath"
          :preview="tab.preview"
          :dirty="dirty.has(tab.file.path)"
          :focusable="focusablePath === tab.file.path"
          :disabled="disabled"
          @activate="emit('activate', tab.file.path)"
          @keep="emit('keep', tab.file.path)"
          @close="emit('close', tab.file.path)"
          @pin="emit('pin', tab.file.path)"
          @menu="emit('menu', $event, tab.file.path)"
        />
      </div>
      <DisclosureReveal :open="!isFolded && laterRows.length > 0">
        <div class="document-tabs__later">
          <div v-for="(row, rowIndex) in laterRows" :key="rowIndex" class="document-tabs__row">
            <ConfigurationTab
              v-for="tab in row"
              :key="tab.file.path"
              :name="tab.file.name"
              :path="tab.file.path"
              :root="root"
              :active="tab.file.path === activePath"
              :preview="tab.preview"
              :dirty="dirty.has(tab.file.path)"
              :focusable="focusablePath === tab.file.path"
              :disabled="disabled"
              @activate="emit('activate', tab.file.path)"
              @keep="emit('keep', tab.file.path)"
              @close="emit('close', tab.file.path)"
              @pin="emit('pin', tab.file.path)"
              @menu="emit('menu', $event, tab.file.path)"
            />
          </div>
        </div>
      </DisclosureReveal>
    </div>

    <div class="document-tabs__tools">
      <AppButton
        v-if="hasMultipleRows"
        variant="quiet"
        size="xs"
        :icon-only="foldedCount === 0"
        :aria-expanded="!isFolded"
        :aria-label="
          t(isFolded ? 'configuration.tabs.showAllRows' : 'configuration.tabs.showOneRow')
        "
        :title="t(isFolded ? 'configuration.tabs.showAllRows' : 'configuration.tabs.showOneRow')"
        @click="setCollapsed(!isFolded)"
      >
        <span v-if="foldedCount > 0" class="document-tabs__folded">{{
          t('configuration.tabs.folded', { count: foldedCount })
        }}</span>
        <AppIcon :name="isFolded ? 'down' : 'up'" class="size-4" aria-hidden="true" />
      </AppButton>
      <HeaderMenu
        :label="t('configuration.tabs.list')"
        align="end"
        trigger-variant="quiet"
        trigger-icon-only
        panel-class="document-tabs__menu"
      >
        <template #trigger>
          <AppIcon name="more" class="size-4" aria-hidden="true" />
        </template>
        <template #default="{ close }">
          <AppButton
            v-for="item in allTabs"
            :key="`${item.pinned}:${item.file.path}`"
            variant="quiet"
            size="sm"
            start
            block
            :icon="item.pinned ? 'filePin' : undefined"
            :aria-current="item.file.path === activePath ? 'true' : undefined"
            :label="item.file.name"
            :title="`/${root}/${item.file.path}`"
            @click="
              () => {
                emit('activate', item.file.path)
                close()
              }
            "
          />
        </template>
      </HeaderMenu>
      <slot name="tools"></slot>
    </div>

    <div
      ref="measureElement"
      class="document-tabs__row document-tabs__measure"
      aria-hidden="true"
      inert
    >
      <ConfigurationTab
        v-for="tab in tabs"
        :key="tab.file.path"
        :name="tab.file.name"
        :path="tab.file.path"
        :root="root"
        :active="false"
        :preview="tab.preview"
        :dirty="dirty.has(tab.file.path)"
      />
    </div>
  </div>
</template>
