<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { createDateFormatter } from '@/i18n/formats'
import type { MoonrakerCommitBehind } from '@/services/moonraker'

/**
 * The upstream-commit list shared by `UpdateRecoveryDialog` (a repository
 * needing attention) and the update confirmation's changelog: same fields,
 * same formatting, so a canonical implementation exists rather than two
 * copies of the same date math drifting apart.
 */
const props = defineProps<{ commits: readonly MoonrakerCommitBehind[] }>()

const { locale } = useI18n({ useScope: 'global' })
const commitDateFormatter = computed(() => createDateFormatter(locale.value))

function commitDate(seconds: string): string {
  const value = Number(seconds)
  return Number.isFinite(value) ? commitDateFormatter.value.format(new Date(value * 1000)) : '—'
}
</script>

<template>
  <ol class="update-recovery-commits selectable">
    <li v-for="commit in props.commits" :key="commit.sha">
      <p class="update-recovery-commit__subject">{{ commit.subject }}</p>
      <p class="update-recovery-commit__meta">
        <span class="update-recovery-commit__sha">{{ commit.sha.slice(0, 8) }}</span>
        <span>{{ commit.author }}</span>
        <span>{{ commitDate(commit.date) }}</span>
      </p>
    </li>
  </ol>
</template>
