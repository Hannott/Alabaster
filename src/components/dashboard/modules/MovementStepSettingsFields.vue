<script setup lang="ts">
import { computed, nextTick, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import {
  offsetMagnitude,
  readOffsetSteps,
  readPlanarSteps,
  readVerticalSteps,
  zOffsetUnits,
  type ZOffsetUnit,
} from '@/components/dashboard/modules/movementSteps'
import { configString, useDashboardModule } from '@/dashboard/context'
import { movementDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'

/**
 * What the jog and offset buttons are labeled with, rendered once and shared
 * verbatim between the full settings pane and the card's own quick layer — see
 * `docs/design/settings-surface.md` and `MovementCardSettingsFields` for the
 * `mode` contract these two share.
 *
 * Every row here relabels controls on the card rather than changing what the
 * card contains, which is why the settings surface docks the card beside this
 * pane: the buttons rename under the reader's eye instead of being judged
 * blind.
 *
 * Each group used to be a choice between two named presets, `fine` and
 * `coarse`, shown as a compact segmented picker — which is what used to make
 * it promotable to the card's own quick layer through the pin every other row
 * in this file still carries. It is a plain editable list now — add a value,
 * remove a value — because a preset only earns its keep if it can express
 * something the editor cannot, and a fixed pair of three-number arrays was
 * fully inside what a list editor already covers. See `movementSteps.ts` for
 * the defaults a fresh instance starts from and the fallback a pre-upgrade
 * profile reads through.
 *
 * The three step-list groups carry no pin, and render only in `mode ===
 * 'pane'`, on purpose: unlike a two-button picker, an add/remove list has no
 * compact form that still fits the card's quick disclosure without crowding
 * out what put the card there. `TemperaturesSettingsPane`'s preset editor is
 * the precedent — the same shape of control, pane-only there for the same
 * reason. Only `zOffsetUnit` below stays a `.settings-row` segmented picker
 * with its own pin: it is still a two-way choice, not a list, so nothing
 * about it changed.
 */
type StepGroupKey = 'planarSteps' | 'verticalSteps' | 'offsetSteps'

const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const { config, updateConfig } = useDashboardModule('movement')
const quick = useQuickSettings(config, updateConfig, movementDefaultQuickKeys, () => props.mode)

function scaleFor<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
  const stored = configString(config.value, key, fallback)
  return (valid as readonly string[]).includes(stored) ? (stored as T) : fallback
}

const offsetUnit = computed<ZOffsetUnit>(() => scaleFor('zOffsetUnit', 'micrometre', zOffsetUnits))

/**
 * The offset group's own values are always stored in millimetres — see
 * `movementSteps.ts` — but the card can be asked to display them in
 * micrometres, and the docked card is what this editor sits beside. Editing
 * in millimetres while the live buttons beside the editor read `+5`, `+10` in
 * micrometres would leave the reader converting by hand to tell whether an
 * edit landed; these two convert instead.
 */
function offsetMillimetresToDraft(millimetres: number): string {
  return offsetUnit.value === 'micrometre'
    ? String(Math.round(millimetres * 1000))
    : String(millimetres)
}

function offsetDraftToMillimetres(raw: string): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return NaN
  return offsetUnit.value === 'micrometre' ? parsed / 1000 : parsed
}

/**
 * The editable drafts, held here rather than read back out of the card's
 * configuration on every render — the same reason `TemperaturesSettingsPane`
 * holds `presetDrafts`. Vue re-applies a `:value` binding on every render
 * whether or not the bound value changed, and reading straight off `config`
 * would reset a field mid-word the instant anything else on the card caused a
 * re-render. Seeding once, here, is the whole of the synchronisation needed,
 * since nothing but this editor itself ever changes these three keys.
 */
const drafts = reactive<Record<StepGroupKey, string[]>>({
  planarSteps: readPlanarSteps(config.value).map(String),
  verticalSteps: readVerticalSteps(config.value).map(String),
  offsetSteps: readOffsetSteps(config.value).map(offsetMillimetresToDraft),
})

/**
 * Reverting a rejected edit writes the same string the draft already held —
 * from Vue's own view, nothing changed, so the `:value` binding never
 * re-patches and the input goes on showing whatever the user actually typed.
 * `MovementModule.vue`'s own axis boxes hit the same wall for the same
 * reason (see its `commitAxisTarget` doc comment) and the fix is the one this
 * borrows: a revision counter folded into the item's `:key` forces a fresh
 * input element exactly when a revert needs the DOM to actually change,
 * without touching it on every ordinary edit.
 */
const revisions = reactive<Record<StepGroupKey, number>>({
  planarSteps: 0,
  verticalSteps: 0,
  offsetSteps: 0,
})

// Switching the display unit reformats the offset drafts in place — a drawn
// choice about how these numbers are written, never a change to the
// millimetre values already committed underneath them.
watch(offsetUnit, () => {
  drafts.offsetSteps = readOffsetSteps(config.value).map(offsetMillimetresToDraft)
})

function readCommitted(key: StepGroupKey): number[] {
  if (key === 'planarSteps') return readPlanarSteps(config.value)
  if (key === 'verticalSteps') return readVerticalSteps(config.value)
  return readOffsetSteps(config.value)
}

function draftToStored(key: StepGroupKey, raw: string): number {
  return key === 'offsetSteps' ? offsetDraftToMillimetres(raw) : Number(raw)
}

function storedToDraft(key: StepGroupKey, value: number): string {
  return key === 'offsetSteps' ? offsetMillimetresToDraft(value) : String(value)
}

function commitGroup(key: StepGroupKey): void {
  const values = drafts[key]
    .map((raw) => draftToStored(key, raw))
    .filter((value) => Number.isFinite(value) && value > 0)
  updateConfig({ [key]: values })
}

/**
 * A value that will not parse to a real, positive distance reverts to the
 * last committed number rather than being written or silently dropped — the
 * field is where invalid input is caught, not `configNumberList`, which only
 * decides what a hand-edited profile degrades to.
 */
function commitStepValue(key: StepGroupKey, index: number, raw: string): void {
  const parsed = draftToStored(key, raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const committed = readCommitted(key)[index]
    drafts[key][index] = committed === undefined ? '' : storedToDraft(key, committed)
    revisions[key]++
    return
  }
  drafts[key][index] = storedToDraft(key, parsed)
  commitGroup(key)
}

const groupContainers: Record<StepGroupKey, HTMLElement | null> = {
  planarSteps: null,
  verticalSteps: null,
  offsetSteps: null,
}

function setGroupContainer(key: StepGroupKey, element: unknown) {
  groupContainers[key] = element instanceof HTMLElement ? element : null
}

async function addStepValue(key: StepGroupKey): Promise<void> {
  drafts[key] = [...drafts[key], '']
  await nextTick()
  const inputs = groupContainers[key]?.querySelectorAll<HTMLInputElement>('input')
  inputs?.[inputs.length - 1]?.focus()
}

/** Never down to zero: a side with no step buttons is not a jog row. */
function removeStepValue(key: StepGroupKey, index: number): void {
  if (drafts[key].length <= 1) return
  drafts[key] = drafts[key].filter((_, at) => at !== index)
  commitGroup(key)
}

interface StepGroup {
  key: StepGroupKey
  labelKey: string
  step: number
}

const stepGroups = computed<StepGroup[]>(() => [
  { key: 'planarSteps', labelKey: 'dashboard.movement.planarStepLabel', step: 0.1 },
  { key: 'verticalSteps', labelKey: 'dashboard.movement.verticalStepLabel', step: 0.1 },
  {
    key: 'offsetSteps',
    labelKey: 'dashboard.movement.zOffsetStep',
    step: offsetUnit.value === 'micrometre' ? 1 : 0.001,
  },
])

/**
 * The offset scales preview in the chosen unit rather than through the locale
 * formatter, so the pane and the card agree about what `.005` versus `5` even
 * means. Reads the committed values rather than the raw drafts, so a value
 * mid-edit or left blank does not flicker through the preview line.
 */
const offsetPreview = computed(() =>
  readOffsetSteps(config.value)
    .map((step) => offsetMagnitude(step, offsetUnit.value))
    .join(' / '),
)
</script>

<template>
  <template v-for="group in stepGroups" :key="group.key">
    <div v-if="mode === 'pane'" class="step-group">
      <span class="settings-row__label">{{ t(group.labelKey) }}</span>
      <div :ref="(element) => setGroupContainer(group.key, element)" class="step-editor">
        <div
          v-for="(value, index) in drafts[group.key]"
          :key="`${group.key}-${index}-${revisions[group.key]}`"
          class="step-editor__item"
        >
          <input
            type="number"
            class="field field--xs field--value"
            min="0"
            :step="group.step"
            :value="value"
            :aria-label="
              t('dashboard.movement.stepValueLabel', { group: t(group.labelKey), index: index + 1 })
            "
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            @change="commitStepValue(group.key, index, ($event.target as HTMLInputElement).value)"
          />
          <AppButton
            variant="quiet"
            size="xs"
            icon-only
            :disabled="drafts[group.key].length <= 1"
            :aria-label="
              t('dashboard.movement.stepRemoveLabel', {
                group: t(group.labelKey),
                index: index + 1,
              })
            "
            :title="
              t('dashboard.movement.stepRemoveLabel', {
                group: t(group.labelKey),
                index: index + 1,
              })
            "
            @click="removeStepValue(group.key, index)"
          >
            <AppIcon name="close" class="size-4 shrink-0" aria-hidden="true" />
          </AppButton>
        </div>
        <AppButton variant="quiet" size="xs" @click="addStepValue(group.key)">
          <AppIcon name="add" class="size-4 shrink-0" aria-hidden="true" />
          {{ t('dashboard.movement.stepAdd') }}
        </AppButton>
      </div>
      <p v-if="group.key === 'offsetSteps'" class="surface-section__hint">
        {{ t('dashboard.movement.zOffsetUnitHint', { steps: offsetPreview }) }}
      </p>
    </div>
  </template>

  <div v-if="quick.visible('zOffsetUnit')" class="settings-row">
    <span class="settings-row__label">{{ t('dashboard.movement.zOffsetUnitLabel') }}</span>
    <div class="flex items-center gap-2">
      <div class="segmented">
        <AppButton
          v-for="unit in zOffsetUnits"
          :key="`zOffsetUnit-${unit}`"
          size="sm"
          :aria-pressed="offsetUnit === unit"
          @click="updateConfig({ zOffsetUnit: unit })"
        >
          {{ t(`dashboard.movement.zOffsetUnit.${unit}`) }}
        </AppButton>
      </div>
      <QuickSettingToggle
        v-if="mode === 'pane'"
        :label="t('dashboard.movement.zOffsetUnitLabel')"
        :shown="quick.isQuick('zOffsetUnit')"
        @toggle="quick.setQuick('zOffsetUnit', $event)"
      />
    </div>
  </div>
</template>
