<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConsolePanel from '@/components/console/ConsolePanel.vue'
import PageHeading from '@/components/PageHeading.vue'

/**
 * The full console. The dashboard card is for sending a command and watching the
 * answer; this is where a print's whole history is read back, where a filter is
 * set up, and where the machine's own command list is browsed.
 *
 * A `workspace-page` rather than a `standard-page`: the transcript has to take
 * the remaining viewport and own its own scrolling, which is the distinction
 * interface-standards.md draws between the two shells — and which is exactly
 * what `fill` asks `ConsolePanel` for.
 *
 * The console itself is `ConsolePanel`, shared with the Calibration bench. This
 * route is a page shell around it now: a heading, an availability region, and
 * the one fact only the route knows, which is that it has bounded the height.
 */
const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <section class="workspace-page console-page">
    <PageHeading :title="t('console.title')" />

    <AvailabilityRegion requires="klipper" class="console-page__availability">
      <ConsolePanel fill />
    </AvailabilityRegion>
  </section>
</template>
