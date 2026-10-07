<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { useCommandPreferencesStore, type CommandDispatchMode } from '@/stores/commandPreferences'

/**
 * What a button does while the printer is still working through an earlier
 * command. Calibration prompts, procedures and homing are not mentioned: they
 * wait in both modes (`repeatableCommandKeys` in `stores/printer.ts`), and
 * saying so here would explain an implementation detail nobody asked about.
 */
const { t } = useI18n({ useScope: 'global' })
const preferences = useCommandPreferencesStore()

const modes: readonly CommandDispatchMode[] = ['queue', 'wait']
</script>

<template>
  <section class="page-card">
    <p class="text-eyebrow text-data-blue">{{ t('commands.eyebrow') }}</p>
    <h2 class="mt-2 text-section-title">{{ t('commands.title') }}</h2>
    <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">{{ t('commands.description') }}</p>

    <div class="commands-options mt-7">
      <label
        v-for="mode in modes"
        :key="mode"
        class="commands-option check-row check-row--block selection-row"
        :class="{ 'selection-row--selected': preferences.dispatch === mode }"
      >
        <input
          type="radio"
          name="command-dispatch"
          :checked="preferences.dispatch === mode"
          @change="preferences.setDispatch(mode)"
        />
        <span>
          <span class="commands-option__name">{{ t(`commands.mode.${mode}`) }}</span>
          <span class="commands-option__detail">{{ t(`commands.modeDetail.${mode}`) }}</span>
        </span>
      </label>
    </div>

    <!-- Disabled rather than hidden while waiting, so the option stays discoverable and the card keeps its height. -->
    <label class="check-row mt-5">
      <input
        type="checkbox"
        :checked="preferences.showQueue"
        :disabled="preferences.dispatch !== 'queue'"
        @change="preferences.setShowQueue(!preferences.showQueue)"
      />
      <span>{{ t('commands.showQueue') }}</span>
    </label>
    <p class="commands-card__hint">{{ t('commands.showQueueHint') }}</p>
  </section>
</template>
