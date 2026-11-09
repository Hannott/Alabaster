<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import FileContextMenu from '@/components/machine/FileContextMenu.vue'
import { loadDocsAnchors, loadedDocsAnchors, type DocsAnchors } from '@/features/machine/docsLinks'
import type { EditorContext } from '@/features/machine/editorContext'
import {
  buildEditorMenu,
  type EditorMenuAction,
  type EditorMenuItem,
  type EditorMenuLabel,
} from '@/features/machine/editorMenu'
import { useAvailabilityStore } from '@/stores/availability'
import { useConsoleStore } from '@/stores/console'
import { useDocumentationSiteStore } from '@/stores/documentationSite'
import { usePrinterStore } from '@/stores/printer'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { peekValue, usePrinterObjectPeekStore } from '@/stores/printerObjectPeek'
import { useQuickConfigStore } from '@/stores/quickConfig'

/**
 * The configuration editor's own right-click menu. `editorMenu.ts` decides
 * which rows there are; this gathers what the stores know for it, renders the
 * rows in the shared popover, and runs the few actions that are a store's to
 * run — pinning, applying a value until restart. Everything that acts on the
 * text or the workspace goes back to the view as an `action`, since only the
 * view holds the textarea and the explorer.
 */
const props = defineProps<{
  x: number
  y: number
  context: EditorContext
  /** The open file, relative to the config root. */
  path: string
  lines: readonly string[]
  readOnly: boolean
  selection: string
  /** Every file in the config root, or null until the listing has loaded. */
  files: readonly string[] | null
}>()

const emit = defineEmits<{ close: []; action: [action: EditorMenuAction] }>()

const { t } = useI18n({ useScope: 'global' })
const availability = useAvailabilityStore()
const gcodeConsole = useConsoleStore()
const documentationSite = useDocumentationSiteStore()
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const peek = usePrinterObjectPeekStore()
const quickConfig = useQuickConfigStore()

/*
 * The view preloads the table when the editor mounts, so a menu normally finds
 * it already here; only a right-click faster than the download waits for it.
 */
const anchors = ref<DocsAnchors | null>(loadedDocsAnchors())
if (!anchors.value) {
  void loadDocsAnchors()
    .then((loaded) => (anchors.value = loaded))
    .catch(() => undefined)
}

const commandHelp = computed(() =>
  gcodeConsole.gcodeHelp.length === 0
    ? null
    : new Map(gcodeConsole.gcodeHelp.map((entry) => [entry.command.toUpperCase(), entry.help])),
)
const pinnableSections = computed(() => new Set(quickConfig.catalogue.map((entry) => entry.key)))

const menu = computed(() =>
  buildEditorMenu(props.context, {
    path: props.path,
    lines: props.lines,
    readOnly: props.readOnly,
    selection: props.selection,
    site: documentationSite.site,
    anchors: anchors.value?.[documentationSite.site] ?? null,
    index: quickConfig.hasLoaded ? quickConfig.index : null,
    files: props.files,
    settings: printerConfig.settings,
    settingsLoaded: printerConfig.hasSettings,
    loadedConfig: printerConfig.loadedConfig,
    pendingItems: printer.saveConfigPendingItems,
    isPinned: quickConfig.isPinned,
    pinnableSections: pinnableSections.value,
    commandHelp: commandHelp.value,
    klipperReady: availability.isKlipperReady,
  }),
)

watch(
  () => menu.value.watch?.object ?? null,
  (object) => {
    if (object) peek.watchObject(object)
    else peek.release()
  },
  { immediate: true },
)
onBeforeUnmount(() => peek.release())

const liveValue = computed(() => {
  const watched = menu.value.watch
  if (!watched || peek.object !== watched.object) return null
  return peekValue(peek.status, watched.attributes)
})

function label(value: EditorMenuLabel): string {
  return value.params ? t(value.key, value.params) : t(value.key)
}

/*
 * A row with children opens them beside itself, the way a desktop menu does:
 * on hover, or on click, Enter, or the right arrow, which also moves focus into
 * it. It is rendered inside the menu rather than teleported, so a press on it
 * counts as inside the menu and does not close everything. Hovering another
 * row closes it, and the left arrow or Escape returns to the row.
 */
const openSubmenu = ref<EditorMenuItem | null>(null)
const submenuStyle = ref<Record<string, string>>({})
const submenu = ref<HTMLElement | null>(null)
let submenuAnchor: HTMLElement | null = null

async function showSubmenu(item: EditorMenuItem, anchor: HTMLElement, focus = false) {
  if (openSubmenu.value?.id !== item.id) {
    openSubmenu.value = item
    submenuAnchor = anchor
    submenuStyle.value = { visibility: 'hidden' }
    await nextTick()
    placeSubmenu()
  }
  if (focus) submenu.value?.querySelector<HTMLElement>('button')?.focus()
}

/*
 * Beside the row, flipped to its other side when the viewport has no room on
 * the right, and moved up as far as it must to stay on screen.
 */
function placeSubmenu(): void {
  const panel = submenu.value
  if (!panel || !submenuAnchor) return
  const row = submenuAnchor.getBoundingClientRect()
  const { width, height } = panel.getBoundingClientRect()
  const margin = 8
  const x = row.right + width + margin <= window.innerWidth ? row.right : row.left - width
  const y = Math.max(margin, Math.min(row.top, window.innerHeight - height - margin))
  submenuStyle.value = { insetInlineStart: `${Math.max(margin, x)}px`, insetBlockStart: `${y}px` }
}

function hideSubmenu(refocus = false): void {
  openSubmenu.value = null
  if (refocus) submenuAnchor?.focus()
  submenuAnchor = null
}

function onSubmenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft' || event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    hideSubmenu(true)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const buttons = [...(submenu.value?.querySelectorAll<HTMLElement>('button') ?? [])]
    const current = buttons.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    buttons[(current + step + buttons.length) % buttons.length]?.focus()
  }
}

/*
 * A view action is handed over while the menu is still open, because the view
 * reads the context it acts on from the menu it is about to close.
 */
async function run(item: EditorMenuItem): Promise<void> {
  const action = item.action
  if (
    action &&
    action.type !== 'pinOption' &&
    action.type !== 'unpinOption' &&
    action.type !== 'applyRuntime'
  ) {
    emit('action', action)
    return
  }
  emit('close')
  if (action?.type === 'pinOption') quickConfig.pinOption(action.section, action.option)
  else if (action?.type === 'unpinOption') quickConfig.unpinOption(action.section, action.option)
  else if (action?.type === 'applyRuntime') {
    await printer.sendGcode(action.command.script, action.command.key)
  }
}
</script>

<template>
  <FileContextMenu
    :x="x"
    :y="y"
    :label="menu.heading ?? t('configuration.editorMenu.label')"
    @close="emit('close')"
  >
    <div v-if="menu.heading || menu.facts.length || liveValue" class="editor-context-menu__head">
      <p v-if="menu.heading" class="editor-context-menu__target">{{ menu.heading }}</p>
      <p v-if="liveValue" class="editor-context-menu__fact">
        {{ t('configuration.editorMenu.facts.now', { value: liveValue }) }}
      </p>
      <p
        v-for="(fact, index) in menu.facts"
        :key="index"
        class="editor-context-menu__fact"
        :data-caution="fact.caution ? 'true' : undefined"
      >
        {{ label(fact.label) }}
      </p>
    </div>
    <template v-for="(group, groupIndex) in menu.groups" :key="group.id">
      <p v-if="groupIndex > 0" class="header-menu__divider" role="separator"></p>
      <template v-for="item in group.items" :key="item.id">
        <!--
          A real link, so a middle click and the browser's own link menu work on
          it — the one native entry this application relies on.
        -->
        <a
          v-if="item.href"
          class="button button--quiet button--sm button--start button--block"
          :href="item.href"
          target="_blank"
          rel="noopener noreferrer"
          @pointerenter="hideSubmenu()"
          @click="emit('close')"
        >
          <AppIcon v-if="item.icon" :name="item.icon" class="size-4" aria-hidden="true" />
          <span>{{ label(item.label) }}</span>
          <AppIcon name="popout" class="editor-context-menu__hint size-4" aria-hidden="true" />
        </a>
        <AppButton
          v-else-if="item.children"
          variant="quiet"
          size="sm"
          start
          block
          :icon="item.icon"
          :label="label(item.label)"
          aria-haspopup="menu"
          :aria-expanded="openSubmenu?.id === item.id"
          :data-open="openSubmenu?.id === item.id ? 'true' : undefined"
          @pointerenter="showSubmenu(item, $event.currentTarget as HTMLElement)"
          @click="showSubmenu(item, $event.currentTarget as HTMLElement, true)"
          @keydown.right.prevent="showSubmenu(item, $event.currentTarget as HTMLElement, true)"
        >
          <AppIcon name="right" class="editor-context-menu__opens size-4" aria-hidden="true" />
        </AppButton>
        <AppButton
          v-else
          variant="quiet"
          size="sm"
          start
          block
          :icon="item.icon"
          :label="label(item.label)"
          @pointerenter="hideSubmenu()"
          @click="run(item)"
        >
          <span v-if="item.hint || item.hintKey" class="editor-context-menu__hint">
            {{ item.hintKey ? t(item.hintKey) : item.hint }}
          </span>
        </AppButton>
      </template>
    </template>
    <div
      v-if="openSubmenu?.children"
      ref="submenu"
      class="header-menu__panel file-context-menu editor-context-menu__submenu"
      :style="submenuStyle"
      role="menu"
      :aria-label="label(openSubmenu.label)"
      @keydown="onSubmenuKeydown"
    >
      <AppButton
        v-for="child in openSubmenu.children"
        :key="child.id"
        variant="quiet"
        size="sm"
        start
        block
        :label="label(child.label)"
        @click="run(child)"
      >
        <span v-if="child.hint" class="editor-context-menu__hint">{{ child.hint }}</span>
      </AppButton>
    </div>
  </FileContextMenu>
</template>
