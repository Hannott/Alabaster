<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import AppSelect, { type AppSelectOption } from '@/components/AppSelect.vue'
import AppDashboardModule from '@/components/dashboard/AppDashboardModule.vue'
import SpoolQuickSettings from '@/components/dashboard/modules/SpoolQuickSettings.vue'
import { useDashboardModule } from '@/dashboard/context'
import {
  filamentFitStatus,
  filamentTemperatureMismatch,
  remainingFilamentNeeded,
} from '@/dashboard/printReadiness'
import type { MoonrakerGcodeMetadata, SpoolmanFilament } from '@/services/moonraker'
import { useJobQueueStore } from '@/stores/jobQueue'
import { usePrinterStore } from '@/stores/printer'
import { useSpoolStore } from '@/stores/spool'

const noSpoolValue = ''

const { locale, t } = useI18n({ useScope: 'global' })
const spool = useSpoolStore()
const { isSettingsOpen } = useDashboardModule('spool')
const printer = usePrinterStore()
const jobQueue = useJobQueueStore()

/** The queued file's own metadata, fetched on demand — nothing else needs it. */
const queuedMetadata = ref<MoonrakerGcodeMetadata | null>(null)

const weightFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }),
)
const lengthFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
)

const filament = computed<SpoolmanFilament | null>(() => spool.activeSpool?.filament ?? null)

const filamentName = computed(() => {
  const current = filament.value
  return current?.name || current?.material || t('dashboard.spool.unnamedFilament')
})

const vendorName = computed(() => filament.value?.vendor?.name ?? null)

const swatchColor = computed(() => {
  const hex = filament.value?.color_hex
  if (!hex) return null
  return hex.startsWith('#') ? hex : `#${hex}`
})

const remainingWeightLabel = computed(() => {
  const remaining = spool.activeSpool?.remaining_weight
  if (remaining === null || remaining === undefined) return null
  return `${weightFormatter.value.format(remaining)}${t('dashboard.weightUnit')}`
})

const remainingLengthLabel = computed(() => {
  const remaining = spool.activeSpool?.remaining_length
  if (remaining === null || remaining === undefined) return null
  return `${lengthFormatter.value.format(remaining / 1000)}${t('dashboard.lengthUnit')}`
})

const queuedFilename = computed(() => jobQueue.jobs[0]?.filename ?? null)

watch(
  queuedFilename,
  async (filename) => {
    queuedMetadata.value = filename ? await printer.loadMetadata(filename) : null
  },
  { immediate: true },
)

/**
 * The weight the next thing to print actually needs: the running job's own
 * metadata while one is printing, otherwise the front of the queue. An active
 * print narrows this to what finishing it still takes rather than the job's
 * whole-job total — the total was the right question before the first layer,
 * but a job partway through has already drawn the same amount down from the
 * spool's own `remaining_weight`, so comparing the unadjusted total against
 * an already-reduced remaining weight flags a print that started with plenty
 * and is proceeding exactly as expected as short. `filamentProgress` is
 * `printer.ts`'s own extrusion-based fraction — not the byte- or time-based
 * progress signals, which track the file rather than the filament and would
 * reintroduce a different mismatch — and it is 0 whenever the metadata never
 * reported `filament_total`, which safely falls back to the full total rather
 * than reading as "nothing left to print." Neither total is asked for unless
 * the corresponding filename exists, since `filament_total` for a *different*
 * file would answer the wrong question entirely.
 */
const neededWeight = computed(() => {
  if (printer.hasActivePrint) {
    return remainingFilamentNeeded(
      printer.currentMetadata?.filament_weight_total,
      printer.filamentProgress,
    )
  }
  return queuedMetadata.value?.filament_weight_total ?? null
})

/**
 * Whether the spool has enough left — `printReadiness.ts`'s shared answer to
 * this question, so Print Files and Print's own "up next" preview can never
 * disagree with this card about the same file.
 */
const fitStatus = computed(() =>
  filamentFitStatus(neededWeight.value, spool.activeSpool?.remaining_weight),
)

/** The extruder temperature the next thing to print actually asks for — same source as `neededWeight`. */
const neededExtruderTemp = computed(() => {
  if (printer.hasActivePrint) return printer.currentMetadata?.first_layer_extr_temp ?? null
  return queuedMetadata.value?.first_layer_extr_temp ?? null
})

const temperatureMismatch = computed(() =>
  filamentTemperatureMismatch(filament.value?.settings_extruder_temp, neededExtruderTemp.value),
)

function filamentLabel(candidate: SpoolmanFilament): string {
  const name = candidate.name || candidate.material || t('dashboard.spool.unnamedFilament')
  return candidate.vendor?.name ? `${candidate.vendor.name} — ${name}` : name
}

const spoolOptions = computed<AppSelectOption[]>(() => [
  { value: noSpoolValue, label: t('dashboard.spool.noSpoolOption') },
  ...spool.availableSpools.map((candidate) => ({
    value: String(candidate.id),
    label: filamentLabel(candidate.filament),
  })),
])

const selectedSpoolValue = computed(() =>
  spool.activeSpoolId === null ? noSpoolValue : String(spool.activeSpoolId),
)

function onSwitchSpool(value: string): void {
  void spool.setActiveSpool(value === noSpoolValue ? null : Number(value))
}

onMounted(() => {
  void spool.loadAvailableSpools()
})
</script>

<template>
  <AppDashboardModule :open="isSettingsOpen">
    <template #quick-settings>
      <SpoolQuickSettings />
    </template>

    <div class="min-w-0">
      <p class="text-eyebrow text-data-sky">
        {{ t('dashboard.spool.eyebrow') }}
      </p>

      <p
        v-if="spool.spoolmanConnected === false"
        class="mt-1 flex items-center gap-1.5 text-card-title text-caution-text"
      >
        <AppIcon name="warning" class="size-3.5 shrink-0" aria-hidden="true" />
        {{ t('dashboard.spool.disconnected') }}
      </p>
      <p v-else-if="!spool.hasActiveSpool" class="mt-1 text-card-title text-muted">
        {{ t('dashboard.spool.none') }}
      </p>
      <p v-else class="mt-1 flex items-center gap-1.5 text-card-title">
        <!--
          The swatch renders the filament's own reported color, not a theme
          token — real-world spool data, the same category as a user-picked
          avatar color, not a semantic UI role.
        -->
        <span
          v-if="swatchColor"
          class="spool-swatch"
          :style="{ backgroundColor: swatchColor }"
          aria-hidden="true"
        ></span>
        <span class="truncate">
          {{ vendorName ? `${vendorName} — ${filamentName}` : filamentName }}
        </span>
      </p>
    </div>

    <dl v-if="spool.hasActiveSpool" class="grid grid-cols-2 gap-2 text-xs">
      <div>
        <dt class="text-muted">{{ t('dashboard.spool.remainingWeight') }}</dt>
        <dd class="mt-1 font-mono font-black tabular-nums">
          {{ remainingWeightLabel ?? t('dashboard.unavailableValue') }}
        </dd>
      </div>
      <div>
        <dt class="text-muted">{{ t('dashboard.spool.remainingLength') }}</dt>
        <dd class="mt-1 font-mono font-black tabular-nums">
          {{ remainingLengthLabel ?? t('dashboard.unavailableValue') }}
        </dd>
      </div>
    </dl>

    <!--
      Positive reassurance is about what is coming up, not what is already
      underway: "enough for the next print" answers a pre-flight question, and
      showing it again mid-print would just repeat something already true and
      already being acted on. A print that is actually short still warns below
      regardless of which of the two this is.
    -->
    <p v-if="fitStatus === 'fits' && !printer.hasActivePrint" class="text-xs text-muted">
      {{ t('dashboard.spool.fits') }}
    </p>
    <p v-else-if="fitStatus === 'short'" class="flex items-center gap-1.5 text-alert-inline">
      <AppIcon name="warning" class="size-3.5 shrink-0" aria-hidden="true" />
      {{
        t('dashboard.spool.short', {
          needed: weightFormatter.format(neededWeight ?? 0),
          remaining: weightFormatter.format(spool.activeSpool?.remaining_weight ?? 0),
          unit: t('dashboard.weightUnit'),
        })
      }}
    </p>
    <p v-if="temperatureMismatch" class="flex items-center gap-1.5 text-alert-inline">
      <AppIcon name="warning" class="size-3.5 shrink-0" aria-hidden="true" />
      {{
        t('dashboard.spool.temperatureMismatch', {
          filament: temperatureMismatch.filamentExtruderTemp,
          file: temperatureMismatch.fileExtruderTemp,
        })
      }}
    </p>

    <AppSelect
      v-if="spool.spoolmanConnected !== false"
      :model-value="selectedSpoolValue"
      :options="spoolOptions"
      :label="t('dashboard.spool.switchLabel')"
      :disabled="spool.pendingCommands.setActiveSpool"
      @update:model-value="onSwitchSpool"
    />
  </AppDashboardModule>
</template>
