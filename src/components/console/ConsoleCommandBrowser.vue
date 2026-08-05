<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { GcodeHelpEntry } from '@/stores/console'

/**
 * Every command this machine actually knows, searchable. It answers the question
 * Tab completion cannot: not "finish what I started typing" but "what can this
 * printer do, and what does that one take" — including the macros the user wrote
 * themselves, which no documentation covers.
 *
 * The list is the machine's own `gcode.commands`, so a printer without a feature
 * never offers its commands and there is nothing to keep in sync.
 */
const props = defineProps<{ commands: readonly GcodeHelpEntry[] }>()
const emit = defineEmits<{ select: [command: string] }>()

const { t } = useI18n({ useScope: 'global' })
const query = ref('')

const matches = computed(() => {
  const needle = query.value.trim().toUpperCase()
  if (needle === '') return props.commands
  // Matched against the description as well, so "mesh" finds BED_MESH_CALIBRATE
  // and anything whose help text explains it does mesh work.
  return props.commands.filter(
    (entry) =>
      entry.command.toUpperCase().includes(needle) || entry.help.toUpperCase().includes(needle),
  )
})
</script>

<template>
  <div class="console-browser">
    <label class="sr-only" for="console-command-search">{{ t('console.help.searchLabel') }}</label>
    <input
      id="console-command-search"
      v-model="query"
      type="search"
      class="field field--sm field--block console-browser__search"
      :placeholder="t('console.help.search')"
      autocomplete="off"
    />

    <p v-if="commands.length === 0" class="console-browser__note">
      {{ t('console.help.unavailable') }}
    </p>
    <template v-else>
      <!--
        The count states what the search narrowed to; at zero it would say "0
        commands" directly above the line that already says nothing matched, so
        the two swap rather than stack — the same rule the page's hidden-line
        count follows in dropping itself instead of reading "0 hidden".
      -->
      <p v-if="matches.length > 0" class="console-browser__note">
        {{ t('console.help.count', { count: matches.length }) }}
      </p>
      <p v-else class="console-browser__note">
        {{ t('console.help.empty') }}
      </p>
      <ul class="console-browser__list">
        <li v-for="entry in matches" :key="entry.command">
          <button
            type="button"
            class="button button--quiet button--xs button--start button--block"
            :title="t('console.help.insert', { command: entry.command })"
            @click="emit('select', entry.command)"
          >
            <span class="text-accent console-browser__command">{{ entry.command }}</span>
          </button>
          <p class="console-browser__help">{{ entry.help || t('console.help.noHelp') }}</p>
        </li>
      </ul>
    </template>
  </div>
</template>
