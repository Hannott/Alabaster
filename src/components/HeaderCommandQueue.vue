<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import { useCommandPreferencesStore } from '@/stores/commandPreferences'
import { summarizeScript, useCommandQueueStore } from '@/stores/commandQueue'

/**
 * The commands this browser has sent that the printer has not run yet, behind
 * a header button that exists only while there are some. Opt-in on Settings'
 * Commands card, and only while presses queue — waiting mode keeps the control
 * itself disabled, which already says the same thing where the press happened.
 */
const { t } = useI18n({ useScope: 'global' })
const queue = useCommandQueueStore()
const preferences = useCommandPreferencesStore()

/**
 * An ordinary jog settles in tens of milliseconds. Listing every command the
 * moment it was sent would flash a header button in and out on each press,
 * the short-lived state ADR 0004 rules out, so an entry counts only once it
 * has waited this long.
 */
const lingerMs = 600
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

watch(
  () => queue.entries.length > 0,
  (hasEntries) => {
    if (hasEntries && ticker === null) {
      now.value = Date.now()
      ticker = setInterval(() => (now.value = Date.now()), 250)
    } else if (!hasEntries && ticker !== null) {
      clearInterval(ticker)
      ticker = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (ticker !== null) clearInterval(ticker)
})

const isVisible = computed(
  () =>
    preferences.dispatch === 'queue' &&
    preferences.showQueue &&
    queue.entries.some((entry) => now.value - entry.sentAt >= lingerMs),
)

const count = computed(() => queue.entries.length)

function age(sentAt: number): string {
  const seconds = Math.max(0, Math.floor((now.value - sentAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
</script>

<template>
  <Transition name="header-command-queue">
    <HeaderMenu
      v-if="isVisible"
      class="header-command-queue"
      :label="t('commandQueue.label', { count })"
      align="end"
      trigger-variant="quiet"
      trigger-size="md"
      panel-class="header-command-queue__panel"
    >
      <template #trigger>
        <AppIcon name="queuedCommands" class="size-6" aria-hidden="true" />
        <span class="header-command-queue__count">{{ count }}</span>
      </template>
      <template #default>
        <p class="header-menu__section-title">{{ t('commandQueue.title') }}</p>
        <p class="header-command-queue__subtitle">{{ t('commandQueue.subtitle') }}</p>
        <ol class="grid">
          <li
            v-for="(entry, index) in queue.entries"
            :key="entry.id"
            class="header-command-queue__row"
          >
            <code class="header-command-queue__script selectable">{{
              summarizeScript(entry.script)
            }}</code>
            <span
              class="header-command-queue__state"
              :class="{ 'header-command-queue__state--running': index === 0 }"
            >
              {{ index === 0 ? t('commandQueue.running') : t('commandQueue.waiting') }}
            </span>
            <span class="header-command-queue__meta">{{ t(entry.originKey) }}</span>
            <span class="header-command-queue__meta header-command-queue__age">
              {{ age(entry.sentAt) }}
            </span>
          </li>
        </ol>
        <p class="header-command-queue__footer">{{ t('commandQueue.footer') }}</p>
      </template>
    </HeaderMenu>
  </Transition>
</template>
