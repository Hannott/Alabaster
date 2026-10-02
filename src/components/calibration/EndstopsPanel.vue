<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import { useAvailability } from '@/composables/useAvailability'
import { createTimeFormatter } from '@/i18n/formats'
import { useEndstopsStore } from '@/stores/endstops'

/**
 * What homing is actually reading. Lives beside the movement controls rather
 * than in a panel of its own somewhere else on the page: an endstop reading is
 * consulted when homing behaves oddly, which is at the moment somebody is
 * pressing Home, not at a glance.
 */
const { locale, t } = useI18n({ useScope: 'global' })
const endstops = useEndstopsStore()
const { availability: klipperAvailability } = useAvailability('klipper')
const timeFormatter = computed(() => createTimeFormatter(locale.value))
</script>

<template>
  <CalibrationCard :title="t('calibration.endstops.title')" :hint="t('calibration.endstops.hint')">
    <template #aside>
      <AppButton
        size="xs"
        :pending="endstops.isLoading"
        icon="refresh"
        :label="t('calibration.endstops.refresh')"
        :disabled="!klipperAvailability.isAvailable || endstops.isLoading"
        @click="endstops.refresh()"
      />
    </template>

    <!--
      Said once for the whole panel rather than per row: while a print runs the
      poll stops, so every reading below is equally old.
    -->
    <p v-if="endstops.isStale" class="calibration-notice" role="status">
      <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
      <span>
        {{ t('calibration.endstops.paused') }}
        <template v-if="endstops.readAt">
          {{ t('calibration.endstops.readAt', { time: timeFormatter.format(endstops.readAt) }) }}
        </template>
      </span>
    </p>
    <p v-else-if="endstops.failed" class="calibration-notice" role="status">
      <AppIcon name="warning" class="size-4 shrink-0" aria-hidden="true" />
      <span>{{
        t(endstops.hasReadings ? 'calibration.endstops.failed' : 'calibration.endstops.failedEmpty')
      }}</span>
    </p>
    <!-- Each reading carries the time it was taken, not only once it has gone stale. -->
    <p v-else-if="endstops.readAt" class="calibration-panel__hint">
      {{ t('calibration.endstops.readAt', { time: timeFormatter.format(endstops.readAt) }) }}
    </p>

    <ul v-if="endstops.hasReadings" class="calibration-endstops">
      <li v-for="reading in endstops.readings" :key="reading.name" class="calibration-endstop">
        <span class="calibration-endstop__name">{{ reading.name }}</span>
        <!--
          Shape and word, never color alone: a triggered endstop reads as
          filled with the word beside it, an open one as an outline.
        -->
        <span
          class="calibration-endstop__state"
          :class="`calibration-endstop__state--${reading.state}`"
        >
          <span class="calibration-endstop__mark" aria-hidden="true"></span>
          {{ t(`calibration.endstops.state.${reading.state}`) }}
        </span>
      </li>
    </ul>
    <!-- A refused read says nothing about the endstops, so it is not said as "none". -->
    <p v-else-if="!endstops.failed" class="calibration-panel__hint">
      {{ t('calibration.endstops.empty') }}
    </p>
  </CalibrationCard>
</template>
