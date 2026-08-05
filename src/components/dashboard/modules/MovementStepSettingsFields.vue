<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import {
  movementStepScales,
  offsetMagnitude,
  offsetStepSets,
  planarStepModes,
  planarStepSets,
  verticalStepSets,
  zOffsetUnits,
  type ZOffsetUnit,
} from '@/components/dashboard/modules/movementSteps'
import { configString, useDashboardModule } from '@/dashboard/context'
import { movementDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'

/**
 * What the jog and offset buttons are labelled with, rendered once and shared
 * verbatim between the full settings pane and the card's own quick layer — see
 * `docs/design/settings-surface.md` and
 * `MovementCardSettingsFields` for the `mode` contract these two share.
 *
 * Every row here relabels controls on the card rather than changing what the
 * card contains, which is why the settings surface docks the card beside this
 * pane: the buttons rename under the reader's eye instead of being judged
 * blind.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { locale, t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('movement')
const quick = useQuickSettings(config, updateConfig, movementDefaultQuickKeys, () => props.mode)

const stepFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 3 }),
)

function scaleFor<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
  const stored = configString(config.value, key, fallback)
  return (valid as readonly string[]).includes(stored) ? (stored as T) : fallback
}

const planarScale = computed(() => scaleFor('planarStepScale', 'coarse', planarStepModes))
const verticalScale = computed(() => scaleFor('verticalStepScale', 'fine', movementStepScales))
const offsetScale = computed(() => scaleFor('offsetStepScale', 'fine', movementStepScales))
const offsetUnit = computed<ZOffsetUnit>(() => scaleFor('zOffsetUnit', 'micrometre', zOffsetUnits))

/**
 * The offset preview is written the way the buttons will be — its own
 * separator, no locale formatting — because previewing `0,005` beside a card
 * whose buttons read `.005` would be showing the user the wrong thing. The
 * jog previews below are ordinary distances and do go through the locale.
 */
const offsetPreview = computed(() =>
  offsetStepSets[offsetScale.value]
    .map((step) => offsetMagnitude(step, offsetUnit.value))
    .join(' / '),
)

const numericGroups = computed(() => [
  {
    key: 'verticalStepScale',
    labelKey: 'dashboard.movement.verticalStepLabel',
    current: verticalScale.value as string,
    sets: verticalStepSets,
  },
  {
    key: 'offsetStepScale',
    labelKey: 'dashboard.movement.zOffsetStep',
    current: offsetScale.value as string,
    sets: offsetStepSets,
  },
])

function describe(steps: readonly number[]): string {
  return steps.map((step) => stepFormatter.value.format(step)).join(' / ')
}

/**
 * The offset scales preview in the chosen unit rather than through the locale
 * formatter, so the pane and the card agree about what `.005` versus `5` even
 * means.
 */
function describeGroup(key: string, steps: readonly number[]): string {
  if (key !== 'offsetStepScale') return describe(steps)
  return steps.map((step) => offsetMagnitude(step, offsetUnit.value)).join(' / ')
}
</script>

<template>
  <div v-if="quick.visible('planarStepScale')" class="settings-row">
    <span class="settings-row__label">{{ t('dashboard.movement.planarStepLabel') }}</span>
    <div class="flex items-center gap-2">
      <div class="segmented">
        <button
          v-for="scale in movementStepScales"
          :key="`planarStepScale-${scale}`"
          type="button"
          class="button button--sm button--value"
          :aria-pressed="planarScale === scale"
          @click="updateConfig({ planarStepScale: scale })"
        >
          {{ describe(planarStepSets[scale]) }}
        </button>
      </div>
      <QuickSettingToggle
        v-if="mode === 'pane'"
        :label="t('dashboard.movement.planarStepLabel')"
        :shown="quick.isQuick('planarStepScale')"
        @toggle="quick.setQuick('planarStepScale', $event)"
      />
    </div>
  </div>

  <!--
    A `<template>` rather than a wrapper element, because the `v-if` is on the
    row inside it: a real element here renders once per group whether or not
    the group is promoted, which left two empty boxes in the card's quick layer
    for every setting the user had turned off.
  -->
  <template v-for="group in numericGroups" :key="group.key">
    <div v-if="quick.visible(group.key)" class="settings-row">
      <span class="settings-row__label">{{ t(group.labelKey) }}</span>
      <div class="flex items-center gap-2">
        <div class="segmented">
          <button
            v-for="scale in movementStepScales"
            :key="`${group.key}-${scale}`"
            type="button"
            class="button button--sm button--value"
            :aria-pressed="group.current === scale"
            @click="updateConfig({ [group.key]: scale })"
          >
            {{ describeGroup(group.key, group.sets[scale]) }}
          </button>
        </div>
        <QuickSettingToggle
          v-if="mode === 'pane'"
          :label="t(group.labelKey)"
          :shown="quick.isQuick(group.key)"
          @toggle="quick.setQuick(group.key, $event)"
        />
      </div>
    </div>
  </template>

  <div v-if="quick.visible('zOffsetUnit')">
    <div class="settings-row">
      <span class="settings-row__label">{{ t('dashboard.movement.zOffsetUnitLabel') }}</span>
      <div class="flex items-center gap-2">
        <div class="segmented">
          <button
            v-for="unit in zOffsetUnits"
            :key="`zOffsetUnit-${unit}`"
            type="button"
            class="button button--sm"
            :aria-pressed="offsetUnit === unit"
            @click="updateConfig({ zOffsetUnit: unit })"
          >
            {{ t(`dashboard.movement.zOffsetUnit.${unit}`) }}
          </button>
        </div>
        <QuickSettingToggle
          v-if="mode === 'pane'"
          :label="t('dashboard.movement.zOffsetUnitLabel')"
          :shown="quick.isQuick('zOffsetUnit')"
          @toggle="quick.setQuick('zOffsetUnit', $event)"
        />
      </div>
    </div>
    <p v-if="mode === 'pane'" class="surface-section__hint">
      {{ t('dashboard.movement.zOffsetUnitHint', { steps: offsetPreview }) }}
    </p>
  </div>
</template>
