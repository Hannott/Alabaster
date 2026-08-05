<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppSlider from '@/components/AppSlider.vue'
import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import SurfaceSection from '@/components/dashboard/SurfaceSection.vue'
import type { QuickSettingsController } from '@/dashboard/quickSettings'

export interface ConsoleSettings {
  hideTemperatureReports: boolean
  hideTimelapseCommands: boolean
  showTimestamps: boolean
  compact: boolean
  rawOutput: boolean
  followNewest: boolean
  visibleLines: number
  /** Where the prompt sits relative to the transcript. */
  inputPosition: 'top' | 'bottom'
}

/**
 * The console's option rows, shared by the dashboard card's settings pane, the
 * card's own quick layer, and the console page's settings. Written once because
 * all three configure the same behavior: offering a filter on one and not the
 * others is how a user ends up with a card that hides temperature reports and a
 * page that does not, with nothing to explain the difference.
 *
 * It owns no state. Each surface persists where it should — the card in its
 * dashboard profile per ADR 0006, the page in its own preference key — and this
 * component only reports the change.
 *
 * `mode` is the same contract every module's fields component uses (see
 * `docs/design/settings-surface.md`), with one extra case for the page:
 *
 * - `pane` — the card's settings surface. Every row, always, in this fixed
 *   order, each carrying the pin that decides whether it is also quick.
 * - `quick` — the card's own disclosure layer. Only the rows the pane has
 *   flagged, with no pins (demoting is a decision made from the pane) and no
 *   section headings, since a heading over one promoted row names a section of
 *   one.
 * - `page` — the console page, which is not a card and has no quick layer.
 *   Every row, no pins.
 *
 * Promotion is offered on every row but the visible-line count. That one is a
 * slider with its own header, two rows tall, and it is also the one setting
 * that means nothing on the page — the card sizes itself in lines, the page
 * fills its pane.
 */
const props = withDefaults(
  defineProps<{
    settings: ConsoleSettings
    /** The machine has timelapse, so its filter is worth offering. */
    hasTimelapse?: boolean
    /** The card sizes itself in lines; the page fills its pane and has no count. */
    showLineCount?: boolean
    mode?: 'pane' | 'quick' | 'page'
    /** Which rows are promoted, and how to promote one. Absent on the page. */
    quick?: QuickSettingsController | null
  }>(),
  {
    hasTimelapse: false,
    showLineCount: false,
    mode: 'page',
    quick: null,
  },
)

const emit = defineEmits<{ update: [patch: Partial<ConsoleSettings>] }>()

const { t } = useI18n({ useScope: 'global' })

/**
 * The slider's span is the range worth dragging; the field's is what the card will
 * actually accept. A slider stretched over every permitted value would spend most
 * of its travel on card heights nobody wants, so typing stays the way past 20.
 */
const sliderMinimumLines = 5
const sliderMaximumLines = 20
const minimumLines = 5
const maximumLines = 100

const isQuickLayer = computed(() => props.mode === 'quick')
/** Only the pane offers the pin; the page has no quick layer to promote into. */
const pins = computed(() => props.mode === 'pane' && props.quick !== null)

function shows(key: keyof ConsoleSettings): boolean {
  return !isQuickLayer.value || (props.quick?.isQuick(key) ?? false)
}

/** The count is a slider, so it is never promotable and never on the page. */
const showsLines = computed(() => props.showLineCount && !isQuickLayer.value)

/** True when a group has nothing left to show, so its heading goes too. */
const showsFilters = computed(
  () => shows('hideTemperatureReports') || (props.hasTimelapse && shows('hideTimelapseCommands')),
)
const showsDisplay = computed(
  () =>
    shows('showTimestamps') ||
    shows('compact') ||
    shows('rawOutput') ||
    shows('followNewest') ||
    shows('inputPosition') ||
    showsLines.value,
)

/*
 * Filters leads both the pane and the page, so it never draws a rule; Display
 * draws one only when something stood above it. Which section is first depends
 * on what is left standing, so it is computed rather than hard-coded — Filters
 * disappearing on a printer without timelapse is what left Display as the first
 * section with a rule against the top of the panel.
 */
const dividesDisplay = computed(() => showsFilters.value)

function toggle(key: keyof ConsoleSettings): void {
  emit('update', { [key]: !props.settings[key] })
}

function setInputPosition(position: 'top' | 'bottom'): void {
  emit('update', { inputPosition: position })
}

function setLines(value: number): void {
  emit('update', {
    visibleLines: Math.min(Math.max(Math.round(value), minimumLines), maximumLines),
  })
}
</script>

<template>
  <SurfaceSection
    v-if="showsFilters"
    :title="t('console.settings.filters')"
    :hint="t('console.settings.filtersHint')"
    :bare="isQuickLayer"
  >
    <div v-if="shows('hideTemperatureReports')" class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="settings.hideTemperatureReports"
          @change="toggle('hideTemperatureReports')"
        />
        <span>{{ t('console.settings.hideTemperatureReports') }}</span>
      </label>
      <QuickSettingToggle
        v-if="pins"
        :label="t('console.settings.hideTemperatureReports')"
        :shown="quick!.isQuick('hideTemperatureReports')"
        @toggle="quick!.setQuick('hideTemperatureReports', $event)"
      />
    </div>
    <div v-if="hasTimelapse && shows('hideTimelapseCommands')" class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="settings.hideTimelapseCommands"
          @change="toggle('hideTimelapseCommands')"
        />
        <span>{{ t('console.settings.hideTimelapseCommands') }}</span>
      </label>
      <QuickSettingToggle
        v-if="pins"
        :label="t('console.settings.hideTimelapseCommands')"
        :shown="quick!.isQuick('hideTimelapseCommands')"
        @toggle="quick!.setQuick('hideTimelapseCommands', $event)"
      />
    </div>
  </SurfaceSection>

  <SurfaceSection
    v-if="showsDisplay"
    :title="t('console.settings.display')"
    :divided="dividesDisplay"
    :bare="isQuickLayer"
  >
    <!--
      The label leads here, unlike a checkbox row. A segmented track is a wide
      box, and a label trailing one reads as a caption for the row *below* it
      rather than for the control it belongs to — see settings-surface.md, which
      records this as the third row order alongside leading checkboxes and
      trailing value fields. The track and the pin share the row's trailing
      slot, the shape `MovementStepSettingsFields.vue` sets for every picker.
    -->
    <div v-if="shows('inputPosition')" class="settings-row">
      <span class="settings-row__label">{{ t('console.settings.inputPosition') }}</span>
      <div class="flex items-center gap-2">
        <div class="segmented" role="group" :aria-label="t('console.settings.inputPosition')">
          <button
            type="button"
            class="button button--sm"
            :aria-pressed="settings.inputPosition === 'bottom'"
            @click="setInputPosition('bottom')"
          >
            {{ t('console.settings.inputBottom') }}
          </button>
          <button
            type="button"
            class="button button--sm"
            :aria-pressed="settings.inputPosition === 'top'"
            @click="setInputPosition('top')"
          >
            {{ t('console.settings.inputTop') }}
          </button>
        </div>
        <QuickSettingToggle
          v-if="pins"
          :label="t('console.settings.inputPosition')"
          :shown="quick!.isQuick('inputPosition')"
          @toggle="quick!.setQuick('inputPosition', $event)"
        />
      </div>
    </div>

    <div v-if="shows('showTimestamps')" class="settings-row">
      <label class="check-row">
        <input
          type="checkbox"
          :checked="settings.showTimestamps"
          @change="toggle('showTimestamps')"
        />
        <span>{{ t('console.settings.showTimestamps') }}</span>
      </label>
      <QuickSettingToggle
        v-if="pins"
        :label="t('console.settings.showTimestamps')"
        :shown="quick!.isQuick('showTimestamps')"
        @toggle="quick!.setQuick('showTimestamps', $event)"
      />
    </div>

    <div v-if="shows('compact')" class="settings-row">
      <label class="check-row">
        <input type="checkbox" :checked="settings.compact" @change="toggle('compact')" />
        <span>{{ t('console.settings.compact') }}</span>
      </label>
      <QuickSettingToggle
        v-if="pins"
        :label="t('console.settings.compact')"
        :shown="quick!.isQuick('compact')"
        @toggle="quick!.setQuick('compact', $event)"
      />
    </div>

    <!--
      Raw output shows Klipper's own `!! ` and `// ` markers. Worth having when
      copying a line into a bug report, where the prefix is part of the evidence.
    -->
    <div v-if="shows('rawOutput')" class="settings-row">
      <label class="check-row">
        <input type="checkbox" :checked="settings.rawOutput" @change="toggle('rawOutput')" />
        <span>{{ t('console.settings.rawOutput') }}</span>
      </label>
      <QuickSettingToggle
        v-if="pins"
        :label="t('console.settings.rawOutput')"
        :shown="quick!.isQuick('rawOutput')"
        @toggle="quick!.setQuick('rawOutput', $event)"
      />
    </div>

    <div v-if="shows('followNewest')" class="settings-row">
      <label class="check-row">
        <input type="checkbox" :checked="settings.followNewest" @change="toggle('followNewest')" />
        <span>{{ t('console.settings.followNewest') }}</span>
      </label>
      <QuickSettingToggle
        v-if="pins"
        :label="t('console.settings.followNewest')"
        :shown="quick!.isQuick('followNewest')"
        @toggle="quick!.setQuick('followNewest', $event)"
      />
    </div>

    <!--
      Dragging is the fast way to find a card height; the entry field takes
      one past the slider's own span, up to what the card will actually
      accept. Both commit live — this is local, cost-free state, not a
      command — so `commitOnDrag` is on.
    -->
    <AppSlider
      v-if="showsLines"
      :label="t('console.settings.visibleLines')"
      :model-value="settings.visibleLines"
      :min="minimumLines"
      :max="maximumLines"
      :step="1"
      :track-min="sliderMinimumLines"
      :track-max="sliderMaximumLines"
      entry
      commit-on-drag
      @commit="setLines"
    />
  </SurfaceSection>
</template>
