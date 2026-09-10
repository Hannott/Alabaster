<script setup lang="ts">
/**
 * The farm: every saved printer on screen at once, as a grid of camera-first
 * cards that the page scrolls vertically.
 *
 * This replaced a sideways rail of full-height columns, and the reason is one
 * measurement: in that rail the camera was 298 × 169 px — 17% of a 981 px
 * column — while the control dock under it took 175 px and roughly 372 px of
 * the column was empty because a full-height card has to fill itself. Three
 * cards across the same canvas make each camera 570 × 320: 3.6× the area, on a
 * page whose whole purpose is looking at machines.
 *
 * What the rail's "one row" decision settled, and how the grid answers it
 * instead:
 *
 * - **How many printers fit.** However many there are, as before: a wrapping
 *   grid has no density cliff either, and twenty printers is seven rows of
 *   ordinary scrolling rather than six thousand pixels of sideways travel.
 * - **Where the controls go.** One action row and one menu, in place of a dock
 *   that existed largely because the column had 800 px to fill.
 * - **What happens when the farm grows.** A new printer appends a card and
 *   moves nothing, because order is the saved list's order and the grid fills
 *   in order. The grid does reshape when the *window* changes — but a window
 *   resize is a user event, not a data event, which is the distinction
 *   [`ADR 0002`](../../docs/architecture/0002-resilient-availability.md) draws.
 * - **One machine needs attention and the others do not.** The middle level the
 *   rail bought with a second column size is gone, because a 570 px card is
 *   already wider than the expanded column's data pane was. There is one size.
 *
 * The scroll is the page's own, so this is a `standard-page`: no nested scroll
 * region anywhere on the route, where the rail had two (itself, and the queue
 * list inside a column).
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import FarmPrinterCard from '@/components/farm/FarmPrinterCard.vue'
import PageHeading from '@/components/PageHeading.vue'
import { useFarmStore } from '@/stores/farm'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrintersStore } from '@/stores/printers'

const { t } = useI18n({ useScope: 'global' })
const router = useRouter()
const farm = useFarmStore()
const printers = usePrintersStore()
const moonraker = useMoonrakerStore()

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

/**
 * The card's primary control does one of two things, and which one is the whole
 * reason it has two labels.
 *
 * **Switch** retargets the live connection and stays on the page. The reader is
 * looking at the wall; the useful outcome is that Alabaster is now driving this
 * machine, not that they have been moved somewhere else. The card marks itself
 * as the active one and the wall carries on.
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
</script>

<template>
  <section class="standard-page farm-page">
    <PageHeading :title="t('farm.title')" />

    <div class="farm-grid" role="group" :aria-label="t('farm.gridLabel')">
      <FarmPrinterCard
        v-for="card in farm.columns"
        :key="card.id"
        :printer="card"
        @open="open(card.id)"
        @visibility="farm.setVisible(card.id, $event)"
      />
    </div>
  </section>
</template>
