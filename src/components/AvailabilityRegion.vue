<script setup lang="ts">
import { useAvailability } from '@/composables/useAvailability'
import type { AvailabilityRequirement } from '@/stores/availability'

const props = defineProps<{
  requires: AvailabilityRequirement
  disableInteraction?: boolean
}>()

const { availability } = useAvailability(() => props.requires)
</script>

<template>
  <div
    class="availability-region"
    :class="`availability-region--${availability.phase}`"
    :data-availability="availability.phase"
    :aria-busy="availability.phase === 'recovering' || undefined"
  >
    <div
      class="availability-region__content"
      :inert="props.disableInteraction && !availability.isAvailable"
      :aria-disabled="props.disableInteraction && !availability.isAvailable ? 'true' : undefined"
    >
      <slot
        :availability="availability"
        :is-available="availability.isAvailable"
        :is-stale="availability.isStale"
      ></slot>
    </div>
  </div>
</template>
