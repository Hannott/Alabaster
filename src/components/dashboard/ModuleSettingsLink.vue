<script setup lang="ts">
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'

/**
 * The link out of a card's disclosure layer into its settings surface. Every
 * disclosure layer ends with it — `ModuleSettingsPanel` puts it there, so no
 * module decides whether to have one and eleven of them cannot drift apart.
 *
 * Deliberately not the gear: the card header's gear already means "open this
 * card's disclosure layer", and one semantic action gets one icon. The popout
 * arrow says what actually happens — the card leaves the dashboard and opens
 * beside its full settings.
 *
 * The card it belongs to comes from the context rather than a prop: it is
 * always the card it is rendered inside. Outside one there is no surface to
 * open, so it does not render — and neither does it for a module whose context
 * explicitly says there is nowhere to open (`canOpenSurface: false`), which is
 * the Calibration page's page-hosted bed-mesh viewer today.
 *
 * It is a `text-action`, not a button. A `2.25rem` control was the tallest
 * thing in a panel whose rows are settings, so the way out of the panel read as
 * heavier than anything it sits under — and the row it lives in had to hold
 * that height whether or not the panel had any rows at all. Its own row and
 * divider already frame it, which is the condition the pattern asks for.
 */
const { t } = useI18n({ useScope: 'global' })
const module = inject(dashboardModuleContextKey, null)
</script>

<template>
  <div v-if="module && module.canOpenSurface !== false" class="module-settings__link-row">
    <button type="button" class="text-action module-settings__link" @click="module.openSurface()">
      <AppIcon name="popout" class="size-3.5" aria-hidden="true" />
      {{ t('dashboard.surface.open') }}
    </button>
  </div>
</template>
