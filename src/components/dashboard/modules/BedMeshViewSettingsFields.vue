<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppSelect from '@/components/AppSelect.vue'
import AppSlider from '@/components/AppSlider.vue'
import QuickSettingToggle from '@/components/dashboard/QuickSettingToggle.vue'
import {
  bedMeshLayerRows,
  readBedMeshViewSetting,
} from '@/components/dashboard/modules/bedMeshViewSettings'
import { configBoolean, configNumber, configString, useDashboardModule } from '@/dashboard/context'
import { bedMeshDefaultQuickKeys } from '@/dashboard/quickSettingDefaults'
import { useQuickSettings } from '@/dashboard/quickSettings'
import type { MeshRenderStyle } from '@/features/bedMesh/geometry'
import { meshHeightLimits } from '@/features/bedMesh/scale'
import {
  meshEverydayProjections,
  meshOrientationPresets,
  meshProjectionFixesAngle,
  meshProjectionGroups,
  type MeshOrientationName,
  type MeshProjection,
} from '@/features/bedMesh/scene'
import { useBedMeshStore } from '@/stores/bedMesh'

/**
 * Everything that decides what the height map draws and how it is looked at,
 * rendered once and shared verbatim between the full settings pane and the
 * card's own quick layer — see `docs/design/settings-surface.md`. `mode`
 * decides which rows show and whether they carry a quick-settings toggle; it
 * never changes what a row does.
 *
 * What to draw comes first, then how tall the axis stands, then the way the bed
 * is faced. They are one section because they answer one question — what am I
 * looking at — and the card is docked beside them, so each change is judged by
 * looking rather than by reading.
 *
 * **Two rows here deliberately take no pin.** The height axis is a slider with
 * its own header and reset button, which is two rows tall and would balloon a
 * layer that opens inside the card; and the extras switch only changes which
 * options the two selects above it offer, which is a decision made once while
 * configuring rather than one reached for from the dashboard.
 */
const props = defineProps<{ mode: 'pane' | 'quick' }>()

const { t } = useI18n({ useScope: 'global' })
const bedMesh = useBedMeshStore()
const { config, updateConfig } = useDashboardModule('bedMesh')
const quick = useQuickSettings(config, updateConfig, bedMeshDefaultQuickKeys, () => props.mode)

/** The literal default the reset button restores. */
const zMaxDefault = 0.5

// The layer rows, their order, and every key's default live in
// `bedMeshViewSettings.ts` — with the reasoning for why the three layers are
// one row and one promotable key — shared with `BedMeshModule.vue` so a row's
// checkbox can never disagree with the view it controls.
const layerValues = computed(() =>
  bedMeshLayerRows.map((layer) => ({
    ...layer,
    on: readBedMeshViewSetting(config.value, layer.key),
  })),
)
const wireframe = computed(() => readBedMeshViewSetting(config.value, 'wireframe'))
const showProbes = computed(() => readBedMeshViewSetting(config.value, 'showProbes'))

const heightLimits = computed(() => meshHeightLimits(bedMesh.lowest, bedMesh.highest))
const zMax = computed(() => {
  const chosen = configNumber(config.value, 'zMax', zMaxDefault)
  return Math.min(heightLimits.value.max, Math.max(heightLimits.value.min, chosen))
})
// The reset target is the clamped default, not the literal one: once a mesh
// needs a taller axis than 0.5 mm, 0.5 mm is no longer reachable, and a reset
// that promised it would set a value `AppSlider` immediately re-clamps away
// from — the button would never actually disappear.
const zMaxResetValue = computed(() =>
  Math.min(heightLimits.value.max, Math.max(heightLimits.value.min, zMaxDefault)),
)

/**
 * One switch for every way of looking at the mesh that is not the everyday one.
 *
 * Perspective and a plain surface are what most people mean by "the 3D view",
 * and that pair is the whole of the choice for anyone who is not specifically
 * after a drawing convention. Behind the switch: the rest of the standard
 * projection taxonomy, and the three alternative readings of the same data.
 *
 * They share a switch rather than having one each because they are one
 * decision — "show me the unusual options" — and two checkboxes would ask it
 * twice. A value already chosen stays listed whether the switch is on or off,
 * so turning it back off cannot leave a control naming something it will not
 * offer.
 */
const showExtras = computed(() => configBoolean(config.value, 'showExtras', false))

const projection = computed(
  () => configString(config.value, 'projection', 'perspective') as MeshProjection,
)
const angleIsFixed = computed(() => meshProjectionFixesAngle(projection.value))

const projectionOptions = computed(() =>
  meshProjectionGroups.flatMap((group) => {
    const members = group.members.filter(
      (value) =>
        showExtras.value || meshEverydayProjections.includes(value) || value === projection.value,
    )
    return members.map((value) => ({
      value,
      label: t(`dashboard.bedMesh.projections.${value}`),
      group: group.family ? t(`dashboard.bedMesh.projectionFamilies.${group.family}`) : undefined,
    }))
  }),
)

const renderStyle = computed(
  () => configString(config.value, 'renderStyle', 'surface') as MeshRenderStyle,
)
const renderStyleValues: MeshRenderStyle[] = ['surface', 'bars', 'contour', 'terraced', 'mosaic']
const renderStyleOptions = computed(() =>
  renderStyleValues.map((value) => ({
    value,
    label: t(`dashboard.bedMesh.renderStyles.${value}`),
  })),
)
/**
 * Hidden entirely rather than shown with one entry in it: with the extras off
 * there is nothing to choose between, and a select whose list has a single item
 * is a control that lies about having a decision behind it. It comes back when
 * a style other than the plain surface is already in force, so the setting is
 * never in effect with no way to see or undo it.
 */
const showRenderStyle = computed(() => showExtras.value || renderStyle.value !== 'surface')

const orientationName = computed(
  () => configString(config.value, 'orientation', 'rightFront') as MeshOrientationName,
)
const orientationOptions = (Object.keys(meshOrientationPresets) as MeshOrientationName[]).map(
  (name) => ({ value: name, label: t(`dashboard.bedMesh.orientations.${name}`) }),
)
</script>

<template>
  <div v-if="quick.visible('layers')" class="settings-row">
    <span class="settings-row__label">{{ t('dashboard.bedMesh.layers') }}</span>
    <div class="flex items-center gap-2">
      <span class="check-set">
        <label v-for="layer in layerValues" :key="layer.key" class="check-row">
          <input
            type="checkbox"
            :checked="layer.on"
            @change="updateConfig({ [layer.key]: !layer.on })"
          />
          <span>{{ t(layer.label) }}</span>
        </label>
      </span>
      <QuickSettingToggle
        v-if="mode === 'pane'"
        :label="t('dashboard.bedMesh.layers')"
        :shown="quick.isQuick('layers')"
        @toggle="quick.setQuick('layers', $event)"
      />
    </div>
  </div>

  <div v-if="quick.visible('wireframe')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="wireframe"
        @change="updateConfig({ wireframe: !wireframe })"
      />
      <span>{{ t('dashboard.bedMesh.wireframe') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.bedMesh.wireframe')"
      :shown="quick.isQuick('wireframe')"
      @toggle="quick.setQuick('wireframe', $event)"
    />
  </div>

  <div v-if="quick.visible('showProbes')" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showProbes"
        @change="updateConfig({ showProbes: !showProbes })"
      />
      <span>{{ t('dashboard.bedMesh.showProbes') }}</span>
    </label>
    <QuickSettingToggle
      v-if="mode === 'pane'"
      :label="t('dashboard.bedMesh.showProbes')"
      :shown="quick.isQuick('showProbes')"
      @toggle="quick.setQuick('showProbes', $event)"
    />
  </div>

  <!--
    The track's own step is finer than the field's: dragging lands on 0.05 mm
    increments while typing rounds to 0.1 mm, the one instance where the
    track and the field diverge on precision rather than on span — both
    otherwise share `heightLimits` as the real permitted range.
  -->
  <template v-if="mode === 'pane'">
    <AppSlider
      :label="t('dashboard.bedMesh.zMax')"
      :model-value="zMax"
      :min="heightLimits.min"
      :max="heightLimits.max"
      :step="0.1"
      :track-step="0.05"
      entry
      can-reset
      :reset-value="zMaxResetValue"
      commit-on-drag
      @commit="(value) => updateConfig({ zMax: value })"
    />
    <p class="module-settings__hint">{{ t('dashboard.bedMesh.zMaxHint') }}</p>
  </template>

  <!--
    A plain row, not a `<label>`: `.settings-row` stretches its leading track to
    the panel's full width, and a `<label>` wrapping a labelable control forwards
    a click anywhere in that width — including the empty space past the trigger —
    to the control. For a checkbox that convenience is the point; for a control
    that opens a popover, the popover opened by a click nowhere near it reads as
    a bug, and the forwarded click firing again when an option is chosen inside
    that same label reopened the panel the option had just closed.
  -->
  <div v-if="quick.visible('projection')">
    <div class="settings-row">
      <span class="settings-row__label">{{ t('dashboard.bedMesh.projection') }}</span>
      <div class="flex items-center gap-2">
        <AppSelect
          :model-value="projection"
          :options="projectionOptions"
          :label="t('dashboard.bedMesh.projection')"
          @update:model-value="(value) => updateConfig({ projection: value })"
        />
        <QuickSettingToggle
          v-if="mode === 'pane'"
          :label="t('dashboard.bedMesh.projection')"
          :shown="quick.isQuick('projection')"
          @toggle="quick.setQuick('projection', $event)"
        />
      </div>
    </div>
    <p v-if="mode === 'pane'" class="module-settings__hint">
      {{ t('dashboard.bedMesh.projectionHint') }}
    </p>
  </div>

  <div v-if="showRenderStyle && quick.visible('renderStyle')">
    <div class="settings-row">
      <span class="settings-row__label">{{ t('dashboard.bedMesh.renderStyle') }}</span>
      <div class="flex items-center gap-2">
        <AppSelect
          :model-value="renderStyle"
          :options="renderStyleOptions"
          :label="t('dashboard.bedMesh.renderStyle')"
          @update:model-value="(value) => updateConfig({ renderStyle: value })"
        />
        <QuickSettingToggle
          v-if="mode === 'pane'"
          :label="t('dashboard.bedMesh.renderStyle')"
          :shown="quick.isQuick('renderStyle')"
          @toggle="quick.setQuick('renderStyle', $event)"
        />
      </div>
    </div>
    <p v-if="mode === 'pane'" class="module-settings__hint">
      {{ t('dashboard.bedMesh.renderStyleHint') }}
    </p>
  </div>

  <!--
    A row of the pane like any other, so it keeps the section's rhythm rather
    than sitting tighter than the settings it governs — the same reason
    Movement's confirmations are rows. It carries no pin on purpose: it only
    changes which options the two selects above it offer.
  -->
  <div v-if="mode === 'pane'" class="settings-row">
    <label class="check-row">
      <input
        type="checkbox"
        :checked="showExtras"
        @change="updateConfig({ showExtras: ($event.target as HTMLInputElement).checked })"
      />
      <span>{{ t('dashboard.bedMesh.showExtras') }}</span>
    </label>
  </div>

  <div v-if="quick.visible('orientation')">
    <div class="settings-row">
      <span class="settings-row__label">{{ t('dashboard.bedMesh.orientation') }}</span>
      <div class="flex items-center gap-2">
        <AppSelect
          :model-value="orientationName"
          :options="orientationOptions"
          :disabled="angleIsFixed"
          :label="t('dashboard.bedMesh.orientation')"
          @update:model-value="(value) => updateConfig({ orientation: value })"
        />
        <QuickSettingToggle
          v-if="mode === 'pane'"
          :label="t('dashboard.bedMesh.orientation')"
          :shown="quick.isQuick('orientation')"
          @toggle="quick.setQuick('orientation', $event)"
        />
      </div>
    </div>
    <!-- Shown in both modes: it explains a control that is visibly disabled,
         and a promoted row that has gone dead needs the reason wherever it is. -->
    <p v-if="angleIsFixed" class="module-settings__hint">
      {{ t('dashboard.bedMesh.orientationIgnored') }}
    </p>
  </div>
</template>
