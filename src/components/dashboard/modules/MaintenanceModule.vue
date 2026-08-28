<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import { useDashboardModule } from '@/dashboard/context'
import type { MaintenanceIntervalKind, MaintenanceStatus } from '@/features/history/maintenance'
import { useMaintenanceStore, type MaintenanceIntervalRow } from '@/stores/maintenance'

const { t } = useI18n({ useScope: 'global' })
const { isSettingsOpen } = useDashboardModule('maintenance')
const maintenance = useMaintenanceStore()

const kindOptions: readonly MaintenanceIntervalKind[] = ['printtime', 'filament', 'date']

function statusIcon(status: MaintenanceStatus): 'save' | 'warning' | 'refresh' {
  if (status === 'overdue' || status === 'due') return 'warning'
  if (status === 'needsBaseline') return 'refresh'
  return 'save'
}

/**
 * Rounds toward the reader's actual question — "roughly how long" — rather
 * than a false-precision count of seconds or millimetres, the same choice
 * `formatDuration` elsewhere on this destination already makes.
 */
function remainingLabel(row: MaintenanceIntervalRow): string {
  const { interval, result } = row
  if (result.status === 'needsBaseline') return t('dashboard.maintenance.needsBaseline')

  const remainingFraction = 1 - result.progress
  if (interval.kind === 'date') {
    const days = Math.round(Math.abs(remainingFraction) * interval.value)
    return remainingFraction >= 0
      ? t('dashboard.maintenance.dueInDays', { count: days })
      : t('dashboard.maintenance.overdueDays', { count: days })
  }
  if (interval.kind === 'filament') {
    const metres = Math.round((Math.abs(remainingFraction) * interval.value * 1000) / 1000)
    return remainingFraction >= 0
      ? t('dashboard.maintenance.dueInFilament', { count: metres })
      : t('dashboard.maintenance.overdueFilament', { count: metres })
  }
  const hours = Math.round(Math.abs(remainingFraction) * interval.value)
  return remainingFraction >= 0
    ? t('dashboard.maintenance.dueInHours', { count: hours })
    : t('dashboard.maintenance.overdueHours', { count: hours })
}

const adding = ref(false)
const draftName = ref('')
const draftKind = ref<MaintenanceIntervalKind>('printtime')
const draftValue = ref<number | null>(null)

const canSubmit = computed(() => draftName.value.trim().length > 0 && (draftValue.value ?? 0) > 0)

function resetDraft(): void {
  draftName.value = ''
  draftKind.value = 'printtime'
  draftValue.value = null
  adding.value = false
}

function submitDraft(): void {
  if (!canSubmit.value) return
  maintenance.addInterval(draftName.value.trim(), draftKind.value, draftValue.value as number)
  resetDraft()
}
</script>

<template>
  <AppDashboardModule :open="isSettingsOpen">
    <ul v-if="maintenance.rows.length > 0" class="maintenance-list">
      <li
        v-for="row in maintenance.rows"
        :key="row.interval.id"
        class="maintenance-row"
        :class="`maintenance-row--${row.result.status}`"
      >
        <span class="maintenance-row__name">
          <AppIcon
            :name="statusIcon(row.result.status)"
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />
          {{ row.interval.name }}
        </span>
        <span class="maintenance-row__remaining">{{ remainingLabel(row) }}</span>
        <AppButton
          variant="quiet"
          size="xs"
          :label="t('dashboard.maintenance.markPerformed')"
          @click="maintenance.markPerformed(row.interval.id)"
        />
        <AppButton
          variant="quiet"
          size="xs"
          icon-only
          icon="trash"
          :aria-label="t('dashboard.maintenance.delete', { name: row.interval.name })"
          :title="t('dashboard.maintenance.delete', { name: row.interval.name })"
          @click="maintenance.deleteInterval(row.interval.id)"
        />
      </li>
    </ul>
    <p v-else class="calibration-panel__hint">{{ t('dashboard.maintenance.empty') }}</p>

    <form v-if="adding" class="maintenance-form" @submit.prevent="submitDraft">
      <div class="settings-row">
        <label class="settings-row__label" for="maintenance-name">
          {{ t('dashboard.maintenance.nameLabel') }}
        </label>
        <input
          id="maintenance-name"
          v-model="draftName"
          type="text"
          class="field"
          :placeholder="t('dashboard.maintenance.namePlaceholder')"
          autocomplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
        />
      </div>
      <div class="settings-row">
        <span class="settings-row__label">{{ t('dashboard.maintenance.kindLabel') }}</span>
        <div class="segmented" role="group" :aria-label="t('dashboard.maintenance.kindLabel')">
          <AppButton
            v-for="option in kindOptions"
            :key="option"
            size="sm"
            :aria-pressed="draftKind === option"
            @click="draftKind = option"
          >
            {{ t(`dashboard.maintenance.kind.${option}`) }}
          </AppButton>
        </div>
      </div>
      <div class="settings-row">
        <label class="settings-row__label" for="maintenance-value">
          {{ t(`dashboard.maintenance.valueLabel.${draftKind}`) }}
        </label>
        <input
          id="maintenance-value"
          v-model.number="draftValue"
          type="number"
          min="1"
          class="field field--sm"
          autocomplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
        />
      </div>
      <div class="maintenance-form__actions">
        <AppButton
          size="sm"
          variant="primary"
          :label="t('dashboard.maintenance.add')"
          type="submit"
          :disabled="!canSubmit"
        />
        <AppButton size="sm" :label="t('dashboard.cancel')" @click="resetDraft" />
      </div>
    </form>
    <AppButton
      v-else
      size="sm"
      :label="t('dashboard.maintenance.addInterval')"
      class="mt-3"
      @click="adding = true"
    />
  </AppDashboardModule>
</template>
