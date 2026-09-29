<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AvailabilityRegion from '@/components/AvailabilityRegion.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ImageViewer from '@/components/ImageViewer.vue'
import PageHeading from '@/components/PageHeading.vue'
import PromptDialog from '@/components/PromptDialog.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'
import EditorShortcutsDialog from '@/components/machine/EditorShortcutsDialog.vue'
import ConfigurationTabWell from '@/components/machine/ConfigurationTabWell.vue'
import EditorContextMenu from '@/components/machine/EditorContextMenu.vue'
import FileContextMenu from '@/components/machine/FileContextMenu.vue'
import HtmlFileViewer from '@/components/machine/HtmlFileViewer.vue'
import MachineCodeEditor, {
  type EditorContextMenuRequest,
} from '@/components/machine/MachineCodeEditor.vue'
import QuickConfigOptionDialog from '@/components/machine/QuickConfigOptionDialog.vue'
import QuickConfigView from '@/components/machine/QuickConfigView.vue'
import { useAutoHidePanel } from '@/composables/useAutoHidePanel'
import { useAvailability } from '@/composables/useAvailability'
import { useConfigFileHistory } from '@/composables/useConfigFileHistory'
import { useEditorIndent } from '@/composables/useEditorIndent'
import { useMachineFilePins } from '@/composables/useMachineFilePins'
import { useMachineFilesSettings } from '@/composables/useMachineFilesSettings'
import {
  explorerTreeKeyAction,
  flattenExplorerTree,
  type ExplorerTreeRow,
} from '@/features/machine/explorerTree'
import { loadDocsAnchors } from '@/features/machine/docsLinks'
import { resolveEditorContext, type EditorContext } from '@/features/machine/editorContext'
import type { EditorMenuAction } from '@/features/machine/editorMenu'
import type { IncludeTargetInfo } from '@/features/machine/editor/includeLinks'
import { classifyFileKind, isLargeFile } from '@/features/machine/fileKind'
import { lineChangeMarks, NO_LINE_CHANGE_MARKS } from '@/features/machine/lineChanges'
import { toggleComment, type LineEdit } from '@/features/machine/lineEdit'
import { fileIcon } from '@/features/machine/fileIcons'
import {
  isIncludableConfigPath,
  resolvableIncludeTarget,
  type IncludeRewrite,
} from '@/features/machine/includes'
import { isConfigSyntaxFile } from '@/features/machine/syntax'
import {
  isBackupEntryName,
  isHiddenEntryName,
  isReadOnlyEntry,
} from '@/features/machine/visibility'
import { createDateTimeFormatter } from '@/i18n/formats'
import { useConfirmationsStore } from '@/stores/confirmations'
import { useDocumentationSiteStore } from '@/stores/documentationSite'
import {
  PRIMARY_CONFIG,
  useMachineFilesStore,
  type ContentSearchMatch,
  type MachineFileEntry,
  type MachineFileRoot,
  type OpenMachineFile,
} from '@/stores/machineFiles'
import { useQuickConfigStore, type ConfigurationViewMode } from '@/stores/quickConfig'

type PendingFileOpenReason = 'unsupported' | 'large'

interface PendingFileOpen {
  run: () => void | Promise<void>
  reason: PendingFileOpenReason
  name: string
  sizeLabel: string
}

type EditorDisplayMode = 'maximized' | 'fullscreen'

interface PendingMove {
  entry: MachineFileEntry
  destination: string
  rewrite: IncludeRewrite
}

const editorDisplayModeStorageKey = 'alabaster.machine.editorDisplayMode'
const explorerHiddenStorageKey = 'alabaster.machine.explorerHidden'

function initialEditorDisplayMode(): EditorDisplayMode {
  return localStorage.getItem(editorDisplayModeStorageKey) === 'fullscreen'
    ? 'fullscreen'
    : 'maximized'
}

/*
 * Below this width the workspace shows one card at a time — see the
 * `max-width: 54.999rem` block in components.css — so the explorer has no
 * pin there, and the side strip's roots swap cards instead.
 */
const SINGLE_PANE_QUERY = '(max-width: 54.999rem)'

const { locale, t } = useI18n({ useScope: 'global' })
const machineFiles = useMachineFilesStore()
const quickConfig = useQuickConfigStore()
const viewModes: ConfigurationViewMode[] = ['files', 'quickConfig']
const confirmations = useConfirmationsStore()
const documentationSite = useDocumentationSiteStore()
const { availability: moonrakerAvailability } = useAvailability('moonraker')
const { availability: klipperAvailability } = useAvailability('klipper')
const {
  showHiddenFiles,
  showBackupFiles,
  showReadOnlyFiles,
  searchInFileContents,
  compactRows,
  sortKey,
  setShowHiddenFiles,
  setShowBackupFiles,
  setShowReadOnlyFiles,
  setSearchInFileContents,
  setCompactRows,
  setSortKey,
} = useMachineFilesSettings()
const sortKeys = ['name', 'size', 'modified'] as const
const { indentWidth } = useEditorIndent()
const { fileHistory, fileHistoryIndex, pushFileHistory, setFileHistoryIndex } =
  useConfigFileHistory()
const { pinnedFiles, isPinned, pinFile, unpinFile, repointPinned } = useMachineFilePins()
const search = ref('')
const uploadInput = ref<HTMLInputElement | null>(null)
const codeEditor = ref<InstanceType<typeof MachineCodeEditor> | null>(null)
const moveDialog = ref<HTMLDialogElement | null>(null)
const currentEditorLine = ref(1)
const structureExpanded = ref(false)
const shortcutsOpen = ref(false)
/*
 * Whether Ctrl/Cmd is down, which turns every `[include]` path into a link. It
 * is a class on the editor host and the underline is a real `:hover` — the
 * old pixel hit test existed only because a textarea sat on top of the coloured
 * text and always won the pointer.
 */
const isLinkModifierHeld = ref(false)
interface PendingIncludeCreate {
  targetPath: string
  directory: string
  directoryMissing: boolean
}
const pendingIncludeCreate = ref<PendingIncludeCreate | null>(null)
/**
 * Set to the path a back/forward step is opening, right before it starts —
 * and cleared once that exact path lands (or the open is cancelled) — so the
 * currentFile watcher below can tell "this change is the history step I just
 * asked for" from "the user opened something new" without caring how long an
 * unsupported/large-file warning dialog kept it pending in between.
 */
let suppressedHistoryPath: string | null = null
const editorDisplayMode = ref<EditorDisplayMode>(initialEditorDisplayMode())
const pendingFileOpen = ref<PendingFileOpen | null>(null)
const pendingRestartWithUnsaved = ref(false)
const pendingDiscard = ref(false)
const pendingSaveAll = ref(false)
const pendingDiscardAll = ref(false)
/** Whether the explorer column is hidden beside an open file, on a wide screen. */
const explorerHidden = ref(localStorage.getItem(explorerHiddenStorageKey) === 'true')
/** Whether the one-card layout is showing the explorer instead of the open file. */
const mobileExplorerOpen = ref(false)
/** The tree row the keyboard is on, and the one whose details the footer shows. */
const treeFocusPath = ref<string | null>(null)
const explorerList = ref<HTMLElement | null>(null)
interface TabMenuState {
  path: string
  x: number
  y: number
}
const tabMenu = ref<TabMenuState | null>(null)
interface ContextMenuState {
  entry: MachineFileEntry
  x: number
  y: number
  /** Whether "Add/Remove from printer.cfg" applies to this entry at all. */
  includable: boolean
  /** Whether printer.cfg already includes this entry, decided before the menu opens. */
  isIncluded: boolean
}

const contextMenu = ref<ContextMenuState | null>(null)
let contextMenuRequestId = 0
interface EditorMenuState {
  x: number
  y: number
  context: EditorContext
  selection: string
}
/** The editor's own right-click menu, which replaces the browser's on a config file. */
const editorMenu = ref<EditorMenuState | null>(null)
/*
 * Quick config's index reads every file the config includes, so it is started
 * by the first right-click rather than on every visit to the route, and runs
 * until the route is left.
 */
let quickConfigStartedForMenu = false
const pendingGoToLine = ref(false)
const editorPickerSection = ref<string | null>(null)
const pendingDelete = ref<MachineFileEntry | null>(null)
const pendingCreateFile = ref(false)
const pendingCreateDirectory = ref(false)
const pendingRename = ref<MachineFileEntry | null>(null)
const draggingEntry = ref<MachineFileEntry | null>(null)
const dropTargetKey = ref<string | null>(null)
/** Viewport coordinates the custom drag ghost below follows; null while nothing is dragging. */
const dragGhostPosition = ref<{ x: number; y: number } | null>(null)
const pendingMove = ref<PendingMove | null>(null)
// Counts nested dragenter/dragleave pairs across the whole file list, since
// the browser fires both on every descendant the pointer crosses. Only 0 means
// a file dragged in from the desktop is no longer over the list at all.
const externalDragDepth = ref(0)
let contentSearchTimer: ReturnType<typeof setTimeout> | null = null
let stopLocationRequests: (() => void) | null = null
/*
 * Passed to setDragImage in onDragStart to suppress the browser's own drag
 * image (a snapshot of the whole row, columns and all) in favor of the
 * `.machine-drag-ghost` pill rendered below, which needs a real element to
 * react to the current drop target — a native drag image is fixed at
 * dragstart and neither Chrome nor Safari redraws it afterwards. An
 * unpainted canvas rather than an image asset: a canvas nobody has drawn to
 * is fully transparent by definition, with no data URI to get subtly wrong
 * and nothing to decode or preload before the first drag.
 */
const dragGhostSuppressionImage = document.createElement('canvas')
dragGhostSuppressionImage.width = 1
dragGhostSuppressionImage.height = 1

/** Debounced so content search runs once typing pauses, not once per keystroke. */
function scheduleContentSearch(): void {
  if (contentSearchTimer) clearTimeout(contentSearchTimer)
  contentSearchTimer = null
  const query = search.value.trim()
  if (!query || !searchInFileContents.value) {
    machineFiles.clearContentSearch()
    return
  }
  contentSearchTimer = setTimeout(() => void machineFiles.searchFileContents(query), 300)
}

watch(
  () => search.value.trim(),
  (query) => {
    if (query) void machineFiles.ensureSearchFiles()
    scheduleContentSearch()
  },
)

// Toggling the setting mid-query must act on the query already typed, not wait
// for the next keystroke to notice content search is now (or no longer) wanted.
watch(searchInFileContents, scheduleContentSearch)

/*
 * Checked against every path segment, not just the entry's own name: a search
 * result's path spans the folders it lives in, and a file inside a hidden or
 * backup folder should stay hidden even when its own filename looks ordinary.
 */
function isEntryVisible(entry: MachineFileEntry): boolean {
  const segments = ('path' in entry && entry.path ? (entry.path as string) : entry.name).split('/')
  if (!showHiddenFiles.value && segments.some(isHiddenEntryName)) return false
  if (!showBackupFiles.value && segments.some(isBackupEntryName)) return false
  /*
   * The read-only filter separates the files you can edit from the ones you
   * cannot — a distinction that only exists in a root holding both. Every entry
   * in a read-only root fails it, so applying it there hides the entire listing
   * and reports an empty folder for a directory full of logs. A filter with
   * nothing to discriminate between is not filtering, it is blanking.
   */
  if (machineFiles.isRootEditable && !showReadOnlyFiles.value && isReadOnlyEntry(entry)) {
    return false
  }
  return true
}

function compareEntries(left: MachineFileEntry, right: MachineFileEntry): number {
  const byName = left.name.localeCompare(right.name, locale.value, {
    numeric: true,
    sensitivity: 'base',
  })
  if (sortKey.value === 'size' && left.size !== right.size) return right.size - left.size
  if (sortKey.value === 'modified' && left.modified !== right.modified) {
    return right.modified - left.modified
  }
  return byName
}

const isSearching = computed(() => search.value.trim().length > 0)

/*
 * A search covers the whole root, so its matches are listed flat, each with the
 * folder it lives in, rather than threaded into a tree that would have to open
 * every folder holding one.
 */
const searchRows = computed<ExplorerTreeRow[]>(() => {
  const rawQuery = search.value.trim()
  if (!rawQuery) return []
  const query = rawQuery.toLocaleLowerCase(locale.value)
  // Only trusted once it actually answers the query on screen — otherwise a
  // still-running or setting-disabled search would keep contributing matches
  // left over from whatever was typed before.
  const contentMatchesReady =
    searchInFileContents.value && machineFiles.contentSearchQuery === rawQuery
  return machineFiles.searchFiles
    .filter(
      (entry) =>
        entry.path.toLocaleLowerCase(locale.value).includes(query) ||
        (contentMatchesReady && machineFiles.contentSearchMatches.has(entry.path)),
    )
    .filter(isEntryVisible)
    .sort(compareEntries)
    .map((entry) => ({
      entry,
      level: 1,
      parentPath: entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '',
      expanded: false,
    }))
})

const treeRows = computed(() =>
  flattenExplorerTree(machineFiles.directoryListings, machineFiles.expandedDirectories, {
    isVisible: isEntryVisible,
    compare: compareEntries,
  }),
)

/*
 * The root stands at the top of the tree as a row of its own, the way an IDE
 * shows the project above its files: it is where a file dragged out of a
 * folder lands, and selecting it makes the root the folder new files go into.
 */
const rootRow = computed<ExplorerTreeRow>(() => ({
  entry: {
    kind: 'directory',
    name: machineFiles.currentRoot,
    path: '',
    size: 0,
    modified: 0,
    permissions: machineFiles.rootPermissions,
  },
  level: 0,
  parentPath: '',
  expanded: true,
}))

const explorerRows = computed(() =>
  isSearching.value ? searchRows.value : [rootRow.value, ...treeRows.value],
)

/** The row the keyboard lands on when Tab enters the tree. */
const treeTabStop = computed(() => {
  const rows = explorerRows.value
  const focused = rows.find((row) => row.entry.path === treeFocusPath.value)
  if (focused) return focused.entry.path
  const open = rows.find((row) => row.entry.path === machineFiles.currentFile?.path)
  return (open ?? rows[0])?.entry.path ?? null
})

/*
 * What the footer describes: the row last focused or clicked, else the file on
 * screen, else the folder new files would land in. Never empty, so the band's
 * text changes in place rather than appearing and disappearing.
 */
const footerEntry = computed<MachineFileEntry | null>(() => {
  const focused = explorerRows.value.find((row) => row.entry.path === treeFocusPath.value)
  return focused?.entry ?? machineFiles.currentFile
})

/*
 * Pinned files have a row of their own in the tab well, in every folder and
 * whatever is open, which is the point of pinning one: the file does not live
 * wherever the explorer is standing. Filtered to the root being browsed, since
 * a pin names a path and a path means a different file in each root.
 */
const pinnedTabFiles = computed<OpenMachineFile[]>(() =>
  pinnedFiles.value
    .filter((entry) => entry.root === machineFiles.currentRoot)
    .map((entry) => ({
      kind: 'file',
      name: entry.name,
      path: entry.path,
      size: entry.size,
      modified: entry.modified,
      permissions: entry.permissions,
    })),
)
const unpinnedTabs = computed(() =>
  machineFiles.openTabs.filter((tab) => !isPinned(machineFiles.currentRoot, tab.file.path)),
)
const hasTabs = computed(() => pinnedTabFiles.value.length > 0 || unpinnedTabs.value.length > 0)
const currentFileReadOnly = computed(
  () => machineFiles.currentFile !== null && !machineFiles.currentFile.permissions.includes('w'),
)
const isEditorFullscreen = computed(
  () => machineFiles.currentFile !== null && editorDisplayMode.value === 'fullscreen',
)
const canMutate = computed(
  () =>
    moonrakerAvailability.value.isAvailable &&
    machineFiles.currentDirectoryPermissions.includes('w') &&
    !machineFiles.isMutating,
)
const canSave = computed(
  () =>
    canMutate.value &&
    !currentFileReadOnly.value &&
    machineFiles.currentFile !== null &&
    machineFiles.currentFileKind === 'text',
)
/*
 * Save all writes files anywhere under the config root, not just in the folder
 * on screen, so it is gated on the connection rather than on `canMutate`'s
 * current-directory permissions. Discard all needs no gate beyond having
 * something to discard: it only drops buffers this browser holds.
 */
const canSaveAll = computed(
  () =>
    moonrakerAvailability.value.isAvailable &&
    !machineFiles.isMutating &&
    machineFiles.hasUnsavedFiles,
)
/** Unsaved files other than the one on screen — every unsaved file while nothing is open. */
const otherUnsavedCount = computed(
  () =>
    machineFiles.unsavedFilePaths.filter((path) => path !== machineFiles.currentFile?.path).length,
)
// printer.cfg lives at the config root, not the directory currently browsed,
// so adding or removing an include is gated on root permissions rather than canMutate.
const canEditPrimaryConfig = computed(
  () =>
    moonrakerAvailability.value.isAvailable &&
    machineFiles.rootPermissions.includes('w') &&
    !machineFiles.isMutating,
)
const isCurrentFileImage = computed(() => machineFiles.currentFileKind === 'image')
const isCurrentFileHtml = computed(() => machineFiles.currentFileKind === 'html')
// Neither an image nor an HTML file is rendered through the text editor, and
// neither takes the editor's own save/discard/outline chrome — one predicate
// for "this file is shown, not edited" rather than repeating the OR at every
// call site.
const isCurrentFilePreview = computed(() => isCurrentFileImage.value || isCurrentFileHtml.value)
/*
 * Both roots are offered unconditionally rather than gated on what `server.info`
 * registered. A Moonraker without `logs` answers the listing with an error the
 * workspace already renders, and hiding the control would leave the user with no
 * way to tell the root is missing from the one place it would be mentioned.
 */
const fileRoots: MachineFileRoot[] = ['config', 'logs']
const canNavigateFileHistoryBack = computed(
  () => fileHistoryIndex.value > 0 && !machineFiles.isEditorLoading,
)
const canNavigateFileHistoryForward = computed(
  () =>
    fileHistoryIndex.value >= 0 &&
    fileHistoryIndex.value < fileHistory.value.length - 1 &&
    !machineFiles.isEditorLoading,
)
const SECTION_LINE = /^\s*\[([^\]]+)]/
/*
 * One split of the open file, shared by everything that needs its lines — the
 * gutter's count, the rendered window, the section outline, and Go to line.
 * Each of those used to split the buffer for itself, and all of them ran again
 * on every keystroke.
 */
const editorLines = computed(() => machineFiles.editorContent.split('\n'))
/*
 * Which lines differ from disk, and whether that difference has been written
 * yet. Both baselines are split lazily and separately from `editorLines`, so
 * typing re-splits only the buffer that actually changed; the string-equality
 * gate above them means a file nobody has touched costs a pointer comparison
 * rather than a diff.
 */
const savedLines = computed(() => machineFiles.savedContent.split('\n'))
const originLines = computed(() => machineFiles.originContent.split('\n'))
const lineChanges = computed(() => {
  const content = machineFiles.editorContent
  if (content === machineFiles.savedContent && content === machineFiles.originContent) {
    return NO_LINE_CHANGE_MARKS
  }
  return lineChangeMarks(editorLines.value, savedLines.value, originLines.value)
})
const highlightsSyntax = computed(
  () =>
    machineFiles.currentRoot === 'config' &&
    isConfigSyntaxFile(machineFiles.currentFile?.name ?? ''),
)
/**
 * The explorer's search box, ready to highlight in the open file — a term
 * that found this file by name or by content is the same term worth marking
 * once the reader is actually inside it. Trimmed so a box that is empty, or
 * holds only whitespace, highlights nothing.
 */
const editorSearchQuery = computed(() => search.value.trim())
/*
 * Every word the editor puts on screen, passed in rather than looked up inside
 * it: the editor's own modules are free of Vue and of vue-i18n so their rules
 * can be tested without either.
 */
const editorLabels = computed(() => ({
  changedUnsaved: t('configuration.editor.changedUnsaved'),
  changedSaved: t('configuration.editor.changedSaved'),
  removedUnsaved: t('configuration.editor.removedUnsaved'),
  removedSaved: t('configuration.editor.removedSaved'),
  fold: t('configuration.editor.fold'),
  unfold: t('configuration.editor.unfold'),
  foldedLines: (count: number) => t('configuration.editor.foldedLines', { count }),
}))
const editorCommands = {
  save: (restart: boolean) => void save(restart),
  canSaveAndRestart: () => klipperAvailability.value.isAvailable,
  openShortcuts: () => {
    shortcutsOpen.value = true
  },
}
function directoryIsKnownToExist(directory: string): boolean {
  if (directory === '') return true
  const prefix = `${directory}/`
  return machineFiles.searchFiles.some(
    (file) => file.path === directory || file.path.startsWith(prefix),
  )
}

/*
 * Derived from the tokens actually on screen, not re-parsed from the raw
 * content: an `includePath` token only exists here for a line the Klipper
 * tokenizer recognized as a real include (matching includes.ts's own rules
 * on spacing, case, and trailing content), so this list and the highlight
 * layer's coloring can never disagree about what counts as one.
 *
 * On screen is also all this is for. The persistent dead-include mark and the
 * Ctrl+click hit test both address a line the user can see, so an include
 * scrolled out of view has nothing to contribute and is not worth a pass over
 * the file to find.
 */
/**
 * What one `[include]` path resolves to, asked by the editor for each path it
 * is about to draw. The paths themselves come from the same parse the colouring
 * uses, so the two can never disagree about what counts as one; this only
 * answers what the application knows about the target.
 *
 * Neither "dead" nor "confirmed real" until the file index has loaded — an
 * empty `searchFiles` before that point must not read as every include in the
 * file pointing nowhere.
 */
function describeInclude(text: string): IncludeTargetInfo | null {
  const file = machineFiles.currentFile
  if (!file) return null
  const targetPath = resolvableIncludeTarget(file.path, text)
  if (!targetPath) return null
  const indexReady = machineFiles.searchFilesLoaded
  const exists = indexReady
    ? machineFiles.searchFiles.some((entry) => entry.path === targetPath)
    : null
  const directory = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : ''
  return {
    targetPath,
    dead: exists === false,
    directoryExists: !indexReady ? null : exists || directoryIsKnownToExist(directory),
    title:
      exists === false
        ? t('configuration.editor.deadIncludeTooltip', { path: targetPath })
        : t('configuration.editor.openInclude', { path: targetPath }),
  }
}
/*
 * `describeInclude` reads the file index and the locale, neither of which is a
 * document change, so the editor is told to ask again when either moves. The
 * index finishing its load is what turns every include in a freshly opened file
 * from "unknown" into real or dead.
 */
const includeGeneration = computed(
  () => machineFiles.searchFiles.length + (machineFiles.searchFilesLoaded ? 1 : 0),
)
/*
 * The outline is the config file's own sections, so it is built only for a file
 * whose sections mean something — the same predicate that decides coloring.
 * A `[...]` line in a log or a sliced file is not a section, and scanning for
 * them cost a regex per line across the largest files in the workspace to
 * produce a list of things that are not there.
 */
const fileStructure = computed(() => {
  if (!highlightsSyntax.value) return []
  const structure: Array<{ name: string; line: number }> = []
  for (const [index, line] of editorLines.value.entries()) {
    const match = SECTION_LINE.exec(line)
    if (match?.[1]) structure.push({ name: match[1], line: index + 1 })
  }
  return structure
})
const dateFormatter = computed(() => createDateTimeFormatter(locale.value, { style: 'short' }))
const numberFormatter = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
)

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return t('units.emptySize')
  if (bytes < 1024) return t('units.size.bytes', { value: numberFormatter.value.format(bytes) })
  if (bytes < 1024 * 1024)
    return t('units.size.kilobytes', { value: numberFormatter.value.format(bytes / 1024) })
  if (bytes < 1024 * 1024 * 1024)
    return t('units.size.megabytes', {
      value: numberFormatter.value.format(bytes / (1024 * 1024)),
    })
  return t('units.size.gigabytes', {
    value: numberFormatter.value.format(bytes / (1024 * 1024 * 1024)),
  })
}

function formatModified(timestamp: number): string {
  return dateFormatter.value.format(new Date(timestamp * 1000))
}

function setEditorDisplayMode(mode: EditorDisplayMode): void {
  editorDisplayMode.value = mode
  localStorage.setItem(editorDisplayModeStorageKey, mode)
}

function toggleFullscreen(): void {
  setEditorDisplayMode(editorDisplayMode.value === 'fullscreen' ? 'maximized' : 'fullscreen')
}

const singlePaneQuery =
  typeof window.matchMedia === 'function' ? window.matchMedia(SINGLE_PANE_QUERY) : null
const singlePane = ref(singlePaneQuery?.matches ?? false)

function onSinglePaneChange(event: MediaQueryListEvent): void {
  singlePane.value = event.matches
}

function isSinglePane(): boolean {
  return singlePaneQuery?.matches ?? false
}

/**
 * The explorer auto-hides while unpinned, as a Visual Studio tool window does:
 * it slides out over the viewer while the pointer is on the side strip or on
 * it, and away again once it is not. Only where it can dock at all — below
 * 55 rem the workspace shows one card at a time instead — and never in
 * fullscreen, which covers the strip.
 */
const explorerAutoHides = computed(
  () => explorerHidden.value && !singlePane.value && !isEditorFullscreen.value,
)
const explorerPane = ref<HTMLElement | null>(null)
const sideStrip = ref<HTMLElement | null>(null)
const explorerPinButton = ref<InstanceType<typeof AppButton> | null>(null)
const explorerPeek = useAutoHidePanel({
  enabled: explorerAutoHides,
  regions: () => [explorerPane.value, sideStrip.value],
  busy: () =>
    contextMenu.value !== null ||
    draggingEntry.value !== null ||
    isExternalDropZoneActive.value ||
    document.querySelector('dialog[open]') !== null,
  returnFocus: () => (explorerPinButton.value?.$el as HTMLElement | undefined) ?? null,
})
const explorerPeekOpen = explorerPeek.open

/*
 * Stored under the key the old hide toggle used, because "hidden" meant the
 * same choice: the explorer does not hold a column of its own beside the
 * file. A reader who had hidden it gets it auto-hidden rather than docked.
 */
function toggleExplorerPin(): void {
  explorerHidden.value = !explorerHidden.value
  localStorage.setItem(explorerHiddenStorageKey, String(explorerHidden.value))
}

function showExplorer(): void {
  if (isSinglePane()) mobileExplorerOpen.value = true
  else if (explorerAutoHides.value) explorerPeek.show()
}

/**
 * Choosing a root is asking to see it, so an auto-hidden explorer slides out
 * with it, which is also how a touch screen, with no hover, opens it at all.
 */
function chooseRoot(root: MachineFileRoot): void {
  if (machineFiles.currentRoot !== root) void machineFiles.setRoot(root)
  // One card at a time has no pin to put the explorer away with, so the root
  // already on screen hands the card back to the open file.
  else if (singlePane.value && mobileExplorerOpen.value && machineFiles.currentFile) {
    mobileExplorerOpen.value = false
    return
  }
  showExplorer()
}

/**
 * Gates opening a file behind a confirmation when it can't be shown reliably:
 * an unrecognized (likely binary) type, or a file large enough to stall the
 * plain-textarea editor or an in-browser image decode.
 */
async function openWithWarningGate(
  name: string,
  size: number,
  run: () => void | Promise<void>,
): Promise<void> {
  const kind = classifyFileKind(name)
  if (
    (kind === 'unsupported' || isLargeFile(kind, size)) &&
    confirmations.shouldConfirm('openUnsupportedFile')
  ) {
    pendingFileOpen.value = {
      run,
      reason: kind === 'unsupported' ? 'unsupported' : 'large',
      name,
      sizeLabel: formatSize(size),
    }
    return
  }
  await run()
}

async function confirmPendingFileOpen(): Promise<void> {
  const pending = pendingFileOpen.value
  pendingFileOpen.value = null
  if (pending) await pending.run()
}

function cancelPendingFileOpen(): void {
  pendingFileOpen.value = null
  // A cancelled warning dialog means the history step it was gating never
  // lands, so nothing will ever consume this and it must not linger to
  // wrongly suppress some unrelated later navigation to the same path.
  suppressedHistoryPath = null
}

/** Stable identity for a row, used for drop-target and context-menu state. */
function entryKey(entry: MachineFileEntry): string {
  return entry.kind + ':' + entryPathOf(entry)
}

/** Path of an entry within the root: its own, or the browsed folder's joined with its name. */
function entryPathOf(entry: MachineFileEntry): string {
  if (entry.path !== undefined) return entry.path
  return machineFiles.currentPath ? machineFiles.currentPath + '/' + entry.name : entry.name
}

/** The folder an entry sits in, '' for the root. */
function entryDirectoryOf(entry: MachineFileEntry): string {
  const path = entryPathOf(entry)
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

/** Whether this entry is the file open in the editor. */
function isOpenFile(entry: MachineFileEntry): boolean {
  return entry.kind === 'file' && machineFiles.currentFile?.path === entryPathOf(entry)
}

/** Whether this entry itself may be moved, renamed or deleted. */
function isWritable(entry: MachineFileEntry): boolean {
  return canMutate.value && entry.permissions.includes('w')
}

/*
 * Whether printer.cfg already includes this file, for the faint icon tint.
 * Reads the store's cache directly rather than triggering a fetch — it
 * starts empty and fills in the background, so the tint may briefly lag
 * behind reality right after the file list first loads.
 */
function isEntryIncluded(entry: MachineFileEntry): boolean {
  // Only the config root can be included in printer.cfg. The included set holds
  // config-root paths, so asking it about a log would answer about a config file
  // that happens to share the name.
  if (!machineFiles.isRootEditable) return false
  return entry.kind === 'file' && machineFiles.isPathIncluded(entryPathOf(entry))
}

/*
 * Whether this entry has unsaved edits sitting in memory — for a folder, that
 * means anywhere inside it, so an edit the row is currently hiding still shows
 * on the way down to it. The row keeps the same "Unsaved" mark either way: on a
 * folder it reads as "something in here is unsaved", which is the actionable
 * fact, and it keeps this status from resting on color alone.
 */
function isEntryDirty(entry: MachineFileEntry): boolean {
  const path = entryPathOf(entry)
  return entry.kind === 'directory'
    ? machineFiles.hasUnsavedFilesUnder(path)
    : machineFiles.isPathDirty(path)
}

/** Whether "Add/Remove from printer.cfg" makes sense for this entry: another config file. */
function isIncludableEntry(entry: MachineFileEntry): boolean {
  return (
    machineFiles.isRootEditable &&
    entry.kind === 'file' &&
    isIncludableConfigPath(entry.name) &&
    entryPathOf(entry) !== PRIMARY_CONFIG
  )
}

/** Whether this entry is pinned to the top of the explorer, in the root currently browsed. */
function isEntryPinned(entry: MachineFileEntry): boolean {
  return isPinned(machineFiles.currentRoot, entryPathOf(entry))
}

function togglePinEntry(entry: MachineFileEntry): void {
  closeContextMenu()
  if (entry.kind !== 'file') return
  const path = entryPathOf(entry)
  if (isPinned(machineFiles.currentRoot, path)) {
    unpinTab(path)
    return
  }
  pinFile({
    kind: 'file',
    root: machineFiles.currentRoot,
    path,
    name: entry.name,
    size: entry.size,
    modified: entry.modified,
    permissions: entry.permissions,
  })
}

async function toggleIncludeInPrinterConfig(
  entry: MachineFileEntry,
  isIncluded: boolean,
): Promise<void> {
  closeContextMenu()
  if (isIncluded) await machineFiles.removeIncludeFor(entry)
  else await machineFiles.addIncludeFor(entry)
}

/*
 * Whether printer.cfg already includes this entry is only known after asking
 * the store, so the menu doesn't open — and can't flash the wrong label —
 * until that check (when relevant) has resolved.
 */
async function openContextMenu(event: MouseEvent, entry: MachineFileEntry): Promise<void> {
  if (!canMutate.value) return
  const requestId = ++contextMenuRequestId
  const includable = isIncludableEntry(entry)
  const isIncluded = includable ? await machineFiles.isIncludedInPrimaryConfig(entry) : false
  if (requestId !== contextMenuRequestId) return
  contextMenu.value = { entry, x: event.clientX, y: event.clientY, includable, isIncluded }
}

function closeContextMenu(): void {
  contextMenu.value = null
}

// The root row stands for the whole root, which can be neither renamed nor deleted.
function openRowContextMenu(event: MouseEvent, row: ExplorerTreeRow): void {
  if (row.level === 0 && !isSearching.value) return
  void openContextMenu(event, row.entry)
}

function renameEntry(entry: MachineFileEntry): void {
  closeContextMenu()
  pendingRename.value = entry
}

async function confirmRename(name: string): Promise<void> {
  const entry = pendingRename.value
  pendingRename.value = null
  if (!entry) return
  const previousPath = entryPathOf(entry)
  const filename = name.trim()
  const directory = entryDirectoryOf(entry)
  const nextPath = directory ? `${directory}/${filename}` : filename
  if (await machineFiles.renameEntry(entry, name)) {
    repointPinned(machineFiles.currentRoot, previousPath, nextPath)
  }
}

/*
 * The no-op guards that used to run after window.prompt returned — empty input,
 * an unchanged rename — are the prompt dialogs' validators instead, so an
 * invalid value keeps the dialog open with its reason rather than silently
 * doing nothing.
 */
function requireEntryName(value: string): string | undefined {
  return value.trim() ? undefined : t('configuration.prompts.nameRequired')
}

function validateRename(value: string): string | undefined {
  const name = value.trim()
  if (!name) return t('configuration.prompts.nameRequired')
  if (name === pendingRename.value?.name) return t('configuration.rename.unchanged')
  return undefined
}

function downloadEntry(entry: MachineFileEntry): void {
  closeContextMenu()
  const url = machineFiles.downloadUrlFor(entry)
  if (!url) return
  // An anchor click keeps the browser's own download handling, including the
  // filename, rather than navigating the application away from the route.
  const link = document.createElement('a')
  link.href = url
  link.download = entry.name
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function requestDeleteEntry(entry: MachineFileEntry): void {
  closeContextMenu()
  if (confirmations.shouldConfirm('deleteFileEntry')) {
    pendingDelete.value = entry
    return
  }
  const path = entryPathOf(entry)
  void machineFiles.deleteEntry(entry).then((deleted) => {
    if (deleted) repointPinned(machineFiles.currentRoot, path, null)
  })
}

async function confirmDeleteEntry(): Promise<void> {
  const entry = pendingDelete.value
  pendingDelete.value = null
  if (!entry) return
  const path = entryPathOf(entry)
  if (await machineFiles.deleteEntry(entry)) repointPinned(machineFiles.currentRoot, path, null)
}

/** True while the drag carries OS files rather than one of our own rows. */
function isExternalFileDrag(event: DragEvent): boolean {
  return Boolean(event.dataTransfer?.types.includes('Files'))
}

/** Whether files dragged in from outside the browser may land on this row. */
function canDropExternalOn(target: MachineFileEntry): boolean {
  if (!moonrakerAvailability.value.isAvailable || machineFiles.isMutating) return false
  return target.kind === 'directory' && target.permissions.includes('w')
}

/** Whether the list background itself (not a specific row) accepts a drop. */
const isExternalDropZoneActive = computed(
  () => externalDragDepth.value > 0 && dropTargetKey.value === null,
)

function onExternalDragEnter(event: DragEvent): void {
  if (!isExternalFileDrag(event) || !canMutate.value) return
  event.preventDefault()
  externalDragDepth.value += 1
}

function onExternalDragOver(event: DragEvent): void {
  if (!isExternalFileDrag(event) || !canMutate.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onExternalDragLeave(event: DragEvent): void {
  if (!isExternalFileDrag(event)) return
  externalDragDepth.value = Math.max(0, externalDragDepth.value - 1)
}

async function onExternalDrop(event: DragEvent): Promise<void> {
  if (!isExternalFileDrag(event)) return
  event.preventDefault()
  externalDragDepth.value = 0
  if (!canMutate.value) return
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length) await machineFiles.uploadFiles(files)
}

function onDragStart(event: DragEvent, entry: MachineFileEntry): void {
  // The draggable attribute is a hint the platform will honor loosely, so the
  // permission check is repeated where the drag actually starts.
  if (!isWritable(entry) || entry.kind !== 'file') {
    event.preventDefault()
    return
  }
  draggingEntry.value = entry
  dragGhostPosition.value = { x: event.clientX, y: event.clientY }
  event.dataTransfer?.setData('text/plain', entryPathOf(entry))
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setDragImage(dragGhostSuppressionImage, 0, 0)
  }
}

function onDragEnd(): void {
  cancelPendingDropTargetClear()
  draggingEntry.value = null
  dropTargetKey.value = null
  dragGhostPosition.value = null
}

/**
 * Keeps the custom drag ghost under the pointer. Bound on the window rather
 * than the file list so the ghost keeps tracking even over the gaps between
 * rows and the list's own padding, which fire no row-level dragover.
 */
function trackDragGhost(event: DragEvent): void {
  if (!draggingEntry.value) return
  dragGhostPosition.value = { x: event.clientX, y: event.clientY }
}

/** Whether the dragged file can land on this row. */
function canDropOn(entry: MachineFileEntry): boolean {
  const dragged = draggingEntry.value
  if (!dragged || !isWritable(dragged)) return false
  // A read-only folder cannot receive the file either.
  return entry.kind === 'directory' && entry.permissions.includes('w')
}

/**
 * Pending `dropTargetKey` clear, scheduled one frame out by onDragLeave and
 * cancelled here so a row that is still the real target is never dropped for
 * even a frame. dragenter/dragleave fire on every descendant boundary the
 * pointer crosses — the same reason externalDragDepth exists below — so
 * moving from a row's own background onto its filename or icon fires a
 * genuine dragleave on the row before the following dragover (which bubbles
 * up from that same descendant) re-affirms it. Clearing immediately on that
 * dragleave read as the row blinking to "drop denied" at that boundary; this
 * cancels the clear before it ever reaches dropTargetKey.
 */
let dropTargetClearFrame: number | null = null

function cancelPendingDropTargetClear(): void {
  if (dropTargetClearFrame === null) return
  cancelAnimationFrame(dropTargetClearFrame)
  dropTargetClearFrame = null
}

function activateDropTarget(entry: MachineFileEntry): void {
  cancelPendingDropTargetClear()
  dropTargetKey.value = entryKey(entry)
}

/**
 * Bound to both dragenter and dragover on a row — identically, since both
 * ask the same question ("can this land here right now?"). dragenter fires
 * on whichever descendant the pointer newly lands on (a row's own filename
 * or icon counts), and an unhandled dragenter leaves the browser's own drag
 * cursor at "no drop" until something else prevents default; the bubbled
 * dragover that follows was already prevented here, but that recovers this
 * function's own dropTargetKey without necessarily recovering the browser's
 * cursor, which is what was still flashing denied at that same boundary.
 */
function onDragOver(event: DragEvent, entry: MachineFileEntry): void {
  if (isExternalFileDrag(event)) {
    if (!canDropExternalOn(entry)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    activateDropTarget(entry)
    return
  }
  if (!canDropOn(entry)) return
  // Preventing default is what marks this element as a valid drop target.
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  activateDropTarget(entry)
}

function onDragLeave(event: DragEvent, entry: MachineFileEntry): void {
  const key = entryKey(entry)
  if (dropTargetKey.value !== key) return
  // relatedTarget names the element the pointer is entering. When it is
  // still inside this row — its filename, its icon — nothing has actually
  // been left, and the row-level dragenter that follows never reaches this
  // handler to say so, since dragleave and dragenter fire on separate
  // elements. The animation-frame defer below is only a fallback for the
  // rare case a browser reports no relatedTarget at all (leaving the window
  // entirely, for instance).
  const related = event.relatedTarget
  const row = event.currentTarget
  if (row instanceof Node && related instanceof Node && row.contains(related)) return
  cancelPendingDropTargetClear()
  dropTargetClearFrame = requestAnimationFrame(() => {
    dropTargetClearFrame = null
    if (dropTargetKey.value === key) dropTargetKey.value = null
  })
}

async function onDrop(event: DragEvent, target: MachineFileEntry): Promise<void> {
  event.preventDefault()

  if (isExternalFileDrag(event)) {
    // Claim the event so it doesn't also reach the list's own drop handler,
    // which would upload the same files a second time into the current folder.
    event.stopPropagation()
    const files = [...(event.dataTransfer?.files ?? [])]
    const allowed = canDropExternalOn(target)
    cancelPendingDropTargetClear()
    dropTargetKey.value = null
    if (!allowed || files.length === 0) return
    const directory = entryPathOf(target)
    await machineFiles.uploadFiles(files, directory)
    return
  }

  const dragged = draggingEntry.value
  const allowed = canDropOn(target)
  onDragEnd()
  if (!dragged || !allowed) return

  const destination = entryPathOf(target)

  // Moving an open file repoints the editor without replacing its content, so
  // unsaved edits remain open and do not need a discard decision.
  // A move can invalidate an [include] in printer.cfg, which would stop
  // Klipper from starting. Check and warn before moving anything, so the
  // user can choose to leave the file where it is instead of discovering
  // the broken include after the fact.
  const { rewrite } = await machineFiles.checkMoveInclude(dragged, destination)
  if (!rewrite) {
    const moved = await machineFiles.moveEntryTo(dragged, destination)
    if (moved) repointPinned(machineFiles.currentRoot, moved.previousPath, moved.nextPath)
    return
  }
  pendingMove.value = { entry: dragged, destination, rewrite }
  await nextTick()
  if (moveDialog.value && !moveDialog.value.open) moveDialog.value.showModal()
}

async function confirmMoveWithInclude(): Promise<void> {
  const pending = pendingMove.value
  pendingMove.value = null
  if (moveDialog.value?.open) moveDialog.value.close()
  if (!pending) return
  const moved = await machineFiles.moveEntryTo(pending.entry, pending.destination)
  if (moved) {
    repointPinned(machineFiles.currentRoot, moved.previousPath, moved.nextPath)
    await machineFiles.applyIncludeUpdate(pending.rewrite.content)
  }
}

async function confirmMoveWithoutInclude(): Promise<void> {
  const pending = pendingMove.value
  pendingMove.value = null
  if (moveDialog.value?.open) moveDialog.value.close()
  if (!pending) return
  const moved = await machineFiles.moveEntryTo(pending.entry, pending.destination)
  if (moved) repointPinned(machineFiles.currentRoot, moved.previousPath, moved.nextPath)
}

function cancelPendingMove(event?: Event): void {
  event?.preventDefault()
  pendingMove.value = null
  if (moveDialog.value?.open) moveDialog.value.close()
}

/*
 * A single click opens a file in the preview tab, so browsing the tree replaces
 * one tab instead of leaving one behind per file; a double click, or an edit,
 * keeps it. A folder opens or closes in place, and becomes the folder new
 * files and uploads land in.
 */
async function chooseRow(row: ExplorerTreeRow): Promise<void> {
  const entry = row.entry
  treeFocusPath.value = entry.path
  if (entry.path === '') {
    await machineFiles.selectDirectory('')
    return
  }
  if (entry.kind === 'directory') {
    if (row.expanded) machineFiles.collapseDirectory(entry.path)
    else void machineFiles.expandDirectory(entry.path)
    await machineFiles.selectDirectory(entry.path)
    return
  }
  void machineFiles.selectDirectory(row.parentPath)
  mobileExplorerOpen.value = false
  const match = contentMatchFor(entry.path)
  if (machineFiles.currentFile?.path !== entry.path) {
    await openWithWarningGate(entry.name, entry.size, async () => {
      await machineFiles.openFile(entry, { preview: true })
    })
  }
  if (match && machineFiles.currentFile?.path === entry.path) {
    await nextTick()
    revealContentMatch(match)
  }
}

/*
 * Only a result the content search found, for the query on screen: a file
 * listed because its name matched has no line to land on, and a match left
 * over from an earlier query would land on text nobody is looking for.
 */
function contentMatchFor(path: string): ContentSearchMatch | null {
  if (!isSearching.value || !searchInFileContents.value) return null
  if (machineFiles.contentSearchQuery !== search.value.trim()) return null
  return machineFiles.contentSearchMatches.get(path) ?? null
}

function revealContentMatch(match: ContentSearchMatch): void {
  goToLine(match.line + 1)
  const lineStart = lineStartOffset(match.line)
  codeEditor.value?.selectRange(lineStart + match.column, lineStart + match.column + match.length)
}

function keepRow(row: ExplorerTreeRow): void {
  if (row.entry.kind === 'file') machineFiles.keepTab(row.entry.path)
}

function focusTreeRow(path: string): void {
  const list = explorerList.value
  if (!list) return
  const row = [...list.querySelectorAll<HTMLElement>('[data-tree-path]')].find(
    (element) => element.dataset.treePath === path,
  )
  row?.focus()
  row?.scrollIntoView?.({ block: 'nearest' })
}

async function onTreeKeydown(event: KeyboardEvent, index: number): Promise<void> {
  const action = explorerTreeKeyAction(explorerRows.value, index, event.key)
  if (!action) return
  event.preventDefault()
  if (action.kind === 'expand') {
    await machineFiles.expandDirectory(action.path)
    return
  }
  if (action.kind === 'collapse') {
    // The root row stands for the whole tree and never closes.
    if (action.path !== '') machineFiles.collapseDirectory(action.path)
    return
  }
  const target = explorerRows.value[action.index]
  if (!target) return
  treeFocusPath.value = target.entry.path
  await nextTick()
  focusTreeRow(target.entry.path)
}

/**
 * Brings `path` into view in the tree: clears a search that would hide it,
 * opens every folder above it, and shows the explorer if it was hidden.
 */
async function revealInExplorer(path: string, { focus = true } = {}): Promise<void> {
  search.value = ''
  showExplorer()
  await machineFiles.revealPath(path)
  treeFocusPath.value = path
  await nextTick()
  if (focus) focusTreeRow(path)
}

/*
 * A pinned file that has not been opened this session has no tab yet, so it
 * is opened through the same warning gate as a click in the tree; any other
 * tab already passed that gate when it was opened.
 */
async function activateTab(path: string): Promise<void> {
  mobileExplorerOpen.value = false
  if (machineFiles.openTabs.some((tab) => tab.file.path === path)) {
    await machineFiles.activateTab(path)
    return
  }
  const pinned = pinnedTabFiles.value.find((file) => file.path === path)
  if (!pinned) return
  await openWithWarningGate(pinned.name, pinned.size, async () => {
    await machineFiles.openFileByPath(pinned)
  })
}

/*
 * Closing a pinned tab unpins it too: the pinned row shows every pin, so a
 * close that left the pin in place would leave the tab exactly where it was.
 */
function closeTab(path: string): void {
  if (isPinned(machineFiles.currentRoot, path)) unpinFile(machineFiles.currentRoot, path)
  void machineFiles.closeTab(path)
}

function pinTab(path: string): void {
  const file = tabFile(path)
  if (file) pinFile({ ...file, root: machineFiles.currentRoot })
}

function unpinTab(path: string): void {
  const file = tabFile(path)
  unpinFile(machineFiles.currentRoot, path)
  if (file) machineFiles.placeTabFirst(file)
}

function tabFile(path: string): OpenMachineFile | null {
  return (
    machineFiles.openTabs.find((tab) => tab.file.path === path)?.file ??
    pinnedTabFiles.value.find((file) => file.path === path) ??
    null
  )
}

function openTabMenu(event: MouseEvent, path: string): void {
  tabMenu.value = { path, x: event.clientX, y: event.clientY }
}

function closeTabMenu(): void {
  tabMenu.value = null
}

function tabMenuIsPinned(path: string): boolean {
  return isPinned(machineFiles.currentRoot, path)
}

function tabMenuClose(path: string): void {
  closeTabMenu()
  closeTab(path)
}

function tabMenuCloseOthers(path: string): void {
  closeTabMenu()
  void machineFiles.closeTabs(
    unpinnedTabs.value.map((tab) => tab.file.path).filter((candidate) => candidate !== path),
  )
}

function tabMenuCloseAll(): void {
  closeTabMenu()
  void machineFiles.closeTabs(unpinnedTabs.value.map((tab) => tab.file.path))
}

function tabMenuTogglePin(path: string): void {
  closeTabMenu()
  const file = tabFile(path)
  if (!file) return
  if (isPinned(machineFiles.currentRoot, path)) unpinTab(path)
  else pinFile({ ...file, root: machineFiles.currentRoot })
}

function tabMenuReveal(path: string): void {
  closeTabMenu()
  void revealInExplorer(path)
}

function createFile(): void {
  pendingCreateFile.value = true
}

async function confirmCreateFile(name: string): Promise<void> {
  pendingCreateFile.value = false
  await machineFiles.createFile(name)
}

function createDirectory(): void {
  pendingCreateDirectory.value = true
}

async function confirmCreateDirectory(name: string): Promise<void> {
  pendingCreateDirectory.value = false
  await machineFiles.createDirectory(name)
}

function selectUpload(): void {
  uploadInput.value?.click()
}

async function uploadSelected(event: Event): Promise<void> {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const files = [...(input.files ?? [])]
  input.value = ''
  await machineFiles.uploadFiles(files)
}

async function save(restart: boolean): Promise<void> {
  if (restart && machineFiles.hasOtherUnsavedFiles(machineFiles.currentFile?.path ?? '')) {
    if (confirmations.shouldConfirm('saveAllAndRestart')) pendingRestartWithUnsaved.value = true
    else await machineFiles.saveAllFiles(true)
    return
  }
  await machineFiles.saveFile(restart)
}

async function confirmSaveAllAndRestart(): Promise<void> {
  pendingRestartWithUnsaved.value = false
  await machineFiles.saveAllFiles(true)
}

function requestDiscardChanges(): void {
  if (confirmations.shouldConfirm('discardFileChanges')) pendingDiscard.value = true
  else machineFiles.discardCurrentFileChanges()
}

function confirmDiscardChanges(): void {
  pendingDiscard.value = false
  machineFiles.discardCurrentFileChanges()
}

function requestSaveAll(): void {
  if (confirmations.shouldConfirm('saveAllFiles')) pendingSaveAll.value = true
  else void machineFiles.saveAllFiles()
}

async function confirmSaveAll(): Promise<void> {
  pendingSaveAll.value = false
  await machineFiles.saveAllFiles()
}

function requestDiscardAll(): void {
  if (confirmations.shouldConfirm('discardAllFiles')) pendingDiscardAll.value = true
  else machineFiles.discardAllChanges()
}

function confirmDiscardAll(): void {
  pendingDiscardAll.value = false
  machineFiles.discardAllChanges()
}

/**
 * One line command run from the editor menu rather than from its chord. The
 * command itself is the same pure function the keymap calls; this only gives
 * it the document and turns its answer into a transaction.
 */
function applyEditorLineEdit(edit: LineEdit | null): boolean {
  const view = codeEditor.value?.view()
  if (!view || !edit) return false
  view.focus()
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.text },
    selection: { anchor: edit.selectionStart, head: edit.selectionEnd },
    scrollIntoView: true,
    userEvent: 'input.machine',
  })
  return true
}

/*
 * A modal dialog owns the keyboard while it is open, so nothing at window level
 * answers a key behind it. Escape belongs to the dialog's own cancel path: both
 * used to answer it, so dismissing any dialog from the fullscreen editor left
 * fullscreen too, and the reader had no way to tell which of the two they had
 * asked for.
 */
function hasOpenDialog(): boolean {
  return document.querySelector('dialog[open]') !== null
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (hasOpenDialog() || quickConfig.viewMode !== 'files') return
  /*
   * The keyboard twin of the mouse's back and forward buttons, and the chord the
   * browser itself uses for them — which, unlike Ctrl+Tab, a page is allowed to
   * cancel. With Alt held, the vertical arrows move lines and the horizontal
   * ones move between files.
   *
   * Known cost, accepted deliberately: on macOS, Option+arrow is word-wise caret
   * movement inside a text field, so a Mac reader loses that in this editor. If
   * that ever needs undoing, Ctrl+Alt+arrow was the alternative considered.
   */
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (event.key === 'ArrowLeft') {
      stepFileHistory(event, -1)
      return
    }
    if (event.key === 'ArrowRight') {
      stepFileHistory(event, 1)
      return
    }
  }
  if (event.key !== 'Escape' || !isEditorFullscreen.value) return
  event.preventDefault()
  setEditorDisplayMode('maximized')
}

/*
 * A mouse's own back and forward buttons step through the files this route has
 * opened rather than leaving it.
 *
 * The reasoning is that following an `[include]` is the navigation the reader
 * just performed, so the button that means "back" should undo that rather than
 * the route change that got them here — the same reading a file manager or an
 * IDE gives those buttons. The file history the editor header's arrows already
 * walk is what they step through, so the two can never disagree about where
 * back goes.
 *
 * They are claimed only while there is a step to take, the same rule Shift+Tab
 * follows: with no file open, or at either end of the history, the button is
 * left to the browser and navigates the page as it always did. That matters more
 * here than for a key, because the mouse button is how some readers leave a page
 * at all.
 *
 * Buttons 3 and 4 are "browser back" and "browser forward". Chromium delivers
 * them as ordinary mouse events and honors `preventDefault()` on the
 * `mousedown`; Firefox handles them in its own chrome and may not deliver them
 * to the page at all, in which case this is inert there rather than wrong — the
 * header arrows and the file history remain the way back on every browser.
 */
const historyMouseButtons = { back: 3, forward: 4 } as const
let claimedHistoryButton = false

function stepFileHistory(event: Event, direction: -1 | 1): boolean {
  const canStep =
    direction === -1 ? canNavigateFileHistoryBack.value : canNavigateFileHistoryForward.value
  if (!canStep) return false
  event.preventDefault()
  void navigateFileHistory(direction)
  return true
}

function handleWindowMouseDown(event: MouseEvent): void {
  claimedHistoryButton = false
  if (event.button !== historyMouseButtons.back && event.button !== historyMouseButtons.forward) {
    return
  }
  const direction = event.button === historyMouseButtons.back ? -1 : 1
  claimedHistoryButton = stepFileHistory(event, direction)
}

/*
 * The press is what navigates, so the release and the `auxclick` that follow it
 * are swallowed rather than acted on — otherwise one click of the button would
 * step twice. Only swallowed when the press was actually claimed, so a button
 * this route declined still reaches the browser intact.
 */
function handleWindowMouseUp(event: MouseEvent): void {
  if (!claimedHistoryButton) return
  if (event.button === historyMouseButtons.back || event.button === historyMouseButtons.forward) {
    event.preventDefault()
  }
}

function handleWindowAuxClick(event: MouseEvent): void {
  if (!claimedHistoryButton) return
  if (event.button === historyMouseButtons.back || event.button === historyMouseButtons.forward) {
    event.preventDefault()
    claimedHistoryButton = false
  }
}

function lineStartOffset(line: number): number {
  let offset = 0
  const lines = editorLines.value
  for (let index = 0; index < line && index < lines.length; index += 1) {
    offset += (lines[index] ?? '').length + 1
  }
  return offset
}

const editorMenuFiles = computed(() =>
  machineFiles.searchFilesLoaded ? machineFiles.searchFiles.map((file) => file.path) : null,
)

/*
 * The editor answers a right-click with a menu about what was clicked, in
 * place of the browser's text menu — but only on the files it can say
 * something about. A log, a `.json`, or a `.txt` keeps the browser's own menu,
 * the same `highlightsSyntax` gate the line commands share, since there is
 * nothing Klipper-specific to offer there and replacing it would cost those
 * files their Paste.
 *
 * Paste is also why Shift is left alone: over plain HTTP a page can cut and
 * copy but never read the clipboard, so the browser's menu has to stay one
 * gesture away — the gesture Firefox already honours on every page. Touch
 * keeps the native long-press, whose selection handles and paste bubble are
 * the editing tools on a phone.
 */
function handleEditorContextMenu(request: EditorContextMenuRequest): void {
  if (!highlightsSyntax.value || !machineFiles.currentFile) return
  /*
   * Quick config's index is what the menu's "used at" and pin rows are built
   * from, and it is started on the first right-click rather than with the route
   * so a reader who never opens the menu never pays for it.
   */
  if (!quickConfigStartedForMenu) {
    quickConfigStartedForMenu = true
    quickConfig.start()
  }
  editorMenu.value = {
    x: request.x,
    y: request.y,
    context: resolveEditorContext(editorLines.value, request.line, request.column),
    selection: request.selection,
  }
}

function closeEditorMenu(): void {
  editorMenu.value = null
}

function lineRangeOffsets(range: { from: number; to: number }): { from: number; to: number } {
  return {
    from: lineStartOffset(range.from),
    to: lineStartOffset(range.to) + (editorLines.value[range.to] ?? '').length,
  }
}

/*
 * Through `execCommand`, not the Clipboard API: the API needs a secure
 * context, which the plain-HTTP deployment in ADR 0003 never is, while a copy
 * or cut run from inside the click that asked for it still works there. With
 * nothing selected, Copy takes the token the menu names, and the selection is
 * put back afterwards.
 */
function copyFromEditor(cut: boolean, context: EditorContext): void {
  const view = codeEditor.value?.view()
  if (!view) return
  view.focus()
  const { from, to } = view.state.selection.main
  if (from !== to || !context.span) {
    document.execCommand(cut ? 'cut' : 'copy')
    return
  }
  const lineStart = lineStartOffset(context.line)
  view.dispatch({
    selection: { anchor: lineStart + context.span.start, head: lineStart + context.span.end },
  })
  document.execCommand('copy')
  view.dispatch({ selection: { anchor: from, head: to } })
}

async function openLocation(path: string, line: number): Promise<void> {
  if (machineFiles.currentFile?.path !== path) await openFileAtPath(path)
  await nextTick()
  goToLine(line + 1)
}

async function requestCreateFile(targetPath: string): Promise<void> {
  const directory = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : ''
  const pending = {
    targetPath,
    directory,
    directoryMissing: machineFiles.searchFilesLoaded && !directoryIsKnownToExist(directory),
  }
  if (confirmations.shouldConfirm('createIncludeTarget')) pendingIncludeCreate.value = pending
  else await createIncludeTarget(pending)
}

/** Finding uses is a search of file contents, so it turns the explorer's content search on. */
function searchConfigFiles(query: string): void {
  if (!searchInFileContents.value) setSearchInFileContents(true)
  showExplorer()
  search.value = query
}

async function runEditorMenuAction(action: EditorMenuAction): Promise<void> {
  const context = editorMenu.value?.context
  closeEditorMenu()
  if (!context) return
  const view = codeEditor.value?.view()
  switch (action.type) {
    case 'cut':
    case 'copy':
      copyFromEditor(action.type === 'cut', context)
      return
    case 'toggleComment': {
      if (!view || currentFileReadOnly.value) return
      const { from, to } = view.state.selection.main
      applyEditorLineEdit(toggleComment(view.state.doc.toString(), from, to))
      return
    }
    case 'commentLines': {
      if (!view || currentFileReadOnly.value) return
      const { from, to } = lineRangeOffsets(action.range)
      applyEditorLineEdit(toggleComment(view.state.doc.toString(), from, to))
      return
    }
    case 'selectLines': {
      const { from, to } = lineRangeOffsets(action.range)
      codeEditor.value?.selectRange(from, to)
      return
    }
    case 'selectSpan': {
      const lineStart = lineStartOffset(context.line)
      codeEditor.value?.selectRange(lineStart + action.start, lineStart + action.end)
      return
    }
    case 'goTo':
      await openLocation(action.path, action.line)
      return
    case 'openFile':
      await openFileAtPath(action.path, { preview: true })
      return
    case 'reveal':
      await revealInExplorer(action.path)
      return
    case 'createFile':
      await requestCreateFile(action.path)
      return
    case 'search':
      searchConfigFiles(action.query)
      return
    case 'showInQuickConfig':
      quickConfig.revealRequest = { section: action.section, option: action.option }
      quickConfig.viewMode = 'quickConfig'
      return
    case 'choosePins':
      editorPickerSection.value = action.section.toLowerCase()
      return
    case 'goToLine':
      pendingGoToLine.value = true
      return
    case 'shortcuts':
      shortcutsOpen.value = true
      return
    case 'pinOption':
    case 'unpinOption':
    case 'applyRuntime':
      // The menu runs these itself; they reach here only if it stops doing so.
      return
  }
}

function saveEditorPickerCard(section: string, options: string[]): void {
  editorPickerSection.value = null
  quickConfig.setSectionPins(section, options)
}

function validateLineNumber(value: string): string | undefined {
  const line = Number(value.trim())
  return Number.isInteger(line) && line >= 1 && line <= editorLines.value.length
    ? undefined
    : t('configuration.editorMenu.lineOutOfRange', { count: editorLines.value.length })
}

function confirmGoToLine(value: string): void {
  pendingGoToLine.value = false
  goToLine(Number(value.trim()))
}

/**
 * Opens a file by path — for a hotlink target, a history step, or Quick
 * config's link. Prefers the search index's metadata (for the large-file and
 * read-only gates), but still attempts the open without it — the store's own
 * fetch is the authority on whether the file actually exists. Following an
 * include or stepping through history opens a preview, the way glancing at a
 * file in the tree does; a link the reader followed to edit keeps its tab.
 */
async function openFileAtPath(path: string, { preview = false } = {}): Promise<void> {
  await machineFiles.ensureSearchFiles()
  const indexed = machineFiles.searchFiles.find((file) => file.path === path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const file = indexed ?? {
    kind: 'file' as const,
    name,
    path,
    size: 0,
    modified: 0,
    permissions: 'rw',
  }
  await openWithWarningGate(file.name, file.size, async () => {
    search.value = ''
    mobileExplorerOpen.value = false
    await machineFiles.openFileByPath(file, { preview })
  })
}

/** Ctrl/Cmd+click on an `[include]` path: open it, or offer to create it. */
async function openIncludeTarget(link: IncludeTargetInfo): Promise<void> {
  if (!link.dead) {
    await openFileAtPath(link.targetPath, { preview: true })
    return
  }
  const directory = link.targetPath.includes('/')
    ? link.targetPath.slice(0, link.targetPath.lastIndexOf('/'))
    : ''
  const pending = {
    targetPath: link.targetPath,
    directory,
    directoryMissing: link.directoryExists === false,
  }
  if (confirmations.shouldConfirm('createIncludeTarget')) pendingIncludeCreate.value = pending
  else await createIncludeTarget(pending)
}

async function createIncludeTarget(pending: PendingIncludeCreate): Promise<void> {
  if (pending.directoryMissing) {
    const createdDirectory = await machineFiles.createDirectoryAt(pending.directory)
    if (!createdDirectory) return
  }
  const createdFile = await machineFiles.createFileAt(pending.targetPath)
  if (!createdFile) return
  await openFileAtPath(pending.targetPath)
}

async function confirmCreateIncludeTarget(): Promise<void> {
  const pending = pendingIncludeCreate.value
  pendingIncludeCreate.value = null
  if (pending) await createIncludeTarget(pending)
}

function cancelCreateIncludeTarget(): void {
  pendingIncludeCreate.value = null
}

/** Tracks the modifier for the hotlink cursor even when the pointer hasn't moved. */
function updateLinkModifierState(event: KeyboardEvent): void {
  isLinkModifierHeld.value = event.ctrlKey || event.metaKey
}

function clearLinkModifierState(): void {
  isLinkModifierHeld.value = false
}

function goToLine(line: number): void {
  codeEditor.value?.revealLine(line)
}

/**
 * Quick config's file-and-line link, the way out to anything a field cannot
 * express, and the fault notice's link to the line Klipper refused.
 */
async function openQuickConfigLocation(path: string, line: number): Promise<void> {
  quickConfig.viewMode = 'files'
  if (machineFiles.currentRoot !== 'config') await machineFiles.setRoot('config')
  await openFileAtPath(path)
  await nextTick()
  goToLine(line + 1)
}

async function navigateFileHistory(direction: -1 | 1): Promise<void> {
  const nextIndex = fileHistoryIndex.value + direction
  const entry = fileHistory.value[nextIndex]
  if (!entry) return
  setFileHistoryIndex(nextIndex)
  suppressedHistoryPath = entry.path
  await openFileAtPath(entry.path, { preview: true })
}

watch(
  () => machineFiles.currentFile?.path,
  (path) => {
    currentEditorLine.value = 1
    if (!path) return
    if (suppressedHistoryPath === path) {
      suppressedHistoryPath = null
      return
    }
    // Reopening the file already at the front of history (closed, then
    // reopened the same way) shouldn't grow it — back would otherwise land on
    // an identical, redundant entry. This is also what keeps `immediate`
    // below from duplicating the front entry on every remount, since the
    // path it fires with hasn't actually changed.
    if (fileHistory.value[fileHistoryIndex.value]?.path === path) return
    pushFileHistory(path, machineFiles.currentFile?.name ?? path.slice(path.lastIndexOf('/') + 1))
  },
  // Immediate, so a file already open when this view mounts — the very first
  // selection of a session, or one that was open before navigating away and
  // back — becomes the first history entry instead of being invisible to a
  // trail that only ever recorded subsequent changes.
  { immediate: true },
)

watch(
  isEditorFullscreen,
  (fullscreen) => document.body.classList.toggle('machine-editor-fullscreen-open', fullscreen),
  { immediate: true },
)

/*
 * The tree follows the file on screen, opening the folders above it, so the
 * explorer always shows where the open file lives — whichever way it was
 * opened. Focus stays where it was: only a deliberate reveal moves it.
 */
watch(
  () => machineFiles.currentFile?.path,
  (path) => {
    if (!path || isSearching.value) return
    void machineFiles.revealPath(path)
    treeFocusPath.value = null
  },
)

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!machineFiles.hasUnsavedFiles) return
  event.preventDefault()
}

onMounted(() => {
  machineFiles.start()
  // Which documentation site this printer links to, and the anchor table, are
  // both small and started here, so the first right-click finds its links
  // ready rather than filling them in while the menu is on screen.
  documentationSite.start()
  void loadDocsAnchors().catch(() => undefined)
  // Loaded eagerly rather than waiting for the search box, so a freshly
  // opened file's dead-include squigglies appear promptly instead of only
  // after the user happens to search for something.
  void machineFiles.ensureSearchFiles()
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('keydown', handleWindowKeydown)
  /*
   * Captured rather than bubbled: the press has to be seen before anything
   * inside the page could stop it propagating, and `preventDefault` is what
   * suppresses the navigation regardless of which phase calls it.
   */
  window.addEventListener('mousedown', handleWindowMouseDown, true)
  window.addEventListener('mouseup', handleWindowMouseUp, true)
  window.addEventListener('auxclick', handleWindowAuxClick, true)
  window.addEventListener('keydown', updateLinkModifierState)
  window.addEventListener('keyup', updateLinkModifierState)
  // A key released while focus was outside the page (another app, a browser
  // shortcut) fires no keyup here, which would otherwise leave the hotlink
  // cursor stuck on until the next unrelated keypress.
  window.addEventListener('blur', clearLinkModifierState)
  window.addEventListener('dragover', trackDragGhost)
  singlePaneQuery?.addEventListener('change', onSinglePaneChange)
  stopLocationRequests = watch(
    () => machineFiles.locationRequest,
    (request) => {
      if (!request) return
      machineFiles.locationRequest = null
      void openQuickConfigLocation(request.path, request.line)
    },
    { immediate: true },
  )
})

onBeforeUnmount(() => {
  stopLocationRequests?.()
  machineFiles.stop()
  if (quickConfigStartedForMenu) quickConfig.stop()
  documentationSite.stop()
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('keydown', handleWindowKeydown)
  window.removeEventListener('mousedown', handleWindowMouseDown, true)
  window.removeEventListener('mouseup', handleWindowMouseUp, true)
  window.removeEventListener('auxclick', handleWindowAuxClick, true)
  window.removeEventListener('keydown', updateLinkModifierState)
  window.removeEventListener('keyup', updateLinkModifierState)
  window.removeEventListener('blur', clearLinkModifierState)
  window.removeEventListener('dragover', trackDragGhost)
  singlePaneQuery?.removeEventListener('change', onSinglePaneChange)
  cancelPendingDropTargetClear()
  document.body.classList.remove('machine-editor-fullscreen-open')
  if (contentSearchTimer) clearTimeout(contentSearchTimer)
})
</script>

<template>
  <section
    class="workspace-page file-explorer-view"
    :class="{ 'machine-view--fullscreen': isEditorFullscreen }"
  >
    <PageHeading :title="t('configuration.files.title')" />

    <div
      class="configuration-views"
      role="group"
      :aria-label="t('configuration.quickConfig.views.label')"
    >
      <button
        v-for="mode in viewModes"
        :key="mode"
        type="button"
        class="tab-select"
        :aria-pressed="quickConfig.viewMode === mode"
        @click="quickConfig.viewMode = mode"
      >
        {{ t(`configuration.quickConfig.views.${mode}`) }}
      </button>
    </div>

    <!--
      Shown and hidden rather than mounted and unmounted: the editor holds a
      whole file in its textarea, and remounting it on every switch back is
      the cost interface-standards.md measures for arriving on this route.
    -->
    <AvailabilityRegion
      v-show="quickConfig.viewMode === 'files'"
      requires="moonraker"
      class="machine-availability"
    >
      <div
        class="machine-workspace"
        :class="{
          'machine-workspace--editor-open': machineFiles.currentFile,
          'machine-workspace--fullscreen': isEditorFullscreen,
          'machine-workspace--explorer-unpinned': explorerAutoHides,
          'machine-workspace--explorer-peek': explorerPeekOpen,
          'machine-workspace--mobile-explorer': mobileExplorerOpen,
        }"
        :data-pending="
          machineFiles.isDirectoryLoading || machineFiles.isEditorLoading || machineFiles.isMutating
        "
      >
        <section class="machine-editor-pane" :aria-label="t('configuration.editor.title')">
          <ConfigurationTabWell
            v-if="hasTabs"
            :pinned="pinnedTabFiles"
            :tabs="unpinnedTabs"
            :active-path="machineFiles.currentFile?.path ?? null"
            :dirty-paths="machineFiles.unsavedFilePaths"
            :root="machineFiles.currentRoot"
            @activate="activateTab"
            @keep="machineFiles.keepTab"
            @close="closeTab"
            @pin="pinTab"
            @unpin="unpinTab"
            @menu="openTabMenu"
          >
            <template #tools>
              <!--
                Only the viewer's own chrome stays beside the tabs. The file's
                actions carry labels, which the well's `xs` height cannot hold,
                so they live in the command bar at the foot of this card.
              -->
              <div v-if="machineFiles.currentFile" class="machine-editor-actions">
                <AppButton
                  v-if="!isCurrentFilePreview"
                  variant="quiet"
                  size="xs"
                  icon-only
                  icon="help"
                  aria-haspopup="dialog"
                  :aria-label="t('configuration.shortcuts.open')"
                  :title="t('configuration.shortcuts.open')"
                  @click="shortcutsOpen = true"
                />
                <AppButton
                  variant="quiet"
                  size="xs"
                  icon-only
                  icon="fullscreen"
                  :aria-pressed="isEditorFullscreen"
                  :aria-label="t('configuration.editor.fullscreen')"
                  :title="t('configuration.editor.fullscreen')"
                  @click="toggleFullscreen"
                />
              </div>
            </template>
          </ConfigurationTabWell>

          <div
            v-if="machineFiles.lastError || machineFiles.notice"
            class="machine-feedback selectable"
            role="status"
            :data-error="Boolean(machineFiles.lastError)"
          >
            {{
              t(
                machineFiles.lastError
                  ? `configuration.errors.${machineFiles.lastError}`
                  : `configuration.notices.${machineFiles.notice}`,
              )
            }}
          </div>

          <template v-if="machineFiles.currentFile">
            <!--
              The tab above already names the file, so the viewer needs no
              visible title; this keeps the region's heading for assistive
              technology.
            -->
            <h2 class="sr-only">{{ machineFiles.currentFile.name }}</h2>
            <div class="machine-editor-grid">
              <ImageViewer
                v-if="isCurrentFileImage && machineFiles.currentImageUrl"
                :src="machineFiles.currentImageUrl"
                :alt="t('configuration.editor.imageAlt', { name: machineFiles.currentFile.name })"
              />
              <HtmlFileViewer
                v-else-if="isCurrentFileHtml && machineFiles.currentHtmlDocument !== null"
                :content="machineFiles.currentHtmlDocument"
                :title="
                  t('configuration.editor.htmlTitle', { name: machineFiles.currentFile.name })
                "
              />
              <MachineCodeEditor
                v-else
                ref="codeEditor"
                v-model="machineFiles.editorContent"
                :class="{ 'machine-code-editor--link-modifier': isLinkModifierHeld }"
                :data-pending="machineFiles.isEditorLoading || machineFiles.isMutating"
                :read-only="currentFileReadOnly"
                :formats-klipper-config="highlightsSyntax"
                :indent-width="indentWidth"
                :changes="lineChanges"
                :search-query="editorSearchQuery"
                :content-label="
                  t('configuration.editor.contentLabel', { name: machineFiles.currentFile.name })
                "
                :labels="editorLabels"
                :describe-include="describeInclude"
                :include-generation="includeGeneration"
                :commands="editorCommands"
                @cursor-line="currentEditorLine = $event"
                @open-include="openIncludeTarget"
                @context-menu="handleEditorContextMenu"
              />

              <aside
                v-if="!isCurrentFilePreview && fileStructure.length > 0"
                class="machine-structure"
                :class="{ 'machine-structure--expanded': structureExpanded }"
                :aria-label="t('configuration.structure.title')"
              >
                <header>
                  <AppButton
                    variant="quiet"
                    size="sm"
                    start
                    :aria-expanded="structureExpanded"
                    aria-controls="machine-file-structure"
                    :aria-label="
                      t(
                        structureExpanded
                          ? 'configuration.structure.collapse'
                          : 'configuration.structure.expand',
                      )
                    "
                    :title="
                      t(
                        structureExpanded
                          ? 'configuration.structure.collapse'
                          : 'configuration.structure.expand',
                      )
                    "
                    @click="structureExpanded = !structureExpanded"
                  >
                    <AppIcon
                      :name="structureExpanded ? 'sidebarCollapse' : 'sidebarExpand'"
                      class="size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{{ t('configuration.structure.title') }}</span>
                  </AppButton>
                </header>
                <!-- Mounted on expand, not merely hidden: the outline is one
                     button per section, and a collapsed panel should not be
                     paying for a list nobody has asked to see. -->
                <nav v-if="structureExpanded" id="machine-file-structure">
                  <AppButton
                    v-for="section in fileStructure"
                    :key="`${section.line}:${section.name}`"
                    variant="quiet"
                    size="sm"
                    start
                    on-soft
                    @click="goToLine(section.line)"
                  >
                    <span>{{ section.name }}</span>
                    <span class="font-mono text-[0.65rem] text-muted">{{ section.line }}</span>
                  </AppButton>
                </nav>
              </aside>
            </div>
          </template>

          <div v-else class="machine-editor-empty">
            <div class="machine-editor-empty__icon">
              <AppIcon name="fileCode" class="size-8" aria-hidden="true" />
            </div>
            <h2 class="mt-5 text-section-title">
              {{ t('configuration.editor.emptyTitle') }}
            </h2>
          </div>

          <!--
            Inside the viewer card, so fullscreen keeps it, and present with
            nothing open: closing a tab keeps its buffer, so unsaved files can
            outlive every tab and the menu is how they are still reached.
          -->
          <footer class="machine-command-bar">
            <p class="machine-command-bar__state">
              <span v-if="currentFileReadOnly" class="machine-readonly-mark">{{
                t('configuration.editor.readOnly')
              }}</span>
              <span
                v-else-if="machineFiles.currentFile && machineFiles.isDirty"
                class="machine-dirty-mark"
                >{{ t('configuration.editor.unsaved') }}</span
              >
              <span v-if="otherUnsavedCount > 0" class="machine-command-bar__count">{{
                t(
                  machineFiles.currentFile
                    ? 'configuration.editor.otherUnsaved'
                    : 'configuration.editor.filesUnsaved',
                  { count: otherUnsavedCount },
                )
              }}</span>
            </p>
            <div
              class="machine-command-bar__actions"
              role="group"
              :aria-label="t('configuration.editor.actions')"
            >
              <template v-if="machineFiles.currentFile && !isCurrentFilePreview">
                <AppButton
                  variant="primary"
                  size="sm"
                  icon="save"
                  :label="t('configuration.editor.save')"
                  :disabled="!canSave || !machineFiles.isDirty"
                  :pending="machineFiles.isMutating && machineFiles.isDirty"
                  @click="save(false)"
                />
                <AppButton
                  size="sm"
                  icon="saveRestart"
                  :label="t('configuration.editor.saveRestart')"
                  :disabled="!canSave || !machineFiles.isDirty || !klipperAvailability.isAvailable"
                  @click="save(true)"
                />
                <AppButton
                  variant="danger-quiet"
                  size="sm"
                  icon="undo"
                  class="machine-command-bar__discard"
                  :label="t('configuration.editor.discard')"
                  :disabled="!machineFiles.isDirty"
                  @click="requestDiscardChanges"
                />
              </template>
              <HeaderMenu
                :label="t('configuration.editor.moreActions')"
                align="end"
                placement="above"
                trigger-variant="quiet"
                trigger-size="sm"
                trigger-icon-only
              >
                <template #trigger>
                  <AppIcon name="more" aria-hidden="true" />
                </template>
                <template #default="{ close }">
                  <!-- Only shown where the bar is too narrow to hold it; see components.css. -->
                  <template v-if="machineFiles.currentFile && !isCurrentFilePreview">
                    <AppButton
                      variant="danger-quiet"
                      size="sm"
                      start
                      block
                      class="machine-command-bar__menu-discard"
                      :label="t('configuration.editor.discard')"
                      :disabled="!machineFiles.isDirty"
                      @click="
                        () => {
                          close()
                          requestDiscardChanges()
                        }
                      "
                    />
                    <p
                      class="header-menu__divider machine-command-bar__menu-divider"
                      role="separator"
                    ></p>
                  </template>
                  <p class="header-menu__section-title">
                    {{ t('configuration.editor.allUnsaved') }}
                  </p>
                  <AppButton
                    variant="quiet"
                    size="sm"
                    start
                    block
                    :label="t('configuration.actions.saveAll')"
                    :disabled="!canSaveAll"
                    @click="
                      () => {
                        close()
                        requestSaveAll()
                      }
                    "
                  />
                  <AppButton
                    variant="danger-quiet"
                    size="sm"
                    start
                    block
                    :label="t('configuration.actions.discardAll')"
                    :disabled="!machineFiles.hasUnsavedFiles"
                    @click="
                      () => {
                        close()
                        requestDiscardAll()
                      }
                    "
                  />
                </template>
              </HeaderMenu>
            </div>
          </footer>
        </section>

        <aside
          ref="explorerPane"
          class="machine-explorer"
          :aria-label="t('configuration.files.title')"
          @pointerenter="explorerPeek.onPanelPointerEnter"
          @pointerleave="explorerPeek.onPointerLeave"
          @focusin="explorerPeek.onFocusIn"
          @focusout="explorerPeek.onFocusOut"
        >
          <header class="machine-pane-header">
            <div class="machine-pane-header__identity">
              <p class="machine-pane-storage">
                {{ t('units.storageFree', { value: formatSize(machineFiles.diskUsage.free) }) }}
              </p>
            </div>
            <div class="machine-pane-header-actions">
              <AppButton
                size="xs"
                icon-only
                :disabled="!moonrakerAvailability.isAvailable"
                :aria-label="t('configuration.actions.refresh')"
                :title="t('configuration.actions.refresh')"
                @click="machineFiles.refreshDirectory"
              >
                <!--
                  Not gated on isDirectoryLoading: that flips true→false on every
                  navigation too, not just a manual refresh, which disabled the
                  button (and dropped its hover highlight, since disabled opts
                  out of :hover) for a blink each time. The store's generation
                  counters already make an overlapping click harmless.
                -->
                <AppIcon name="refresh" class="size-4" aria-hidden="true" />
              </AppButton>
              <AppButton
                size="xs"
                icon-only
                icon="collapse"
                :disabled="machineFiles.expandedDirectories.size === 0"
                :aria-label="t('configuration.actions.collapseAll')"
                :title="t('configuration.actions.collapseAll')"
                @click="machineFiles.collapseAllDirectories"
              />
              <HeaderMenu :label="t('configuration.settings.open')" align="end">
                <template #trigger>
                  <AppIcon name="settings" class="size-4" aria-hidden="true" />
                </template>
                <template #default>
                  <p class="header-menu__section-title">
                    {{ t('configuration.settings.visibility') }}
                  </p>
                  <label class="check-row check-row--block header-menu__toggle">
                    <input
                      type="checkbox"
                      :checked="showHiddenFiles"
                      @change="setShowHiddenFiles(($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ t('configuration.settings.showHiddenFiles.label') }}</span>
                  </label>
                  <label
                    class="check-row check-row--block header-menu__toggle"
                    :title="t('configuration.settings.showBackupFiles.hint')"
                  >
                    <input
                      type="checkbox"
                      :checked="showBackupFiles"
                      @change="setShowBackupFiles(($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ t('configuration.settings.showBackupFiles.label') }}</span>
                  </label>
                  <label class="check-row check-row--block header-menu__toggle">
                    <input
                      type="checkbox"
                      :checked="showReadOnlyFiles"
                      @change="setShowReadOnlyFiles(($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ t('configuration.settings.showReadOnlyFiles.label') }}</span>
                  </label>
                  <p class="header-menu__section-title">
                    {{ t('configuration.settings.search') }}
                  </p>
                  <label
                    class="check-row check-row--block header-menu__toggle"
                    :title="t('configuration.settings.searchInFileContents.hint')"
                  >
                    <input
                      type="checkbox"
                      :checked="searchInFileContents"
                      @change="setSearchInFileContents(($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ t('configuration.settings.searchInFileContents.label') }}</span>
                  </label>
                  <p class="header-menu__section-title">
                    {{ t('configuration.settings.density') }}
                  </p>
                  <label
                    class="check-row check-row--block header-menu__toggle"
                    :title="t('configuration.settings.compactRows.hint')"
                  >
                    <input
                      type="checkbox"
                      :checked="compactRows"
                      @change="setCompactRows(($event.target as HTMLInputElement).checked)"
                    />
                    <span>{{ t('configuration.settings.compactRows.label') }}</span>
                  </label>
                  <p class="header-menu__section-title">
                    {{ t('configuration.settings.sort') }}
                  </p>
                  <label
                    v-for="key in sortKeys"
                    :key="key"
                    class="check-row check-row--block header-menu__toggle"
                  >
                    <input
                      type="radio"
                      name="machine-file-sort"
                      :checked="sortKey === key"
                      @change="setSortKey(key)"
                    />
                    <span>{{ t(`configuration.settings.sortBy.${key}`) }}</span>
                  </label>
                </template>
              </HeaderMenu>
            </div>
          </header>

          <div class="machine-file-controls">
            <label class="field field--sm field--on-soft machine-search">
              <AppIcon name="fileSearch" class="size-4" aria-hidden="true" />
              <span class="sr-only">{{ t('configuration.files.search') }}</span>
              <input
                v-model="search"
                type="search"
                :placeholder="t('configuration.files.search')"
                autocomplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
              />
            </label>

            <div class="machine-toolbar">
              <AppButton
                size="sm"
                icon-only
                on-soft
                icon="filePlus"
                :disabled="!canMutate"
                :aria-label="t('configuration.actions.newFile')"
                :title="t('configuration.actions.newFile')"
                @click="createFile"
              />
              <AppButton
                size="sm"
                icon-only
                on-soft
                icon="folderPlus"
                :disabled="!canMutate"
                :aria-label="t('configuration.actions.newFolder')"
                :title="t('configuration.actions.newFolder')"
                @click="createDirectory"
              />
              <AppButton
                size="sm"
                icon-only
                on-soft
                icon="fileUpload"
                :disabled="!canMutate"
                :aria-label="t('configuration.actions.upload')"
                :title="t('configuration.actions.upload')"
                @click="selectUpload"
              />
              <input
                ref="uploadInput"
                class="sr-only"
                type="file"
                multiple
                tabindex="-1"
                aria-hidden="true"
                @change="uploadSelected"
              />
            </div>
          </div>

          <p v-if="machineFiles.isSearchingFileContents" class="hint machine-search-hint">
            {{ t('configuration.files.searchingContents') }}
          </p>

          <ul
            ref="explorerList"
            class="machine-file-list machine-file-tree"
            :class="{
              'machine-file-list--drop-active': isExternalDropZoneActive,
              'machine-file-list--compact': compactRows,
            }"
            role="tree"
            :aria-label="t('configuration.files.contents')"
            :aria-busy="machineFiles.isDirectoryLoading || undefined"
            @dragenter="onExternalDragEnter"
            @dragover="onExternalDragOver"
            @dragleave="onExternalDragLeave"
            @drop="onExternalDrop"
          >
            <li v-for="(row, index) in explorerRows" :key="row.entry.path" role="none">
              <button
                type="button"
                role="treeitem"
                class="file-select selection-row machine-file-row machine-tree-row"
                :class="{
                  'selection-row--selected': isOpenFile(row.entry),
                  'machine-tree-row--root': row.level === 0 && !isSearching,
                }"
                :style="{ '--tree-level': row.level }"
                :aria-level="row.level + 1"
                :aria-expanded="
                  row.entry.kind === 'directory' && !isSearching ? row.expanded : undefined
                "
                :aria-selected="isOpenFile(row.entry)"
                :aria-current="isOpenFile(row.entry) ? 'true' : undefined"
                :tabindex="treeTabStop === row.entry.path ? 0 : -1"
                :data-tree-path="row.entry.path"
                :disabled="!moonrakerAvailability.isAvailable"
                :draggable="isWritable(row.entry) && row.entry.kind === 'file'"
                :data-dragging="
                  draggingEntry && entryKey(draggingEntry) === entryKey(row.entry)
                    ? 'true'
                    : undefined
                "
                :data-drop-target="dropTargetKey === entryKey(row.entry) ? 'true' : undefined"
                :data-context-open="
                  contextMenu && entryKey(contextMenu.entry) === entryKey(row.entry)
                    ? 'true'
                    : undefined
                "
                @click="chooseRow(row)"
                @dblclick="keepRow(row)"
                @keydown="onTreeKeydown($event, index)"
                @focus="treeFocusPath = row.entry.path"
                @contextmenu.prevent="openRowContextMenu($event, row)"
                @dragstart="onDragStart($event, row.entry)"
                @dragend="onDragEnd"
                @dragenter="onDragOver($event, row.entry)"
                @dragover="onDragOver($event, row.entry)"
                @dragleave="onDragLeave($event, row.entry)"
                @drop="onDrop($event, row.entry)"
              >
                <span class="machine-file-name">
                  <AppIcon
                    v-if="row.entry.kind === 'directory' && row.level > 0 && !isSearching"
                    :name="row.expanded ? 'down' : 'right'"
                    class="machine-tree-chevron"
                    aria-hidden="true"
                  />
                  <span v-else class="machine-tree-chevron" aria-hidden="true"></span>
                  <!--
                    The tooltip lives on this wrapper, not the AppIcon svg: an
                    unfilled stroke icon only paints a thin outline, and SVG
                    shapes hit-test against painted pixels by default, so
                    hovering the icon's own empty middle would never trigger it.
                  -->
                  <span
                    class="machine-file-icon-hover"
                    :title="
                      isEntryIncluded(row.entry)
                        ? t('configuration.files.includedInPrimaryConfig')
                        : undefined
                    "
                  >
                    <AppIcon
                      :name="
                        row.level === 0 && !isSearching
                          ? 'folderCode'
                          : row.entry.kind === 'directory'
                            ? 'folder'
                            : fileIcon(row.entry.name)
                      "
                      :class="[
                        'size-5 shrink-0',
                        {
                          'machine-file-icon--folder': row.entry.kind === 'directory',
                          'machine-file-icon--included': isEntryIncluded(row.entry),
                          'machine-file-icon--dirty': isEntryDirty(row.entry),
                        },
                      ]"
                      aria-hidden="true"
                    />
                  </span>
                  <span class="machine-file-name__details">
                    <span
                      class="machine-file-name__label"
                      :class="{ 'machine-file-name__label--dirty': isEntryDirty(row.entry) }"
                      :title="row.entry.name"
                      >{{ row.entry.name }}</span
                    >
                    <span v-if="isSearching && row.parentPath" class="machine-file-name__folder">{{
                      row.parentPath
                    }}</span>
                    <span v-if="isEntryDirty(row.entry)" class="machine-dirty-mark">{{
                      t('configuration.editor.unsaved')
                    }}</span>
                    <!--
                      Marked per row only where read-only is the exception. In a
                      wholly read-only root every row would carry the same mark,
                      which states one fact as many times as there are files —
                      the selected tab already says it once.
                    -->
                    <span
                      v-if="
                        machineFiles.isRootEditable &&
                        row.level > 0 &&
                        !row.entry.permissions.includes('w')
                      "
                      class="machine-readonly-mark"
                    >
                      {{ t('configuration.files.readOnlyShort') }}
                    </span>
                    <span
                      v-if="row.entry.kind === 'file' && isEntryPinned(row.entry)"
                      class="machine-tree-pin"
                      :title="t('configuration.files.pinned')"
                    >
                      <AppIcon name="filePin" class="size-4" aria-hidden="true" />
                      <span class="sr-only">{{ t('configuration.files.pinned') }}</span>
                    </span>
                  </span>
                </span>
              </button>
            </li>

            <li
              v-if="
                !machineFiles.isDirectoryLoading && explorerRows.length <= (isSearching ? 0 : 1)
              "
              class="machine-empty-state"
              role="none"
            >
              <AppIcon name="fileSearch" class="size-6" aria-hidden="true" />
              <p class="font-bold">
                {{ t(search ? 'configuration.files.noResults' : 'configuration.files.empty') }}
              </p>
            </li>
          </ul>

          <!--
            A band of its own that always holds its height: it describes the
            row last focused or clicked, else the open file, else the folder
            new files land in, so its text changes in place.
          -->
          <footer class="machine-explorer-footer">
            <template v-if="footerEntry">
              <span class="machine-explorer-footer__name">{{ footerEntry.name }}</span>
              <span class="machine-explorer-footer__meta">{{
                footerEntry.kind === 'directory'
                  ? t('configuration.files.folder')
                  : formatSize(footerEntry.size)
              }}</span>
              <span v-if="footerEntry.modified > 0" class="machine-explorer-footer__meta">{{
                formatModified(footerEntry.modified)
              }}</span>
            </template>
            <span v-else class="machine-explorer-footer__name"
              >/{{ machineFiles.currentRoot }}/{{ machineFiles.currentPath }}</span
            >
          </footer>
        </aside>

        <!--
          Visual Studio's tool-window strip: outside both cards, so the pin
          exists whether or not a tab does and whether or not the explorer is
          out, and the roots cost the tree none of its height. A file dragged
          in from the desktop over it brings an auto-hidden explorer out to
          drop onto.
        -->
        <div
          ref="sideStrip"
          class="machine-side-strip"
          @pointerenter="explorerPeek.onStripPointerEnter"
          @pointerleave="explorerPeek.onPointerLeave"
          @focusin="explorerPeek.onFocusIn"
          @focusout="explorerPeek.onFocusOut"
          @dragenter="explorerPeek.show"
        >
          <!--
            The icon is the state, as Visual Studio's pushpin is: upright while
            docked, on its side while auto-hidden. No pressed state, so no
            accent either; the name says what a press will do.
          -->
          <AppButton
            v-if="!singlePane"
            ref="explorerPinButton"
            variant="quiet"
            size="xs"
            icon-only
            :icon="explorerHidden ? 'pushpinSideways' : 'pushpin'"
            class="machine-explorer-pin"
            :aria-label="
              t(explorerHidden ? 'configuration.explorer.pin' : 'configuration.explorer.unpin')
            "
            :title="
              t(explorerHidden ? 'configuration.explorer.pin' : 'configuration.explorer.unpin')
            "
            @click="toggleExplorerPin"
          />
          <div class="machine-root-tabs" role="group" :aria-label="t('configuration.roots.label')">
            <button
              v-for="root in fileRoots"
              :key="root"
              type="button"
              class="tab-select tab-select--vertical"
              :aria-pressed="machineFiles.currentRoot === root"
              :disabled="!moonrakerAvailability.isAvailable"
              @click="chooseRoot(root)"
            >
              {{ t(`configuration.roots.${root}`) }}
            </button>
          </div>
        </div>
      </div>
    </AvailabilityRegion>

    <AvailabilityRegion
      v-if="quickConfig.viewMode === 'quickConfig'"
      requires="moonraker"
      class="machine-availability"
    >
      <QuickConfigView @open-location="openQuickConfigLocation" />
    </AvailabilityRegion>

    <ConfirmDialog
      :open="pendingDiscard"
      :title="t('configuration.editor.discardTitle')"
      :description="
        t('configuration.editor.discardDescription', { name: machineFiles.currentFile?.name ?? '' })
      "
      :confirm-label="t('configuration.editor.discardConfirm')"
      tone="danger"
      show-skip-option
      @confirm="confirmDiscardChanges"
      @cancel="pendingDiscard = false"
      @skip="confirmations.setSkip('discardFileChanges', true)"
    />

    <ConfirmDialog
      :open="pendingSaveAll"
      :title="t('configuration.saveAll.title')"
      :description="t('configuration.saveAll.description')"
      :items="machineFiles.unsavedFilePaths"
      :confirm-label="t('configuration.saveAll.confirm')"
      show-skip-option
      @confirm="confirmSaveAll"
      @cancel="pendingSaveAll = false"
      @skip="confirmations.setSkip('saveAllFiles', true)"
    />

    <ConfirmDialog
      :open="pendingDiscardAll"
      :title="t('configuration.discardAll.title')"
      :description="t('configuration.discardAll.description')"
      :items="machineFiles.unsavedFilePaths"
      :confirm-label="t('configuration.discardAll.confirm')"
      tone="danger"
      show-skip-option
      @confirm="confirmDiscardAll"
      @cancel="pendingDiscardAll = false"
      @skip="confirmations.setSkip('discardAllFiles', true)"
    />

    <ConfirmDialog
      :open="pendingRestartWithUnsaved"
      :title="t('configuration.editor.saveAllRestartTitle')"
      :description="t('configuration.editor.saveAllRestartDescription')"
      :items="machineFiles.unsavedFilePaths"
      :confirm-label="t('configuration.editor.saveRestartConfirm')"
      show-skip-option
      @confirm="confirmSaveAllAndRestart"
      @cancel="pendingRestartWithUnsaved = false"
      @skip="confirmations.setSkip('saveAllAndRestart', true)"
    />

    <!--
      Stands in for the browser's own drag image, which onDragStart suppresses
      with a transparent pixel. Teleported to the body so it is never clipped
      by the explorer's scroll container, and positioned with a transform
      rather than left/top so tracking the pointer never triggers layout.
      The move icon appears only once `dropTargetKey` names a folder the file
      can actually land on — the same condition that already draws that row's
      drop-target ring — so the ghost never promises a move that canDropOn
      would refuse.
    -->
    <Teleport to="body">
      <div
        v-if="draggingEntry && dragGhostPosition"
        class="machine-drag-ghost"
        :style="{
          transform: `translate3d(${dragGhostPosition.x + 14}px, ${dragGhostPosition.y + 18}px, 0)`,
        }"
        aria-hidden="true"
      >
        <AppIcon v-if="dropTargetKey" name="folderMoveTo" class="size-4 shrink-0" />
        <span class="machine-drag-ghost__name">{{ draggingEntry.name }}</span>
      </div>
    </Teleport>

    <FileContextMenu
      v-if="contextMenu"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :label="t('configuration.contextMenu.label', { name: contextMenu.entry.name })"
      @close="closeContextMenu"
    >
      <AppButton
        variant="quiet"
        size="sm"
        start
        block
        icon="rename"
        :label="t('configuration.contextMenu.rename')"
        :disabled="!isWritable(contextMenu.entry)"
        @click="renameEntry(contextMenu.entry)"
      />
      <AppButton
        v-if="contextMenu.entry.kind === 'file'"
        variant="quiet"
        size="sm"
        start
        block
        :icon="isEntryPinned(contextMenu.entry) ? 'filePinSlash' : 'filePin'"
        :label="
          t(
            isEntryPinned(contextMenu.entry)
              ? 'configuration.contextMenu.unpin'
              : 'configuration.contextMenu.pin',
          )
        "
        @click="togglePinEntry(contextMenu.entry)"
      />
      <AppButton
        v-if="contextMenu.entry.kind === 'file'"
        variant="quiet"
        size="sm"
        start
        block
        icon="download"
        :label="t('configuration.contextMenu.download')"
        @click="downloadEntry(contextMenu.entry)"
      />
      <AppButton
        v-if="contextMenu.includable"
        variant="quiet"
        size="sm"
        start
        block
        :icon="contextMenu.isIncluded ? 'close' : 'add'"
        :label="
          t(
            contextMenu.isIncluded
              ? 'configuration.contextMenu.removeFromPrinterConfig'
              : 'configuration.contextMenu.addToPrinterConfig',
          )
        "
        :disabled="!canEditPrimaryConfig"
        @click="toggleIncludeInPrinterConfig(contextMenu.entry, contextMenu.isIncluded)"
      />
      <p class="header-menu__divider" role="separator"></p>
      <AppButton
        variant="danger-quiet"
        size="sm"
        start
        block
        icon="trash"
        :label="t('configuration.contextMenu.delete')"
        :disabled="!isWritable(contextMenu.entry)"
        @click="requestDeleteEntry(contextMenu.entry)"
      />
    </FileContextMenu>

    <FileContextMenu
      v-if="tabMenu"
      :x="tabMenu.x"
      :y="tabMenu.y"
      :label="t('configuration.tabs.menuLabel', { name: tabFile(tabMenu.path)?.name ?? '' })"
      @close="closeTabMenu"
    >
      <AppButton
        variant="quiet"
        size="sm"
        start
        block
        icon="close"
        :label="t('configuration.tabs.closeTab')"
        @click="tabMenuClose(tabMenu.path)"
      />
      <AppButton
        variant="quiet"
        size="sm"
        start
        block
        :label="t('configuration.tabs.closeOthers')"
        :disabled="unpinnedTabs.filter((tab) => tab.file.path !== tabMenu?.path).length === 0"
        @click="tabMenuCloseOthers(tabMenu.path)"
      />
      <AppButton
        variant="quiet"
        size="sm"
        start
        block
        :label="t('configuration.tabs.closeAll')"
        :disabled="unpinnedTabs.length === 0"
        @click="tabMenuCloseAll"
      />
      <p class="header-menu__divider" role="separator"></p>
      <AppButton
        variant="quiet"
        size="sm"
        start
        block
        :icon="tabMenuIsPinned(tabMenu.path) ? 'filePinSlash' : 'filePin'"
        :label="
          t(
            tabMenuIsPinned(tabMenu.path)
              ? 'configuration.contextMenu.unpin'
              : 'configuration.contextMenu.pin',
          )
        "
        @click="tabMenuTogglePin(tabMenu.path)"
      />
      <AppButton
        variant="quiet"
        size="sm"
        start
        block
        icon="folder"
        :label="t('configuration.tabs.reveal')"
        @click="tabMenuReveal(tabMenu.path)"
      />
    </FileContextMenu>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('configuration.deleteEntry.title', { name: pendingDelete?.name ?? '' })"
      :description="
        pendingDelete
          ? t(
              pendingDelete.kind === 'directory'
                ? 'configuration.deleteEntry.folder'
                : 'configuration.deleteEntry.file',
              { name: pendingDelete.name },
            )
          : undefined
      "
      :confirm-label="t('configuration.deleteEntry.confirm')"
      tone="danger"
      show-skip-option
      @cancel="pendingDelete = null"
      @confirm="confirmDeleteEntry"
      @skip="confirmations.setSkip('deleteFileEntry', true)"
    />

    <dialog
      ref="moveDialog"
      class="confirm-dialog"
      aria-labelledby="machine-move-dialog-title"
      aria-describedby="machine-move-dialog-description"
      @cancel="cancelPendingMove"
    >
      <h2 id="machine-move-dialog-title" class="text-dialog-title">
        {{ t('configuration.move.includeTitle') }}
      </h2>
      <p
        v-if="pendingMove"
        id="machine-move-dialog-description"
        class="mt-2 text-sm leading-6 text-muted"
      >
        <span class="block">{{ t('configuration.move.includeQuestion') }}</span>
        <code class="mt-1 block break-all font-mono text-xs text-primary">{{
          t('configuration.move.includeChange', {
            from: `[include ${pendingMove.rewrite.from}]`,
            to: `[include ${pendingMove.rewrite.to}]`,
          })
        }}</code>
        <span class="mt-1 block">{{ t('configuration.move.includeSave') }}</span>
      </p>
      <div class="machine-move-dialog__actions">
        <AppButton
          variant="primary"
          :label="t('configuration.move.includeConfirm')"
          @click="confirmMoveWithInclude"
        />
        <AppButton
          size="sm"
          :label="t('configuration.move.includeSkip')"
          @click="confirmMoveWithoutInclude"
        />
        <AppButton
          size="sm"
          :label="t('configuration.move.includeCancel')"
          @click="cancelPendingMove()"
        />
      </div>
    </dialog>

    <ConfirmDialog
      :open="pendingFileOpen !== null"
      :title="
        t(
          pendingFileOpen?.reason === 'unsupported'
            ? 'configuration.editor.unsupportedTitle'
            : 'configuration.editor.largeFileTitle',
        )
      "
      :description="
        pendingFileOpen
          ? t(
              pendingFileOpen.reason === 'unsupported'
                ? 'configuration.editor.unsupportedDescription'
                : 'configuration.editor.largeFileDescription',
              { name: pendingFileOpen.name, size: pendingFileOpen.sizeLabel },
            )
          : undefined
      "
      :confirm-label="t('configuration.editor.openAnyway')"
      show-skip-option
      @confirm="confirmPendingFileOpen"
      @cancel="cancelPendingFileOpen"
      @skip="confirmations.setSkip('openUnsupportedFile', true)"
    />

    <ConfirmDialog
      :open="pendingIncludeCreate !== null"
      :title="t('configuration.editor.createIncludeTitle')"
      :description="
        pendingIncludeCreate
          ? t(
              pendingIncludeCreate.directoryMissing
                ? 'configuration.editor.createIncludeWithFolderDescription'
                : 'configuration.editor.createIncludeDescription',
              { path: pendingIncludeCreate.targetPath, directory: pendingIncludeCreate.directory },
            )
          : undefined
      "
      :confirm-label="
        t(
          pendingIncludeCreate?.directoryMissing
            ? 'configuration.editor.createIncludeWithFolderConfirm'
            : 'configuration.editor.createIncludeConfirm',
        )
      "
      show-skip-option
      @confirm="confirmCreateIncludeTarget"
      @cancel="cancelCreateIncludeTarget"
      @skip="confirmations.setSkip('createIncludeTarget', true)"
    />

    <PromptDialog
      :open="pendingCreateFile"
      :title="t('configuration.actions.newFilePrompt')"
      :label="t('configuration.prompts.nameLabel')"
      :initial-value="t('configuration.actions.newFileDefault')"
      :confirm-label="t('configuration.prompts.create')"
      :validate="requireEntryName"
      @confirm="confirmCreateFile"
      @cancel="pendingCreateFile = false"
    />

    <PromptDialog
      :open="pendingCreateDirectory"
      :title="t('configuration.actions.newFolderPrompt')"
      :label="t('configuration.prompts.nameLabel')"
      :confirm-label="t('configuration.prompts.create')"
      :validate="requireEntryName"
      @confirm="confirmCreateDirectory"
      @cancel="pendingCreateDirectory = false"
    />

    <PromptDialog
      :open="pendingRename !== null"
      :title="
        t(
          pendingRename?.kind === 'directory'
            ? 'configuration.rename.promptFolder'
            : 'configuration.rename.promptFile',
        )
      "
      :label="t('configuration.prompts.nameLabel')"
      :initial-value="pendingRename?.name"
      :confirm-label="t('configuration.rename.confirm')"
      :validate="validateRename"
      @confirm="confirmRename"
      @cancel="pendingRename = null"
    />

    <EditorShortcutsDialog :open="shortcutsOpen" @close="shortcutsOpen = false" />

    <EditorContextMenu
      v-if="editorMenu && machineFiles.currentFile"
      :x="editorMenu.x"
      :y="editorMenu.y"
      :context="editorMenu.context"
      :path="machineFiles.currentFile.path"
      :lines="editorLines"
      :read-only="currentFileReadOnly"
      :selection="editorMenu.selection"
      :files="editorMenuFiles"
      @close="closeEditorMenu"
      @action="runEditorMenuAction"
    />

    <QuickConfigOptionDialog
      :open="editorPickerSection !== null"
      :catalogue="quickConfig.catalogue"
      :pins="quickConfig.pins"
      :initial-section="editorPickerSection"
      @save="saveEditorPickerCard"
      @cancel="editorPickerSection = null"
    />

    <PromptDialog
      :open="pendingGoToLine"
      :title="t('configuration.editorMenu.goToLineTitle')"
      :label="t('configuration.editorMenu.goToLineLabel', { count: editorLines.length })"
      :initial-value="String(currentEditorLine)"
      :confirm-label="t('configuration.editorMenu.goToLineConfirm')"
      :validate="validateLineNumber"
      @confirm="confirmGoToLine"
      @cancel="pendingGoToLine = false"
    />
  </section>
</template>
