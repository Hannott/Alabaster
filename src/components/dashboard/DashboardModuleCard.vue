<script setup lang="ts">
import { provide, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon, { type AppIconName } from '@/components/AppIcon.vue'
import DisclosureReveal from '@/components/DisclosureReveal.vue'
import {
  dashboardModuleHeaderActionKey,
  type DashboardModuleHeaderAction,
} from '@/dashboard/context'

const props = defineProps<{
  instanceId: string
  title: string
  defaultTitle: string
  icon: AppIconName
  editing: boolean
  isFirst: boolean
  isLast: boolean
  canMoveToPreviousColumn: boolean
  canMoveToNextColumn: boolean
  collapsed: boolean
  /** The module's one headline value, shown only while the card is collapsed. */
  summary?: string | null
  hasSettings: boolean
  settingsOpen: boolean
  /**
   * Docked in the settings surface. Its disclosure layer would be a second
   * place to configure the module while the surface is already open, so the
   * gear goes away and the surface repeats those controls instead.
   */
  docked: boolean
  canRename: boolean
  canDuplicate: boolean
  canRemove: boolean
  /**
   * Being carried by a drag. The card still renders in the column, in the slot
   * it would land in — dimming it is what says the layout under the pointer is
   * the prospective one rather than the committed one.
   */
  dragging: boolean
}>()

const emit = defineEmits<{
  dragStart: [event: PointerEvent, instanceId: string]
  move: [instanceId: string, direction: -1 | 1]
  moveColumn: [instanceId: string, direction: -1 | 1]
  hide: [instanceId: string]
  toggleCollapse: [instanceId: string]
  toggleSettings: [instanceId: string]
  openSurface: [instanceId: string]
  duplicate: [instanceId: string]
  remove: [instanceId: string]
  rename: [instanceId: string, title: string]
}>()

const { t } = useI18n({ useScope: 'global' })

/**
 * Set by the module mounted in this card's body, via `useDashboardModuleHeaderAction`.
 * Provided here rather than by the host, so it reaches this header even though the
 * module renders several layers below it through a dynamic component and a slot.
 */
const headerAction = ref<DashboardModuleHeaderAction | null>(null)
provide(dashboardModuleHeaderActionKey, {
  setHeaderAction: (action) => {
    headerAction.value = action
  },
})

function handleDragStart(event: PointerEvent): void {
  if (!props.editing) return
  emit('dragStart', event, props.instanceId)
}

/**
 * A held Ctrl (or Cmd, for parity with the editor's own Ctrl+click hotlink)
 * skips the inline layer and goes straight to the full settings surface —
 * the same destination as the layer's own popout link, for whoever already
 * knows they want the surface and would rather not open the layer just to
 * close it again.
 */
function handleSettingsClick(event: MouseEvent): void {
  if (event.ctrlKey || event.metaKey) {
    emit('openSurface', props.instanceId)
    return
  }
  emit('toggleSettings', props.instanceId)
}

function handleRename(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) emit('rename', props.instanceId, target.value)
}
</script>

<template>
  <article
    class="dashboard-module"
    :class="{ 'dashboard-module--editing': editing, 'dashboard-module--collapsed': collapsed }"
    :data-instance-id="instanceId"
    :data-dragging="dragging || undefined"
  >
    <header class="dashboard-module__header">
      <AppIcon :name="icon" class="size-5 shrink-0 text-data-sky" aria-hidden="true" />
      <input
        v-if="editing && canRename"
        class="field field--xs dashboard-module__rename"
        type="text"
        :value="title === defaultTitle ? '' : title"
        :placeholder="defaultTitle"
        :aria-label="t('dashboard.layout.rename', { module: defaultTitle })"
        @change="handleRename"
      />
      <h2 v-else class="min-w-0 truncate text-card-title">
        {{ title }}
      </h2>

      <template v-if="!editing">
        <div class="ms-auto min-w-0">
          <!--
            A collapsed card keeps the module's headline value in reach, so
            collapsing trades the controls away without losing the reason the
            card was on the dashboard. It is live data, so it does not fade in.
          -->
          <p v-if="collapsed && summary" class="dashboard-module__summary">{{ summary }}</p>
          <slot name="meta"></slot>
        </div>
        <div class="dashboard-module__quick-controls">
          <button
            v-if="headerAction"
            type="button"
            class="button button--quiet button--xs button--icon"
            :disabled="headerAction.disabled"
            :aria-label="headerAction.label"
            :title="headerAction.label"
            @click="headerAction.onClick()"
          >
            <AppIcon :name="headerAction.icon" class="size-4" aria-hidden="true" />
          </button>
          <button
            v-if="hasSettings && !docked && !collapsed"
            type="button"
            class="button button--quiet button--xs button--icon"
            :aria-pressed="settingsOpen"
            :aria-label="t('dashboard.layout.settings', { module: title })"
            :title="t('dashboard.layout.settingsTooltip', { module: title })"
            @click="handleSettingsClick"
          >
            <AppIcon name="settings" class="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="button button--quiet button--xs button--icon"
            :aria-expanded="!collapsed"
            :aria-label="
              collapsed
                ? t('dashboard.layout.expand', { module: title })
                : t('dashboard.layout.collapse', { module: title })
            "
            :title="
              collapsed
                ? t('dashboard.layout.expand', { module: title })
                : t('dashboard.layout.collapse', { module: title })
            "
            @click="emit('toggleCollapse', instanceId)"
          >
            <AppIcon :name="collapsed ? 'down' : 'up'" class="size-4" aria-hidden="true" />
          </button>
        </div>
      </template>

      <div v-else class="dashboard-module__edit-controls ms-auto">
        <!--
          The handle, not the whole card. Pointer capture over the article
          would fight the rename field beside it — a card whose title cannot be
          selected with the mouse — and would turn a miss on any of the six
          edit buttons into a drag. It stays a non-focusable span: the move
          buttons to its right are the complete keyboard path, and a handle
          that takes focus only to do nothing on Enter is worse than none.
        -->
        <span
          class="dashboard-module__drag-handle button button--quiet button--xs button--icon"
          :title="t('dashboard.layout.drag')"
          @pointerdown="handleDragStart"
        >
          <AppIcon name="drag" class="size-4" aria-hidden="true" />
        </span>
        <button
          type="button"
          class="button button--quiet button--xs button--icon"
          :aria-label="t('dashboard.layout.moveEarlier', { module: title })"
          :title="t('dashboard.layout.moveEarlier', { module: title })"
          :disabled="isFirst"
          @click="emit('move', instanceId, -1)"
        >
          <AppIcon name="up" class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="button button--quiet button--xs button--icon"
          :aria-label="t('dashboard.layout.moveLater', { module: title })"
          :title="t('dashboard.layout.moveLater', { module: title })"
          :disabled="isLast"
          @click="emit('move', instanceId, 1)"
        >
          <AppIcon name="down" class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="button button--quiet button--xs button--icon"
          :aria-label="t('dashboard.layout.moveToPreviousColumn', { module: title })"
          :title="t('dashboard.layout.moveToPreviousColumn', { module: title })"
          :disabled="!canMoveToPreviousColumn"
          @click="emit('moveColumn', instanceId, -1)"
        >
          <AppIcon name="left" class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="button button--quiet button--xs button--icon"
          :aria-label="t('dashboard.layout.moveToNextColumn', { module: title })"
          :title="t('dashboard.layout.moveToNextColumn', { module: title })"
          :disabled="!canMoveToNextColumn"
          @click="emit('moveColumn', instanceId, 1)"
        >
          <AppIcon name="right" class="size-4" aria-hidden="true" />
        </button>
        <button
          v-if="canDuplicate"
          type="button"
          class="button button--quiet button--xs button--icon"
          :aria-label="t('dashboard.layout.duplicate', { module: defaultTitle })"
          :title="t('dashboard.layout.duplicate', { module: defaultTitle })"
          @click="emit('duplicate', instanceId)"
        >
          <AppIcon name="duplicate" class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="button button--quiet button--xs button--icon"
          :aria-label="t('dashboard.layout.hide', { module: title })"
          :title="t('dashboard.layout.hide', { module: title })"
          @click="emit('hide', instanceId)"
        >
          <AppIcon name="hide" class="size-4" aria-hidden="true" />
        </button>
        <button
          v-if="canRemove"
          type="button"
          class="button button--quiet button--xs button--icon"
          :aria-label="t('dashboard.layout.remove', { module: title })"
          :title="t('dashboard.layout.remove', { module: title })"
          @click="emit('remove', instanceId)"
        >
          <AppIcon name="close" class="size-4" aria-hidden="true" />
        </button>
      </div>
    </header>
    <!--
      Collapsing is the same kind of reveal as a module's settings layer, so it
      uses the same one: the body closes to nothing rather than vanishing under
      the header.
    -->
    <DisclosureReveal :open="!collapsed">
      <div class="dashboard-module__body" :inert="editing || undefined">
        <slot></slot>
      </div>
    </DisclosureReveal>
  </article>
</template>
