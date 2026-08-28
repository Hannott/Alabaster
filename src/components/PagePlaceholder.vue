<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import { navigationDestinations, type NavigationDestinationName } from '@/navigation/destinations'
import type { PageShell } from '@/router/pages'

/**
 * The destination's own geometry, standing in while its module arrives.
 *
 * Not a spinner in the middle of an empty page: the shell, its scroll behavior,
 * its heading block, and one card's worth of space are the page's real layout,
 * so what lands in them does not move anything. It carries no borrowed copy
 * either — a title here that the arriving page words differently would change
 * under the reader's eye. The name of the destination is announced to a screen
 * reader instead, where it is information rather than a guess at the heading.
 */
const props = defineProps<{
  shell: PageShell
  page: NavigationDestinationName
  state?: 'loading' | 'error'
}>()

const { t } = useI18n({ useScope: 'global' })

const isError = computed(() => props.state === 'error')

const pageLabel = computed(() => {
  const destination = navigationDestinations.find((entry) => entry.name === props.page)
  return destination ? t(destination.labelKey) : ''
})

/** A failed module is a missing asset, so the recovery is a fresh document. */
function reload(): void {
  window.location.reload()
}
</script>

<template>
  <section
    class="page-placeholder"
    :class="props.shell === 'workspace' ? 'workspace-page' : 'standard-page'"
    :aria-busy="isError ? undefined : 'true'"
  >
    <template v-if="isError">
      <div class="page-column">
        <div class="page-card page-placeholder__failure" role="alert">
          <AppIcon name="warning" class="size-6 shrink-0 text-danger-text" aria-hidden="true" />
          <div>
            <h1 class="page-placeholder__failure-title">
              {{ t('navigation.pageFailed.title', { page: pageLabel }) }}
            </h1>
            <p class="page-placeholder__failure-description">
              {{ t('navigation.pageFailed.description') }}
            </p>
          </div>
          <AppButton
            size="sm"
            icon="refresh"
            :label="t('navigation.pageFailed.action')"
            @click="reload"
          />
        </div>
      </div>
    </template>

    <template v-else>
      <p class="sr-only" role="status">{{ t('navigation.loadingPage', { page: pageLabel }) }}</p>

      <header v-if="props.shell === 'standard'" class="page-heading" aria-hidden="true">
        <div class="page-placeholder__heading">
          <span class="page-placeholder__bar page-placeholder__bar--title"></span>
        </div>
      </header>

      <div v-if="props.shell === 'standard'" class="page-column">
        <div class="page-card page-placeholder__panel" aria-hidden="true">
          <span class="page-placeholder__track"><span></span></span>
        </div>
      </div>
      <div v-else class="page-placeholder__workspace" aria-hidden="true">
        <span class="page-placeholder__track"><span></span></span>
      </div>
    </template>
  </section>
</template>
