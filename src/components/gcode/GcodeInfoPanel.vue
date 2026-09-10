<script setup lang="ts">
/**
 * What is inside the info chip's popover: what this file contains, and how it
 * is being drawn.
 *
 * Two sources, deliberately together. The counts come from Alabaster's own
 * parse, and the estimates come from the slicer through Moonraker's metadata —
 * which the viewer never asked for before, so the page could tell you how many
 * moves a file had but not how long it would take, while Print files two
 * clicks away could tell you the second and not the first.
 *
 * The rendering rows are here rather than on the quality chip because they
 * are readings, not settings: which tier the file is drawn at, and whether
 * that was this device's own measured limit. Somebody looking at a coarse
 * model wants to know why, and the answer is a fact about the machine.
 */
import { useI18n } from 'vue-i18n'

import type { MoonrakerGcodeMetadata } from '@/services/moonraker'

const props = defineProps<{
  layers: number
  moves: number
  extrusions: number
  travels: number
  size: number
  tier: number
  /** True when the tier was lowered because a previous parse died. */
  recovered: boolean
  metadata: MoonrakerGcodeMetadata | null
  formatSize: (bytes: number) => string
  formatDuration: (seconds: number) => string
}>()

const { t, n } = useI18n({ useScope: 'global' })
</script>

<template>
  <dl class="gcode-info">
    <div class="gcode-info__row">
      <dt>{{ t('gcodeViewer.statistics.layers') }}</dt>
      <dd>{{ n(props.layers) }}</dd>
    </div>
    <div class="gcode-info__row">
      <dt>{{ t('gcodeViewer.statistics.moves') }}</dt>
      <dd>{{ n(props.moves) }}</dd>
    </div>
    <div class="gcode-info__row">
      <dt>{{ t('gcodeViewer.statistics.extrusions') }}</dt>
      <dd>{{ n(props.extrusions) }}</dd>
    </div>
    <div class="gcode-info__row">
      <dt>{{ t('gcodeViewer.statistics.travels') }}</dt>
      <dd>{{ n(props.travels) }}</dd>
    </div>
    <div class="gcode-info__row">
      <dt>{{ t('gcodeViewer.statistics.fileSize') }}</dt>
      <dd>{{ props.formatSize(props.size) }}</dd>
    </div>

    <div v-if="props.metadata?.estimated_time" class="gcode-info__row">
      <dt>{{ t('gcodeViewer.statistics.estimatedTime') }}</dt>
      <dd>{{ props.formatDuration(props.metadata.estimated_time) }}</dd>
    </div>
    <div v-if="props.metadata?.filament_total" class="gcode-info__row">
      <dt>{{ t('gcodeViewer.statistics.filament') }}</dt>
      <dd>
        {{
          t('gcodeViewer.statistics.metres', {
            value: n(props.metadata.filament_total / 1000, { maximumFractionDigits: 2 }),
          })
        }}
      </dd>
    </div>
    <div v-if="props.metadata?.object_height" class="gcode-info__row">
      <dt>{{ t('gcodeViewer.statistics.objectHeight') }}</dt>
      <dd>
        {{
          t('gcodeViewer.statistics.millimetres', {
            value: n(props.metadata.object_height, { maximumFractionDigits: 2 }),
          })
        }}
      </dd>
    </div>
    <div v-if="props.metadata?.slicer" class="gcode-info__row">
      <dt>{{ t('gcodeViewer.statistics.slicer') }}</dt>
      <dd>{{ props.metadata.slicer }}</dd>
    </div>

    <div class="gcode-info__row gcode-info__row--rendering">
      <dt>{{ t('gcodeViewer.statistics.detail') }}</dt>
      <dd>{{ t(`gcodeViewer.statistics.tier.${props.tier}`) }}</dd>
    </div>
    <p v-if="props.recovered" class="gcode-info__note">
      {{ t('gcodeViewer.statistics.recovered') }}
    </p>
  </dl>
</template>
