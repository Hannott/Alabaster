<script setup lang="ts">
/**
 * The empty shell that sits in a card's dashboard slot for as long as that
 * card's settings surface is open — up before it fades out, still there when
 * it fades back in. It does two jobs at once, and the second is the reason it
 * exists rather than a side effect:
 *
 * - While the card is docked it holds the slot open, so the column never
 *   reflows. Reflowing would animate grid geometry, which ADR 0004 forbids.
 * - At both ends of the journey it is **behind the card**, so the card fades
 *   out onto it and back in over it. That is what makes the fade read as the
 *   module's *contents* dissolving rather than the whole module going.
 *
 * Hollow on purpose. A dimmed copy of the card would put two renderings of one
 * live card on screen, and would imply a second mounted instance rather than
 * the real card having moved. It borrows the card's own border, radius,
 * surface and shadow rather than the dashed marker layout editing uses
 * elsewhere: a box of a different shape and color cannot read as the same box
 * with its contents gone.
 */
defineProps<{
  /**
   * The measured height to hold the slot at while the card is away, or `null`
   * while the card is still in the slot. Null is not zero: sharing the card's
   * grid cell means the card stretches this for free and exactly, and pinning
   * a measured height there would fight every change the card makes to its
   * own.
   */
  height: number | null
  instanceId: string
}>()
</script>

<template>
  <!--
    aria-hidden because the card itself is still in the accessibility tree,
    inside the dialog. Announcing both would report the module twice.

    The data attribute is how a resize re-measures the column width the dock
    copied: the placeholder occupies exactly the geometry the card would.
  -->
  <div
    class="module-placeholder"
    :style="height === null ? undefined : { height: `${height}px` }"
    :data-placeholder-for="instanceId"
    aria-hidden="true"
  ></div>
</template>
