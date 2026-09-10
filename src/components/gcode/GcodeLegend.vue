<script setup lang="ts">
/**
 * What the colours on the stage mean, bottom left.
 *
 * Every swatch is painted from the colour the renderer is actually using, not
 * from a token this component picked — in feature mode those colours belong to
 * the rendering library, which chooses them per slicer while it parses. A
 * legend that named its own colours would drift from the canvas the first time
 * the library changed one, and a legend that disagrees with the picture is
 * worse than none.
 *
 * Colour never carries meaning alone here: every swatch has its words beside
 * it, which is also what makes the legend readable to someone who cannot
 * separate two of the hues.
 */
export interface GcodeLegendEntry {
  key: string
  /** A resolved CSS colour, from the renderer or a theme token. */
  color: string
  label: string
}

const props = defineProps<{ entries: readonly GcodeLegendEntry[] }>()
</script>

<template>
  <dl v-if="props.entries.length > 0" class="gcode-legend" aria-hidden="true">
    <div v-for="entry in props.entries" :key="entry.key" class="gcode-legend__row">
      <dt class="gcode-legend__swatch" :style="{ backgroundColor: entry.color }"></dt>
      <dd class="gcode-legend__label">{{ entry.label }}</dd>
    </div>
  </dl>
</template>
