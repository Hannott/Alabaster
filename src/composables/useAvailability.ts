import { computed, toValue, type MaybeRefOrGetter } from 'vue'

import {
  useAvailabilityStore,
  type AvailabilityReason,
  type AvailabilityRequirement,
} from '@/stores/availability'

const messageKeyByReason: Record<AvailabilityReason, string> = {
  none: 'availability.available',
  moonrakerConnecting: 'availability.moonrakerConnecting',
  moonrakerReconnecting: 'availability.moonrakerReconnecting',
  moonrakerDisconnected: 'availability.moonrakerDisconnected',
  klipperStarting: 'availability.klipperStarting',
  printerSynchronizing: 'availability.printerSynchronizing',
  klipperDisconnected: 'availability.klipperDisconnected',
  klipperError: 'availability.klipperError',
  klipperShutdown: 'availability.klipperShutdown',
}

export function useAvailability(requirement: MaybeRefOrGetter<AvailabilityRequirement>) {
  const store = useAvailabilityStore()
  const availability = computed(() => store.availabilityFor(toValue(requirement)))
  const messageKey = computed(() => messageKeyByReason[availability.value.reason])

  return {
    availability,
    messageKey,
    isAvailable: computed(() => availability.value.isAvailable),
    isRecovering: computed(() => availability.value.phase === 'recovering'),
    isStale: computed(() => availability.value.isStale),
  }
}
