<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import CalibrationCard from '@/components/calibration/CalibrationCard.vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import { useAvailability } from '@/composables/useAvailability'
import {
  newestTuningResult,
  resolveTuningComparison,
  resolveTuningSelection,
} from '@/features/calibration/tuningSelection'
import { createDateTimeFormatter } from '@/i18n/formats'
import {
  shakeTuneCategories,
  useShakeTuneStore,
  type ShakeTuneCategory,
  type ShakeTuneResult,
} from '@/stores/shakeTune'

/**
 * Shake&Tune's graphs: the rows that choose one, and the pane that shows it,
 * or two side by side to compare.
 *
 * It only reads. The runs that produce these graphs, the shaper they
 * recommend, and the accelerometer checks worth making first are Calibration
 * procedures on the same stage, each with its own result; this panel is the
 * stage's live column.
 */
const props = defineProps<{
  /**
   * The kind of graph the open procedure produces. Its newest graph is shown
   * when the procedure is opened and whenever a run adds a newer one, so the
   * axis map shows Shake&Tune's orientation plot rather than whichever graph
   * of any kind happens to be newest.
   */
  category?: ShakeTuneCategory | undefined
}>()

const { locale, t } = useI18n({ useScope: 'global' })
const shakeTune = useShakeTuneStore()
const { availability: moonrakerAvailability } = useAvailability('moonraker')

/*
 * The directory read lives with the panel that renders it rather than with the
 * page: the panel is mounted only while its own stage is selected, so a printer
 * whose config root is slow to answer is not polled for graphs nobody is
 * looking at. `stop()` on unmount is what makes selecting another stage stop
 * the poll rather than leaving it running behind a rail click.
 */
onMounted(() => {
  shakeTune.start()
})

onBeforeUnmount(() => {
  shakeTune.stop()
})

const viewingResult = ref<ShakeTuneResult | null>(null)

const allResults = computed(() =>
  shakeTuneCategories.flatMap((category) => shakeTune.resultsByCategory[category]),
)

/*
 * One selection for the whole panel rather than one per category: the pane
 * shows one graph, or one comparison, and the rows are what choose it. A
 * comparison may cross categories on purpose — a belts graph beside an input
 * shaper graph is how "did tensioning the belts change the shaper result"
 * gets read.
 */
const requestedPath = ref<string | null>(null)
const comparisonPath = ref<string | null>(null)
const comparing = ref(false)

const primary = computed(() => resolveTuningSelection(requestedPath.value, allResults.value))
const comparison = computed(() =>
  comparing.value
    ? resolveTuningComparison(comparisonPath.value, allResults.value, primary.value)
    : null,
)

/*
 * A run that finishes presents its own graph. Only a result *newer* than the
 * previous newest counts: deleting the newest file also changes which result
 * is newest, and that must not yank the pane away from a graph somebody chose.
 */
watch(
  () => newestTuningResult(allResults.value),
  (next, previous) => {
    if (next && previous && next.modified > previous.modified && next.path !== previous.path) {
      requestedPath.value = next.path
    }
  },
)

watch(
  () => {
    if (!props.category) return null
    return newestTuningResult(shakeTune.resultsByCategory[props.category])?.path ?? null
  },
  (path) => {
    if (path !== null) requestedPath.value = path
  },
  { immediate: true },
)

function pick(result: ShakeTuneResult): void {
  if (comparing.value && result.path !== primary.value?.path) {
    comparisonPath.value = result.path
    return
  }
  requestedPath.value = result.path
  if (comparisonPath.value === result.path) comparisonPath.value = null
}

function toggleComparing(): void {
  comparing.value = !comparing.value
  if (!comparing.value) comparisonPath.value = null
}

const dateFormatter = computed(() => createDateTimeFormatter(locale.value))

function formatModified(result: ShakeTuneResult): string {
  return dateFormatter.value.format(result.modified * 1000)
}

function displayName(result: ShakeTuneResult): string {
  return result.name.replace(/\.png$/i, '')
}
</script>

<template>
  <CalibrationCard :title="t('calibration.tuning.title')" :hint="t('calibration.tuning.hint')">
    <template #aside>
      <AppButton
        v-if="allResults.length > 1"
        size="xs"
        :label="t('calibration.tuning.compare')"
        :aria-pressed="comparing"
        @click="toggleComparing()"
      />
      <AppButton
        size="xs"
        :pending="shakeTune.isLoading"
        icon="refresh"
        :label="t('calibration.tuning.refresh')"
        :disabled="!moonrakerAvailability.isAvailable || shakeTune.isLoading"
        @click="shakeTune.refresh()"
      />
    </template>

    <div class="calibration-tuning" :class="{ 'calibration-tuning--reading': primary !== null }">
      <!--
        The graph leads, in the markup as well as on screen, for the reason the
        bed stage's map does: a reader tabbing through reaches the artifact
        first, and a stacked narrow viewport opens on it rather than on the
        list that chooses it. Only the graphs on screen are fetched — the rows
        carry no image, because these PNGs are several megabytes each and are
        served by the printer's own host.
      -->
      <div
        v-if="primary"
        class="calibration-tuning__pane"
        :class="{ 'calibration-tuning__pane--comparing': comparing }"
      >
        <figure class="calibration-tuning__figure">
          <button
            type="button"
            class="brand-trigger calibration-tuning__graph"
            :aria-label="t('calibration.tuning.open', { name: primary.name })"
            @click="viewingResult = primary"
          >
            <img :src="primary.url" alt="" />
          </button>
          <figcaption class="calibration-tuning__caption">{{ primary.name }}</figcaption>
        </figure>
        <figure v-if="comparison" class="calibration-tuning__figure">
          <button
            type="button"
            class="brand-trigger calibration-tuning__graph"
            :aria-label="t('calibration.tuning.open', { name: comparison.name })"
            @click="viewingResult = comparison"
          >
            <img :src="comparison.url" alt="" />
          </button>
          <figcaption class="calibration-tuning__caption">{{ comparison.name }}</figcaption>
        </figure>
        <p v-else-if="comparing" class="calibration-panel__hint calibration-tuning__pick">
          {{ t('calibration.tuning.pickComparison') }}
        </p>
      </div>

      <div class="calibration-tuning__index">
        <p v-if="allResults.length === 0" class="calibration-panel__hint">
          {{ t('calibration.tuning.empty') }}
        </p>
        <div
          v-for="category in shakeTuneCategories"
          v-show="shakeTune.resultsByCategory[category].length > 0"
          :key="category"
          class="calibration-tuning-group"
        >
          <header class="calibration-tuning-group__header">
            <h3 class="calibration-tuning-group__title">
              {{ t(`calibration.tuning.category.${category}`) }}
            </h3>
          </header>
          <ul
            v-if="shakeTune.resultsByCategory[category].length > 0"
            class="calibration-tuning-results"
          >
            <li v-for="result in shakeTune.resultsByCategory[category]" :key="result.path">
              <button
                type="button"
                class="file-select selection-row calibration-tuning-result"
                :class="{
                  'selection-row--selected': result.path === primary?.path,
                  'selection-row--compared': result.path === comparison?.path,
                }"
                :aria-current="result.path === primary?.path ? 'true' : undefined"
                :title="result.name"
                @click="pick(result)"
              >
                <span class="calibration-tuning-result__name">{{ displayName(result) }}</span>
                <span class="calibration-tuning-result__meta">
                  {{ formatModified(result) }}
                  <template v-if="result.path === comparison?.path">
                    · {{ t('calibration.tuning.compared') }}
                  </template>
                </span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <ImageLightbox
      :open="viewingResult !== null"
      :src="viewingResult?.url ?? ''"
      :alt="viewingResult?.name ?? ''"
      @close="viewingResult = null"
    />
  </CalibrationCard>
</template>
