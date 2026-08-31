<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import type { ActionGuardResult } from '@/composables/useActionGuard'

/**
 * Every command this printer has been sent, searchable and clickable — the
 * arrow-key history made visible rather than something you can only walk one
 * step at a time and never see all at once.
 *
 * Newest first, unlike the store's own newest-last order: a browsed list reads
 * top to bottom, and the command just sent is the one most likely being looked
 * for again. The arrow-key walk in `ConsoleCommandInput` keeps the store's
 * order because it starts from the end either way.
 */
const props = defineProps<{
  /** Newest last, as the store keeps it. */
  history: readonly string[]
  clearGuard: ActionGuardResult
}>()
const emit = defineEmits<{ select: [command: string]; clear: [] }>()

const { t } = useI18n({ useScope: 'global' })
const query = ref('')

const ordered = computed(() => [...props.history].reverse())
const matches = computed(() => {
  const needle = query.value.trim().toUpperCase()
  if (needle === '') return ordered.value
  return ordered.value.filter((command) => command.toUpperCase().includes(needle))
})
</script>

<template>
  <div class="console-browser">
    <label class="sr-only" for="console-history-search">{{
      t('console.history.searchLabel')
    }}</label>
    <input
      id="console-history-search"
      v-model="query"
      type="search"
      class="field field--sm field--block console-browser__search"
      :placeholder="t('console.history.search')"
      autocomplete="off"
      data-1p-ignore
      data-lpignore="true"
      data-bwignore
    />

    <p v-if="history.length === 0" class="console-browser__note">
      {{ t('console.history.unavailable') }}
    </p>
    <template v-else>
      <!--
        Same swap as the command browser's own count/empty pair: at zero matches
        the count would sit directly above a line already saying nothing
        matched, so only one of the two ever renders.
      -->
      <p v-if="matches.length > 0" class="console-browser__note">
        {{ t('console.history.count', { count: matches.length }) }}
      </p>
      <p v-else class="console-browser__note">
        {{ t('console.history.empty') }}
      </p>
      <ul class="console-browser__list">
        <li v-for="command in matches" :key="command">
          <AppButton
            variant="quiet"
            size="xs"
            start
            block
            :title="t('console.history.insert', { command })"
            @click="emit('select', command)"
          >
            <span class="text-accent console-browser__command">{{ command }}</span>
          </AppButton>
        </li>
      </ul>
    </template>

    <!--
      Forgetting what has been typed belongs beside the list it empties rather
      than on a settings row elsewhere, now that the history is something you
      look at rather than something you are only told the size of.
    -->
    <AppButton
      size="sm"
      start
      :guard="clearGuard"
      icon="trash"
      :disabled="history.length === 0"
      :label="t('console.clearHistory')"
      @click="emit('clear')"
    />
  </div>
</template>
