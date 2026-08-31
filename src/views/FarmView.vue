<script setup lang="ts">
/**
 * The farm rail: every saved printer on screen at once, in one row of
 * full-height columns that scrolls sideways.
 *
 * Two geometric decisions carry the page, and both are in `main.css`:
 * a collapsed column is 200 px and an expanded one is 416 px — two collapsed
 * columns plus the gap — so expanding never knocks the rail off its rhythm,
 * and the arithmetic of "what does this cost me" is one column. Eight
 * collapsed columns fit a 1752 px canvas with a sliver of a ninth showing,
 * and that sliver is the affordance that says there is more to the right.
 *
 * The horizontal scroll lives on the rail, never on the document:
 * `interface-standards.md` forbids horizontal *document* overflow and controls
 * past the edge of a container that clips rather than scrolls. A region that
 * scrolls its own overflow is the permitted half, on two conditions this page
 * meets — the scrollbar stays visible, and a further column is always partly
 * on screen.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import FarmPrinterColumn from '@/components/farm/FarmPrinterColumn.vue'
import PageHeading from '@/components/PageHeading.vue'
import type { PageHeadingAction } from '@/components/PageHeading.vue'
import { useFarmExpansion } from '@/composables/useFarmExpansion'
import { useFarmStore } from '@/stores/farm'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrintersStore } from '@/stores/printers'

const { t } = useI18n({ useScope: 'global' })
const router = useRouter()
const farm = useFarmStore()
const printers = usePrintersStore()
const moonraker = useMoonrakerStore()
const { isExpanded, toggle, expandedCount, collapseAll } = useFarmExpansion()

const rail = ref<HTMLElement | null>(null)

/**
 * Farm connections exist only while this page is mounted *and* the document is
 * visible. Measured: 1.6 KB/s per connected printer while idle, 73% of which is
 * host telemetry Moonraker pushes to every socket whether or not anyone asked
 * for it. Nothing on this page needs history, so a backgrounded tab holding
 * those sockets would be pure waste.
 */
function handleVisibility(): void {
  if (document.visibilityState === 'visible') farm.activate()
  else farm.deactivate()
}

onMounted(() => {
  farm.activate()
  document.addEventListener('visibilitychange', handleVisibility)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibility)
  farm.deactivate()
})

const collapseAction = computed<PageHeadingAction | undefined>(() =>
  expandedCount.value > 0
    ? {
        label: t('farm.collapseAll'),
        icon: 'collapse',
        onClick: () => collapseAll(),
      }
    : undefined,
)

/**
 * The card's primary control does one of two things, and which one is the whole
 * reason it has two labels.
 *
 * **Switch** retargets the live connection and stays on the rail. The reader is
 * looking at the wall; the useful outcome is that Alabaster is now driving this
 * machine, not that they have been moved somewhere else. The column marks
 * itself as the active one and the rail carries on.
 *
 * **Go to dashboard**, on the card that is already active, leaves. Before this
 * split both cards read differently and did the same thing — switch, then
 * navigate — which made the wording a lie on one of them.
 *
 * Switching goes through the moonraker store the same way the header's printer
 * menu does: selecting without connecting would leave the socket and every
 * reading on the previous printer.
 */
function open(id: string): void {
  if (id === printers.activeId) {
    void router.push({ name: 'overview' })
    return
  }
  moonraker.selectPrinter(id)
}

/**
 * Arrow keys move the rail one column; Home and End go to its ends. A
 * horizontally scrolling region that only answers a mouse is unreachable by
 * keyboard, and the rail is the whole page.
 */
function onKeydown(event: KeyboardEvent): void {
  const element = rail.value
  if (!element) return
  const step = 216
  if (event.key === 'ArrowRight') element.scrollBy({ left: step, behavior: 'smooth' })
  else if (event.key === 'ArrowLeft') element.scrollBy({ left: -step, behavior: 'smooth' })
  else if (event.key === 'Home') element.scrollTo({ left: 0, behavior: 'smooth' })
  else if (event.key === 'End') element.scrollTo({ left: element.scrollWidth, behavior: 'smooth' })
  else return
  event.preventDefault()
}
</script>

<template>
  <section class="workspace-page farm-page">
    <PageHeading
      :title="t('farm.title')"
      v-bind="collapseAction ? { action: collapseAction } : {}"
    />

    <div
      ref="rail"
      class="farm-rail"
      tabindex="0"
      role="group"
      :aria-label="t('farm.railLabel')"
      @keydown="onKeydown"
    >
      <FarmPrinterColumn
        v-for="column in farm.columns"
        :key="column.id"
        :printer="column"
        :expanded="isExpanded(column.id)"
        @toggle="toggle(column.id)"
        @open="open(column.id)"
        @visibility="farm.setVisible(column.id, $event)"
      />
    </div>
  </section>
</template>
