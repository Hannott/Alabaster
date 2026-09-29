<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { useAvailability } from '@/composables/useAvailability'
import { levelWithinMinutes, placeScrews, type ScrewReading } from '@/features/calibration/screws'
import { useCalibrationStore } from '@/stores/calibration'
import { usePrinterStore } from '@/stores/printer'

/**
 * Bed screws drawn as the bed: each screw in the corner it occupies, with
 * its turn, its height, and a way to send the toolhead to it. A table of
 * four "CW 00:15" rows made the reader map names onto corners in their
 * head; the grid is the map. Under six minutes of turn a screw says it is
 * level, in words and the check colour, never colour alone.
 *
 * "Go to" is a plain move to the screw's X and Y at the height the toolhead
 * already has — the run left it at its probing height — so a reader with a
 * sheet of paper can check each corner the way `BED_SCREWS_ADJUST` would
 * walk them, without the helper.
 */
const props = defineProps<{ screws: readonly ScrewReading[] }>()

const { t } = useI18n({ useScope: 'global' })
const calibration = useCalibrationStore()
const printer = usePrinterStore()
const { availability: klipperAvailability } = useAvailability('klipper')

const layout = computed(() => placeScrews(props.screws))

const canMove = computed(
  () =>
    klipperAvailability.value.isAvailable &&
    !printer.hasActivePrint &&
    calibration.activeRun === null &&
    !printer.pendingCommands.move,
)

function turnText(screw: ScrewReading): string {
  if (screw.isBase) return t('calibration.screws.base')
  if (screw.minutes < levelWithinMinutes) return t('calibration.screws.level')
  return `${screw.sign} ${screw.adjust}`
}
</script>

<template>
  <ul
    class="calibration-screws"
    :style="{
      '--screw-columns': layout.columns,
      '--screw-rows': layout.rows,
    }"
    :aria-label="t('calibration.procedure.screwsTilt.name')"
  >
    <li
      v-for="cell in layout.cells"
      :key="cell.screw.key"
      class="calibration-screw"
      :class="{
        'calibration-screw--base': cell.screw.isBase,
        'calibration-screw--level': !cell.screw.isBase && cell.screw.minutes < levelWithinMinutes,
      }"
      :style="{ gridColumn: cell.column, gridRow: cell.row }"
    >
      <span class="calibration-screw__name">{{ cell.screw.name }}</span>
      <span class="calibration-screw__turn">
        <span v-if="!cell.screw.isBase" aria-hidden="true">{{
          cell.screw.sign === 'CW' ? '↻' : '↺'
        }}</span>
        {{ turnText(cell.screw) }}
      </span>
      <span class="calibration-screw__z">{{
        t('calibration.screws.z', { value: cell.screw.z.toFixed(3) })
      }}</span>
      <AppButton
        variant="quiet"
        size="xs"
        icon="move"
        :label="t('calibration.screws.goTo')"
        :disabled="!canMove"
        :pending="printer.pendingCommands.move"
        @click="printer.moveTo({ x: cell.screw.x, y: cell.screw.y })"
      />
    </li>
  </ul>
</template>
