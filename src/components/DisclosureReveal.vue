<script setup lang="ts">
/**
 * A panel that opens and closes to its own content height instead of popping
 * into place. One component for every disclosure in the product — a card's body
 * under its collapse control, a module's settings layer — so they all reveal
 * themselves at the same speed and cannot drift apart.
 *
 * Three elements, because the reveal needs all three: the outer grid animates
 * its single row from `0fr` to `1fr`, which resolves to the content's real
 * height with no magic number to keep in step with it; the middle one clips
 * while that row is shorter than its content; and the slotted element carries
 * the padding and margins, so those collapse with the panel rather than leaving
 * a gap behind at zero height.
 *
 * That last reason is why the slot takes exactly one element.
 */
defineProps<{ open: boolean }>()
</script>

<template>
  <Transition name="disclosure">
    <div v-if="open" class="disclosure-reveal">
      <div class="disclosure-reveal__clip">
        <slot></slot>
      </div>
    </div>
  </Transition>
</template>
