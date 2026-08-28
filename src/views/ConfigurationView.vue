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
import FileContextMenu from '@/components/machine/FileContextMenu.vue'
import HtmlFileViewer from '@/components/machine/HtmlFileViewer.vue'
import { useAvailability } from '@/composables/useAvailability'
import { useConfigFileHistory } from '@/composables/useConfigFileHistory'
import { useEditorIndent } from '@/composables/useEditorIndent'
import { useMachineFilesSettings } from '@/composables/useMachineFilesSettings'
import {
  codeWindow,
  DEFAULT_CODE_LINE_HEIGHT,
  EDITOR_DEFERRED_MOUNT_BYTES,
  lineNumberAt,
} from '@/features/machine/codeWindow'
import { classifyFileKind, isLargeFile } from '@/features/machine/fileKind'
import { continuationIndent, softTabInsertion } from '@/features/machine/indent'
import {
  duplicateSelectedLines,
  indentSelection,
  moveSelectedLines,
  outdentSelection,
  reindentDocument,
  toggleComment,
  type LineEdit,
} from '@/features/machine/lineEdit'
import { fileIcon } from '@/features/machine/fileIcons'
import {
  isIncludableConfigPath,
  resolvableIncludeTarget,
  type IncludeRewrite,
} from '@/features/machine/includes'
import {
  isConfigSyntaxFile,
  isEmptyPropertyLine,
  tokenizeMachineLine,
  type MachineSyntaxToken,
} from '@/features/machine/syntax'
import {
  isBackupEntryName,
  isHiddenEntryName,
  isReadOnlyEntry,
} from '@/features/machine/visibility'
import { createDateTimeFormatter } from '@/i18n/formats'
import { useConfirmationsStore } from '@/stores/confirmations'
import {
  PRIMARY_CONFIG,
  useMachineFilesStore,
  type MachineFileEntry,
  type MachineFileRoot,
  type OpenMachineFile,
} from '@/stores/machineFiles'

type PendingFileOpenReason = 'unsupported' | 'large'

interface PendingFileOpen {
  run: () => void | Promise<void>
  reason: PendingFileOpenReason
  name: string
  sizeLabel: string
}

type EditorDisplayMode = 'maximized' | 'fullscreen'
type FileSortKey = 'name' | 'size' | 'modified'

interface PendingMove {
  entry: MachineFileEntry
  destination: string
  rewrite: IncludeRewrite
}

const editorDisplayModeStorageKey = 'alabaster.machine.editorDisplayMode'

function initialEditorDisplayMode(): EditorDisplayMode {
  return localStorage.getItem(editorDisplayModeStorageKey) === 'fullscreen'
    ? 'fullscreen'
    : 'maximized'
}

const { locale, t } = useI18n({ useScope: 'global' })
const machineFiles = useMachineFilesStore()
const confirmations = useConfirmationsStore()
const { availability: moonrakerAvailability } = useAvailability('moonraker')
const { availability: klipperAvailability } = useAvailability('klipper')
const {
  showHiddenFiles,
  showBackupFiles,
  showReadOnlyFiles,
  searchInFileContents,
  setShowHiddenFiles,
  setShowBackupFiles,
  setShowReadOnlyFiles,
  setSearchInFileContents,
} = useMachineFilesSettings()
const { indentWidth } = useEditorIndent()
const { fileHistory, fileHistoryIndex, pushFileHistory, setFileHistoryIndex } =
  useConfigFileHistory()
const search = ref('')
const sortKey = ref<FileSortKey>('name')
const sortDirection = ref<'ascending' | 'descending'>('ascending')
const uploadInput = ref<HTMLInputElement | null>(null)
const editor = ref<HTMLTextAreaElement | null>(null)
const lineNumbersContent = ref<HTMLElement | null>(null)
const syntaxContent = ref<HTMLElement | null>(null)
const moveDialog = ref<HTMLDialogElement | null>(null)
const currentEditorLine = ref(1)
const structureExpanded = ref(false)
const shortcutsOpen = ref(false)
interface IncludeHotlink {
  line: number
  start: number
  end: number
  targetPath: string
  /** null until the file index has loaded — neither "dead" nor "confirmed real" yet. */
  exists: boolean | null
  directoryExists: boolean | null
}
const hoveredIncludeLink = ref<IncludeHotlink | null>(null)
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
const explorerResizing = ref(false)
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
const pendingDelete = ref<MachineFileEntry | null>(null)
const pendingCreateFile = ref(false)
const pendingCreateDirectory = ref(false)
const pendingRename = ref<MachineFileEntry | null>(null)
const draggingEntry = ref<MachineFileEntry | null>(null)
const dropTargetKey = ref<string | null>(null)
const pendingMove = ref<PendingMove | null>(null)
// Counts nested dragenter/dragleave pairs across the whole file list, since
// the browser fires both on every descendant the pointer crosses. Only 0 means
// a file dragged in from the desktop is no longer over the list at all.
const externalDragDepth = ref(0)
let explorerResizeTimer: ReturnType<typeof setTimeout> | null = null
let contentSearchTimer: ReturnType<typeof setTimeout> | null = null

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

const filteredEntries = computed(() => {
  const rawQuery = search.value.trim()
  const query = rawQuery.toLocaleLowerCase(locale.value)
  // Only trusted once it actually answers the query on screen — otherwise a
  // still-running or setting-disabled search would keep contributing matches
  // left over from whatever was typed before.
  const contentMatchesReady =
    searchInFileContents.value && machineFiles.contentSearchQuery === rawQuery
  const source = query
    ? machineFiles.searchFiles.filter(
        (entry) =>
          entry.path.toLocaleLowerCase(locale.value).includes(query) ||
          (contentMatchesReady && machineFiles.contentSearchMatches.has(entry.path)),
      )
    : machineFiles.entries
  return [...source.filter(isEntryVisible)].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    const comparison =
      sortKey.value === 'name'
        ? left.name.localeCompare(right.name, locale.value, { numeric: true, sensitivity: 'base' })
        : sortKey.value === 'size'
          ? left.size - right.size
          : left.modified - right.modified
    if (comparison !== 0) return sortDirection.value === 'ascending' ? comparison : -comparison
    return left.name.localeCompare(right.name, locale.value, { numeric: true, sensitivity: 'base' })
  })
})
const pathSegments = computed(() => {
  const segments = machineFiles.currentPath ? machineFiles.currentPath.split('/') : []
  return [
    // The root actually being browsed. Hard-coding `config` here made the trail
    // claim the config root while the listing came from another one.
    { name: machineFiles.currentRoot, path: '' },
    ...segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join('/') })),
  ]
})
const parentPath = computed(() => {
  const segments = machineFiles.currentPath ? machineFiles.currentPath.split('/') : []
  return segments.slice(0, -1).join('/')
})
// The most recently modified file, unless it's already open, in which case the
// next most recent one is the more useful shortcut to offer.
const lastEditedFile = computed<OpenMachineFile | null>(() => {
  const [first, second] = machineFiles.recentFiles
  if (!first) return null
  return first.path === machineFiles.currentFile?.path ? (second ?? null) : first
})
const currentFileReadOnly = computed(
  () => machineFiles.currentFile !== null && !machineFiles.currentFile.permissions.includes('w'),
)
const isEditorFullscreen = computed(
  () => machineFiles.currentFile !== null && editorDisplayMode.value === 'fullscreen',
)
const isExplorerCompact = computed(() => machineFiles.currentFile !== null)
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
const lineNumberCount = computed(() => Math.max(1, editorLines.value.length))
/*
 * Measured rather than taken from main.css's `1.5rem`, because that scales with
 * the root font size and with browser zoom, and every offset below has to agree
 * with where the browser actually put the rows.
 */
const editorLineHeight = ref(DEFAULT_CODE_LINE_HEIGHT)
const editorScrollTop = ref(0)
const editorViewportHeight = ref(0)
/*
 * Whether the editor body — the textarea and the two layers that follow it — is
 * mounted yet, or whether the pane is still showing the bar that stands in for
 * it. A large file's mount is a long, unbreakable piece of work (see
 * EDITOR_DEFERRED_MOUNT_BYTES), and the point of deferring it is that it must
 * not be charged to whatever event asked for it: arriving on the route, or
 * opening the file, has to complete and paint first. The pane's geometry is a
 * grid cell either way, so nothing moves when the body lands.
 */
const editorBodyMounted = ref(true)
/*
 * Whether the bar stood in for this file, which is what makes the body's fade-in
 * earned. A file small enough to mount inside the event that asked for it never
 * waited for anything, and fading it in would be a delay the interface invented
 * rather than one it is reporting.
 */
const editorBodyDeferred = ref(false)
let editorBodyTimer: ReturnType<typeof setTimeout> | null = null
let editorBodyFallback: ReturnType<typeof setTimeout> | null = null
let editorBodyFrame = 0
/*
 * How long the bar may stand in before the body is mounted regardless of whether
 * a frame ever arrived. The frame is the mechanism; this is the guarantee. A
 * client that paints no frames while the page is nominally visible — throttled,
 * occluded, headless — would otherwise sit on the bar forever, and an editor that
 * never appears is a far worse outcome than a reveal that skipped its fade. It is
 * long enough that any browser actually painting wins the race: the frame it is
 * waiting for draws a route change and a bar, not the file.
 */
const editorBodyFallbackMs = 400

function cancelEditorBodyMount(): void {
  if (editorBodyTimer) clearTimeout(editorBodyTimer)
  editorBodyTimer = null
  if (editorBodyFallback) clearTimeout(editorBodyFallback)
  editorBodyFallback = null
  if (editorBodyFrame) cancelAnimationFrame(editorBodyFrame)
  editorBodyFrame = 0
}

function mountEditorBodySoon(): void {
  cancelEditorBodyMount()
  if (machineFiles.editorContent.length <= EDITOR_DEFERRED_MOUNT_BYTES) {
    editorBodyDeferred.value = false
    editorBodyMounted.value = true
    return
  }
  editorBodyDeferred.value = true
  editorBodyMounted.value = false
  const mount = (): void => {
    cancelEditorBodyMount()
    editorBodyMounted.value = true
  }
  /*
   * After the next paint, and a task boundary alone is not that. Deferring into
   * `setTimeout` did separate the mount from the navigation, and measured no
   * better: the browser is free to run both before it paints, so the bar never
   * reached the screen and the navigation still stalled for the whole 240 ms.
   * A frame callback runs immediately before a frame is painted, so a task
   * queued from inside one runs after the bar is actually visible.
   *
   * Nothing here has to keep animating from the main thread once it blocks: the
   * bar's sweep and the route crossfade are both transform and opacity, so the
   * compositor carries them through.
   */
  editorBodyFallback = setTimeout(mount, editorBodyFallbackMs)
  if (typeof requestAnimationFrame !== 'function') return
  editorBodyFrame = requestAnimationFrame(() => {
    editorBodyFrame = 0
    editorBodyTimer = setTimeout(mount)
  })
}
/**
 * The lines the highlight layer and the gutter render: what the viewport shows
 * plus its slack, never the whole file. See `codeWindow` for what a whole file
 * costs and why nothing is lost by not mounting it.
 */
const renderedLineWindow = computed(() =>
  codeWindow(
    editorScrollTop.value,
    editorViewportHeight.value,
    editorLineHeight.value,
    lineNumberCount.value,
  ),
)
/** Height of the unrendered lines above the window, which hold its place. */
const renderedWindowOffset = computed(() => renderedLineWindow.value.start * editorLineHeight.value)
/**
 * Whether the open file is colored at all. Only the config root is, and only the
 * formats the tokenizer actually describes — see `isConfigSyntaxFile` for why
 * coloring anything else both invents structure and costs the most.
 */
const highlightsSyntax = computed(
  () =>
    machineFiles.currentRoot === 'config' &&
    isConfigSyntaxFile(machineFiles.currentFile?.name ?? ''),
)
/**
 * Each rendered row carries its own absolute line number: the window's array
 * index is not the line, and every consumer here — the current-line tint, the
 * gutter, the include hotlinks, the hit test against the textarea's pixel grid
 * — is talking about a line in the file.
 */
const highlightedLines = computed(() => {
  const { start, end } = renderedLineWindow.value
  const lines = editorLines.value
  const colored = highlightsSyntax.value
  const rows: Array<{ line: number; tokens: MachineSyntaxToken[] }> = []
  for (let index = start; index < end; index += 1) {
    const text = lines[index] ?? ''
    rows.push({
      line: index,
      tokens: colored ? tokenizeMachineLine(text) : [{ kind: 'plain', text }],
    })
  }
  return rows
})
/** Whether any indexed file lives at or under `directory` — the config root always does. */
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
const includeHotlinks = computed<IncludeHotlink[]>(() => {
  const file = machineFiles.currentFile
  if (!file) return []
  // Neither "dead" nor "confirmed real" until the index has actually loaded —
  // an empty searchFiles before that point must not read as every include
  // pointing nowhere.
  const indexReady = machineFiles.searchFilesLoaded
  const links: IncludeHotlink[] = []
  for (const { line, tokens } of highlightedLines.value) {
    let column = 0
    for (const token of tokens) {
      if (token.kind === 'includePath') {
        const targetPath = resolvableIncludeTarget(file.path, token.text)
        if (targetPath) {
          const exists = indexReady
            ? machineFiles.searchFiles.some((entry) => entry.path === targetPath)
            : null
          const directory = targetPath.includes('/')
            ? targetPath.slice(0, targetPath.lastIndexOf('/'))
            : ''
          const directoryExists = !indexReady ? null : exists || directoryIsKnownToExist(directory)
          links.push({
            line,
            start: column,
            end: column + token.text.length,
            targetPath,
            exists,
            directoryExists,
          })
        }
      }
      column += token.text.length
    }
  }
  return links
})
/** Lines whose [include] is confirmed to point nowhere — the squiggly is persistent, not hover-only. */
const deadIncludeLines = computed(
  () =>
    new Set(includeHotlinks.value.filter((link) => link.exists === false).map((link) => link.line)),
)
const hotlinkTooltip = computed(() => {
  const link = hoveredIncludeLink.value
  if (!link) return undefined
  return link.exists === false
    ? t('configuration.editor.deadIncludeTooltip', { path: link.targetPath })
    : t('configuration.editor.openInclude', { path: link.targetPath })
})
/*
 * The outline is the config file's own sections, so it is built only for a file
 * whose sections mean something — the same predicate that decides colouring.
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

function setSort(key: FileSortKey): void {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === 'ascending' ? 'descending' : 'ascending'
  } else {
    sortKey.value = key
    sortDirection.value = 'ascending'
  }
}

function setEditorDisplayMode(mode: EditorDisplayMode): void {
  editorDisplayMode.value = mode
  localStorage.setItem(editorDisplayModeStorageKey, mode)
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
  return entry.kind + ':' + entry.name
}

/** Path of an entry in the directory currently shown, relative to the config root. */
function entryPathOf(entry: MachineFileEntry): string {
  if (entry.kind === 'file' && 'path' in entry && entry.path) return entry.path as string
  return machineFiles.currentPath ? machineFiles.currentPath + '/' + entry.name : entry.name
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

function renameEntry(entry: MachineFileEntry): void {
  closeContextMenu()
  pendingRename.value = entry
}

async function confirmRename(name: string): Promise<void> {
  const entry = pendingRename.value
  pendingRename.value = null
  if (!entry) return
  await machineFiles.renameEntry(entry, name)
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
  if (confirmations.shouldConfirm('deleteFileEntry')) pendingDelete.value = entry
  else void machineFiles.deleteEntry(entry)
}

async function confirmDeleteEntry(): Promise<void> {
  const entry = pendingDelete.value
  pendingDelete.value = null
  if (!entry) return
  await machineFiles.deleteEntry(entry)
}

/** True while the drag carries OS files rather than one of our own rows. */
function isExternalFileDrag(event: DragEvent): boolean {
  return Boolean(event.dataTransfer?.types.includes('Files'))
}

/** Whether files dragged in from outside the browser may land on this row. */
function canDropExternalOn(target: MachineFileEntry | 'parent'): boolean {
  if (!moonrakerAvailability.value.isAvailable || machineFiles.isMutating) return false
  if (target === 'parent') return machineFiles.currentPath !== ''
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
  // The draggable attribute is a hint the platform will honour loosely, so the
  // permission check is repeated where the drag actually starts.
  if (!isWritable(entry) || entry.kind !== 'file') {
    event.preventDefault()
    return
  }
  draggingEntry.value = entry
  event.dataTransfer?.setData('text/plain', entryPathOf(entry))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragEnd(): void {
  draggingEntry.value = null
  dropTargetKey.value = null
}

/** Whether the dragged file can land on this row. */
function canDropOn(entry: MachineFileEntry | 'parent'): boolean {
  const dragged = draggingEntry.value
  if (!dragged || !isWritable(dragged)) return false
  if (entry === 'parent') return machineFiles.currentPath !== ''
  // A read-only folder cannot receive the file either.
  return entry.kind === 'directory' && entry.permissions.includes('w')
}

function onDragOver(event: DragEvent, entry: MachineFileEntry | 'parent'): void {
  if (isExternalFileDrag(event)) {
    if (!canDropExternalOn(entry)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    dropTargetKey.value = entry === 'parent' ? 'parent' : entryKey(entry)
    return
  }
  if (!canDropOn(entry)) return
  // Preventing default is what marks this element as a valid drop target.
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTargetKey.value = entry === 'parent' ? 'parent' : entryKey(entry)
}

function onDragLeave(entry: MachineFileEntry | 'parent'): void {
  const key = entry === 'parent' ? 'parent' : entryKey(entry)
  if (dropTargetKey.value === key) dropTargetKey.value = null
}

async function onDrop(event: DragEvent, target: MachineFileEntry | 'parent'): Promise<void> {
  event.preventDefault()

  if (isExternalFileDrag(event)) {
    // Claim the event so it doesn't also reach the list's own drop handler,
    // which would upload the same files a second time into the current folder.
    event.stopPropagation()
    const files = [...(event.dataTransfer?.files ?? [])]
    const allowed = canDropExternalOn(target)
    dropTargetKey.value = null
    if (!allowed || files.length === 0) return
    const directory = target === 'parent' ? parentPath.value : entryPathOf(target)
    await machineFiles.uploadFiles(files, directory)
    return
  }

  const dragged = draggingEntry.value
  const allowed = canDropOn(target)
  onDragEnd()
  if (!dragged || !allowed) return

  const destination =
    target === 'parent'
      ? parentPath.value
      : machineFiles.currentPath
        ? machineFiles.currentPath + '/' + target.name
        : target.name

  // Moving an open file repoints the editor without replacing its content, so
  // unsaved edits remain open and do not need a discard decision.
  // A move can invalidate an [include] in printer.cfg, which would stop
  // Klipper from starting. Check and warn before moving anything, so the
  // user can choose to leave the file where it is instead of discovering
  // the broken include after the fact.
  const { rewrite } = await machineFiles.checkMoveInclude(dragged, destination)
  if (!rewrite) {
    await machineFiles.moveEntryTo(dragged, destination)
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
  if (moved) await machineFiles.applyIncludeUpdate(pending.rewrite.content)
}

async function confirmMoveWithoutInclude(): Promise<void> {
  const pending = pendingMove.value
  pendingMove.value = null
  if (moveDialog.value?.open) moveDialog.value.close()
  if (pending) await machineFiles.moveEntryTo(pending.entry, pending.destination)
}

function cancelPendingMove(event?: Event): void {
  event?.preventDefault()
  pendingMove.value = null
  if (moveDialog.value?.open) moveDialog.value.close()
}

async function chooseEntry(entry: MachineFileEntry): Promise<void> {
  const entryPath =
    entry.kind === 'file' && 'path' in entry && entry.path
      ? (entry.path as string)
      : machineFiles.currentPath
        ? `${machineFiles.currentPath}/${entry.name}`
        : entry.name
  if (entry.kind === 'file' && machineFiles.currentFile?.path === entryPath) {
    machineFiles.closeFile()
    return
  }
  if (entry.kind === 'directory') {
    search.value = ''
    await machineFiles.enterDirectory(entry.name)
    return
  }
  await openWithWarningGate(entry.name, entry.size, async () => {
    if ('path' in entry && entry.path) {
      await machineFiles.openRecentFile({ ...entry, kind: 'file', path: entry.path as string })
    } else {
      await machineFiles.openFile(entry)
    }
  })
}

async function openRecentFile(file: OpenMachineFile): Promise<void> {
  if (machineFiles.currentFile?.path === file.path) {
    machineFiles.closeFile()
    return
  }
  await openWithWarningGate(file.name, file.size, async () => {
    search.value = ''
    await machineFiles.openRecentFile(file)
  })
}

async function navigateTo(path: string): Promise<void> {
  search.value = ''
  await machineFiles.navigate(path)
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

async function closeEditor(): Promise<void> {
  machineFiles.closeFile()
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

function insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
  if (document.execCommand('insertText', false, text)) return
  const { selectionStart, selectionEnd, value } = textarea
  const cursor = selectionStart + text.length
  textarea.value = `${value.slice(0, selectionStart)}${text}${value.slice(selectionEnd)}`
  textarea.selectionStart = textarea.selectionEnd = cursor
  textarea.dispatchEvent(new Event('input'))
}

/**
 * Applies one line-scoped command as a single replacement, so the browser
 * records it as one undo step. Returns false for a command that had nothing to
 * do, which is what leaves the key to whatever else wants it.
 */
function applyLineEdit(textarea: HTMLTextAreaElement, edit: LineEdit | null): boolean {
  if (!edit) return false
  textarea.setSelectionRange(edit.from, edit.to)
  insertAtCursor(textarea, edit.text)
  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd)
  updateCurrentEditorLine()
  return true
}

/**
 * Tab over a selection that spans lines indents them; anywhere else it inserts
 * one soft tab, replacing the selection the way any other character key would.
 */
function handleEditorTab(event: KeyboardEvent, textarea: HTMLTextAreaElement): void {
  event.preventDefault()
  const { selectionStart, selectionEnd, value } = textarea
  if (highlightsSyntax.value && value.slice(selectionStart, selectionEnd).includes('\n')) {
    applyLineEdit(textarea, indentSelection(value, selectionStart, selectionEnd, indentWidth.value))
    return
  }
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
  insertAtCursor(
    textarea,
    softTabInsertion(value.slice(lineStart, selectionStart), indentWidth.value),
  )
}

/*
 * Shift+Tab is claimed only when there is indentation to remove. Tab inside a
 * textarea already costs a keyboard-only reader their way forward out of the
 * editor, and taking the way back as well would leave no exit at all — so on a
 * line that is already flush the event is left alone and moves focus.
 */
function handleEditorOutdent(event: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  if (!highlightsSyntax.value) return false
  const { selectionStart, selectionEnd, value } = textarea
  const edit = outdentSelection(value, selectionStart, selectionEnd, indentWidth.value)
  if (!applyLineEdit(textarea, edit)) return false
  event.preventDefault()
  return true
}

/**
 * Comment toggling, moving lines, duplicating them, and reindenting the file —
 * the commands that act on whole lines rather than on the caret. Returns false
 * when the key is not one of theirs, or when the command it names has nothing to
 * do.
 *
 * All of them are gated on `highlightsSyntax`, which is the same predicate that
 * decides whether the file is coloured: the config root, and only the formats
 * `syntax.ts` describes. Every one of these commands asserts something about
 * Klipper's format — `#` is its comment marker, a continuation block is its
 * indentation rule — and a `.json` or `.txt` sitting in the config root is not
 * that format, so a command that ran there would produce a file neither Klipper
 * nor the file's real reader accepts. A log is already read-only and never gets
 * this far.
 */
function handleEditorLineCommand(event: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  if (!highlightsSyntax.value) return false
  const { selectionStart: start, selectionEnd: end, value } = textarea
  const modifier = event.ctrlKey || event.metaKey

  if (modifier && !event.altKey && event.key === '/') {
    return applyLineEdit(textarea, toggleComment(value, start, end))
  }
  /*
   * Reformatting is the one command allowed to rewrite lines the reader never
   * touched, which is exactly why it is a named chord and nothing else: never on
   * save, and never a side effect of typing. Shift+Alt+F rather than ReSharper's
   * Ctrl+Alt+L because some Linux desktops take that one for the lock screen.
   */
  if (event.altKey && event.shiftKey && !modifier && event.key.toLowerCase() === 'f') {
    return applyLineEdit(textarea, reindentDocument(value, start, indentWidth.value))
  }
  if (event.altKey && !modifier && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    const direction = event.key === 'ArrowUp' ? -1 : 1
    return applyLineEdit(
      textarea,
      event.shiftKey
        ? duplicateSelectedLines(value, start, end, direction)
        : moveSelectedLines(value, start, end, direction),
    )
  }
  return false
}

function handleEditorEnter(event: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
  const { selectionStart, selectionEnd, value } = textarea
  if (selectionStart !== selectionEnd) return false
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
  const line = value.slice(lineStart, selectionStart)

  if (/^\s*$/.test(line)) {
    if (!line) return false
    event.preventDefault()
    textarea.setSelectionRange(lineStart, selectionStart)
    insertAtCursor(textarea, '\n')
    return true
  }

  const carried = continuationIndent(line, indentWidth.value, isEmptyPropertyLine(line))
  if (!carried) return false
  event.preventDefault()
  insertAtCursor(textarea, `\n${carried}`)
  return true
}

function handleEditorKeydown(event: KeyboardEvent): void {
  /*
   * Ahead of the read-only gate: the reference describes the editor, and a file
   * this printer will not let us write is still one whose shortcuts for reading
   * — Ctrl+click, Escape — apply.
   *
   * Matched on the character the layout produced rather than on a physical key.
   * `?` is the shifted twin of `/` on a US layout but a different key entirely
   * on a Norwegian one, where `/` is itself already `Shift+7` — so comparing
   * `event.code` would claim the comment toggle's own chord on half the
   * keyboards Alabaster runs on.
   */
  if ((event.ctrlKey || event.metaKey) && event.key === '?') {
    event.preventDefault()
    shortcutsOpen.value = true
    return
  }
  if (!currentFileReadOnly.value && editor.value) {
    if (event.key === 'Tab') {
      if (!event.shiftKey) {
        handleEditorTab(event, editor.value)
        return
      }
      if (handleEditorOutdent(event, editor.value)) return
    }
    if (event.key === 'Enter' && handleEditorEnter(event, editor.value)) return
    if (handleEditorLineCommand(event, editor.value)) {
      event.preventDefault()
      return
    }
  }
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
  /*
   * Save is Ctrl+S; save-and-restart adds Alt, not Shift.
   *
   * Ctrl+Shift+S is what this used to be, and it is unusable: screen-capture
   * tools claim it globally on Windows, and a global hotkey is consumed before
   * the browser ever sees the key. That is a worse failure than a shortcut the
   * browser owns — the page cannot preventDefault what never reaches it, so it
   * cannot even tell the reader why nothing happened. A chord commonly held by a
   * desktop utility is therefore off limits the same way Ctrl+T and Ctrl+W are.
   *
   * Alt keeps the S mnemonic and, unlike a chord built on Enter, is not one slip
   * away from a key pressed constantly in a text editor — this one restarts the
   * firmware, so it should take a deliberate reach. `Ctrl+Alt` is also `AltGr` on
   * a Norwegian layout, where `AltGr+S` produces no character and so is not a
   * chord anyone presses on purpose.
   *
   * Shift makes it none of ours, rather than falling through to a plain save.
   * Where a capture tool does not hold the chord, Ctrl+Shift+S would otherwise
   * write a half-edited config to the printer because someone reached for a
   * screenshot — and the press is left un-prevented so whatever does want it
   * still gets it.
   */
  if (event.shiftKey) return
  event.preventDefault()
  if (event.altKey && klipperAvailability.value.isAvailable) void save(true)
  else void save(false)
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
  if (hasOpenDialog()) return
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
  void closeEditor()
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
 * them as ordinary mouse events and honours `preventDefault()` on the
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

/*
 * The gutter and the highlight layer follow the textarea by transform rather
 * than by their own scroll offset. Only a window of lines is mounted in either,
 * so their scrollable extent is a screenful and no longer the file's — and a
 * scroll offset set past that extent is silently clamped, which would slide the
 * colouring off the text it belongs to. A transform has no extent to clamp
 * against, and is the property ADR 0004 asks movement to use.
 */
function syncEditorScroll(): void {
  const textarea = editor.value
  if (!textarea) return
  editorScrollTop.value = textarea.scrollTop
  const vertical = `translate3d(0, ${-textarea.scrollTop}px, 0)`
  if (lineNumbersContent.value) lineNumbersContent.value.style.transform = vertical
  if (syntaxContent.value) {
    syntaxContent.value.style.transform = `translate3d(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px, 0)`
  }
}

/**
 * Measures the editor's own row height and visible height, which together decide
 * which lines are mounted. Both come from the textarea because it is the element
 * the browser is actually laying the text out in: the rem in main.css scales
 * with the root font size and with browser zoom.
 */
function measureEditorViewport(): void {
  const textarea = editor.value
  if (!textarea) return
  const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight)
  if (Number.isFinite(lineHeight) && lineHeight > 0) editorLineHeight.value = lineHeight
  editorViewportHeight.value = textarea.clientHeight
  syncEditorScroll()
}

function updateCurrentEditorLine(): void {
  if (!editor.value) return
  currentEditorLine.value = lineNumberAt(editor.value.value, editor.value.selectionStart)
}

let measureContext: CanvasRenderingContext2D | null = null

/**
 * Pixel width of one monospace character in the editor's own font, measured
 * rather than assumed from the rem values in main.css: those scale with the
 * root font size and any browser zoom, and the hit-test below has to agree
 * with the highlight layer pixel-for-pixel.
 */
function editorCharWidth(textarea: HTMLTextAreaElement): number {
  const context = measureContext ?? document.createElement('canvas').getContext('2d')
  measureContext = context
  if (!context) return 0
  const style = getComputedStyle(textarea)
  context.font = `${style.fontSize} ${style.fontFamily}`
  return context.measureText('0').width
}

/*
 * The textarea sits on top of the highlight layer and must stay there to keep
 * native typing, selection, and caret placement — so a real DOM :hover on an
 * `includePath` span underneath is never reachable. This recovers the same
 * information from pixel coordinates instead, against the monospace grid the
 * textarea and highlight layer both render with identical font and padding.
 */
function hotlinkAt(event: MouseEvent): IncludeHotlink | null {
  const textarea = editor.value
  if (!textarea || includeHotlinks.value.length === 0) return null
  const charWidth = editorCharWidth(textarea)
  if (!charWidth) return null
  const style = getComputedStyle(textarea)
  const rect = textarea.getBoundingClientRect()
  const x = event.clientX - rect.left + textarea.scrollLeft - parseFloat(style.paddingLeft)
  const y = event.clientY - rect.top + textarea.scrollTop - parseFloat(style.paddingTop)
  if (x < 0 || y < 0) return null
  const line = Math.floor(y / parseFloat(style.lineHeight))
  const column = Math.floor(x / charWidth)
  return (
    includeHotlinks.value.find(
      (link) => link.line === line && column >= link.start && column < link.end,
    ) ?? null
  )
}

function handleEditorMouseMove(event: MouseEvent): void {
  hoveredIncludeLink.value = hotlinkAt(event)
}

function handleEditorMouseLeave(): void {
  hoveredIncludeLink.value = null
}

/**
 * Opens a file by path — for a hotlink target or a history step, neither of
 * which is a click on a row already showing what's open, so neither wants
 * openRecentFile's "click it again to close it" toggle. Prefers the search
 * index's metadata (for the large-file/read-only gates), but still attempts
 * the open without it — the store's own fetch is the authority on whether
 * the file actually exists.
 */
async function openFileAtPath(path: string): Promise<void> {
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
    await machineFiles.openRecentFile(file)
  })
}

async function handleEditorClick(event: MouseEvent): Promise<void> {
  updateCurrentEditorLine()
  const link = hoveredIncludeLink.value
  if (!link || !(event.ctrlKey || event.metaKey)) return
  if (link.exists === false) {
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
    return
  }
  await openFileAtPath(link.targetPath)
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
  if (!editor.value) return
  const position = editorLines.value
    .slice(0, Math.max(0, line - 1))
    .reduce((sum, value) => sum + value.length + 1, 0)
  editor.value.focus()
  editor.value.setSelectionRange(position, position)
  currentEditorLine.value = line
  // Two lines of lead-in above the target, so it lands inside the view rather
  // than against its top edge.
  editor.value.scrollTop = Math.max(0, (line - 3) * editorLineHeight.value)
  syncEditorScroll()
}

async function navigateFileHistory(direction: -1 | 1): Promise<void> {
  const nextIndex = fileHistoryIndex.value + direction
  const entry = fileHistory.value[nextIndex]
  if (!entry) return
  setFileHistoryIndex(nextIndex)
  suppressedHistoryPath = entry.path
  await openFileAtPath(entry.path)
}

function navigateFileHistoryBack(): void {
  void navigateFileHistory(-1)
}

function navigateFileHistoryForward(): void {
  void navigateFileHistory(1)
}

watch(
  () => machineFiles.currentFile?.path,
  (path) => {
    currentEditorLine.value = 1
    hoveredIncludeLink.value = null
    void nextTick(syncEditorScroll)
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

/*
 * Immediate, because arriving on the route with a large file already open is the
 * case that made navigation feel broken: the body would otherwise be mounted as
 * part of the first render, inside the navigation.
 */
watch(() => machineFiles.currentFile?.path, mountEditorBodySoon, { immediate: true })

watch(
  isEditorFullscreen,
  (fullscreen) => document.body.classList.toggle('machine-editor-fullscreen-open', fullscreen),
  { immediate: true },
)

watch(isExplorerCompact, () => {
  explorerResizing.value = true
  if (explorerResizeTimer) clearTimeout(explorerResizeTimer)
  explorerResizeTimer = setTimeout(() => {
    explorerResizing.value = false
    explorerResizeTimer = null
  }, 180)
})

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!machineFiles.hasUnsavedFiles) return
  event.preventDefault()
}

onMounted(() => {
  machineFiles.start()
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
})

/*
 * The editor's visible height decides how many lines are mounted, and it changes
 * without the window resizing: opening and closing a file, compacting the
 * explorer, and going fullscreen all resize the pane. Watching the textarea
 * itself is what keeps the window right in each of those cases without a rule
 * per case.
 */
let editorResizeObserver: ResizeObserver | null = null

watch(editor, (textarea) => {
  editorResizeObserver?.disconnect()
  editorResizeObserver = null
  if (!textarea) return
  measureEditorViewport()
  if (typeof ResizeObserver === 'undefined') return
  editorResizeObserver = new ResizeObserver(measureEditorViewport)
  editorResizeObserver.observe(textarea)
})

onBeforeUnmount(() => {
  machineFiles.stop()
  editorResizeObserver?.disconnect()
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('keydown', handleWindowKeydown)
  window.removeEventListener('mousedown', handleWindowMouseDown, true)
  window.removeEventListener('mouseup', handleWindowMouseUp, true)
  window.removeEventListener('auxclick', handleWindowAuxClick, true)
  window.removeEventListener('keydown', updateLinkModifierState)
  window.removeEventListener('keyup', updateLinkModifierState)
  window.removeEventListener('blur', clearLinkModifierState)
  document.body.classList.remove('machine-editor-fullscreen-open')
  if (explorerResizeTimer) clearTimeout(explorerResizeTimer)
  if (contentSearchTimer) clearTimeout(contentSearchTimer)
  cancelEditorBodyMount()
})
</script>

<template>
  <section
    class="workspace-page file-explorer-view"
    :class="{ 'machine-view--fullscreen': isEditorFullscreen }"
  >
    <PageHeading :title="t('configuration.files.title')" />

    <AvailabilityRegion requires="moonraker" class="machine-availability">
      <div
        class="machine-workspace"
        :class="{
          'machine-workspace--editor-open': machineFiles.currentFile,
          'machine-workspace--maximized': isExplorerCompact,
          'machine-workspace--fullscreen': isEditorFullscreen,
          'machine-workspace--resizing': explorerResizing,
        }"
        :data-pending="
          machineFiles.isDirectoryLoading || machineFiles.isEditorLoading || machineFiles.isMutating
        "
      >
        <aside class="machine-explorer" :aria-label="t('configuration.files.title')">
          <header class="machine-pane-header">
            <!--
              Fades out when the editor compacts the explorer, but keeps its
              space: the four header controls are what has to stay put, and
              collapsing this box instead would slide them across the pane.
            -->
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
                icon="save"
                :disabled="!canSaveAll"
                :pending="machineFiles.isMutating && machineFiles.hasUnsavedFiles"
                :aria-label="t('configuration.actions.saveAll')"
                :title="t('configuration.actions.saveAll')"
                @click="requestSaveAll"
              />
              <AppButton
                variant="danger-quiet"
                size="xs"
                icon-only
                icon="undo"
                :disabled="!machineFiles.hasUnsavedFiles"
                :aria-label="t('configuration.actions.discardAll')"
                :title="t('configuration.actions.discardAll')"
                @click="requestDiscardAll"
              />
              <HeaderMenu :label="t('configuration.settings.open')" align="end">
                <template #trigger>
                  <AppIcon name="settings" class="size-4" aria-hidden="true" />
                </template>
                <template #default>
                  <p class="header-menu__section-title">
                    {{ t('configuration.settings.visibility') }}
                  </p>
                  <label
                    class="check-row check-row--block header-menu__toggle"
                    :title="t('configuration.settings.showHiddenFiles.hint')"
                  >
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
                  <label
                    class="check-row check-row--block header-menu__toggle"
                    :title="t('configuration.settings.showReadOnlyFiles.hint')"
                  >
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
                </template>
              </HeaderMenu>
            </div>
          </header>

          <div class="machine-root-tabs" role="group" :aria-label="t('configuration.roots.label')">
            <button
              v-for="root in fileRoots"
              :key="root"
              type="button"
              class="tab-select"
              :aria-pressed="machineFiles.currentRoot === root"
              :disabled="!moonrakerAvailability.isAvailable"
              @click="machineFiles.setRoot(root)"
            >
              {{ t(`configuration.roots.${root}`) }}
            </button>
          </div>

          <nav class="machine-breadcrumbs" :aria-label="t('configuration.files.path')">
            <span class="machine-breadcrumbs__label" aria-hidden="true">{{
              t('configuration.files.pathLabel')
            }}</span>
            <template v-for="(segment, index) in pathSegments" :key="segment.path">
              <span v-if="index > 0" aria-hidden="true">/</span>
              <button
                type="button"
                class="text-action machine-breadcrumbs__segment"
                :disabled="!moonrakerAvailability.isAvailable"
                :aria-current="index === pathSegments.length - 1 ? 'page' : undefined"
                @click="navigateTo(segment.path)"
              >
                {{ segment.name }}
              </button>
            </template>
          </nav>

          <!--
            Always present, never `v-if`'d away. This band is a fixed row in the
            pane's stack, so removing it when there is nothing to show moves every
            row below it — which is what switching roots did, since a root change
            drops the recents that belonged to the root being left.
          -->
          <section class="machine-recent-files" :aria-label="t('configuration.files.recentFiles')">
            <span class="machine-recent-files__label" aria-hidden="true">{{
              t('configuration.files.recentFileLabel')
            }}</span>
            <button
              v-if="lastEditedFile"
              type="button"
              class="machine-recent-files__file"
              :title="`/${machineFiles.currentRoot}/${lastEditedFile.path}`"
              @click="openRecentFile(lastEditedFile)"
            >
              <AppIcon
                :name="fileIcon(lastEditedFile.name)"
                class="size-4 shrink-0"
                aria-hidden="true"
              />
              <span class="machine-recent-files__name">{{ lastEditedFile.name }}</span>
            </button>
            <!--
              Only once the listing has actually arrived. Recents are derived from
              it, and a root switch clears them before the new listing lands — so
              saying "nothing opened yet" in that gap blinks a false answer for a
              frame or two. The band holds its height regardless.
            -->
            <span
              v-else-if="!machineFiles.isDirectoryLoading"
              class="machine-recent-files__empty"
              >{{ t('configuration.files.recentFileNone') }}</span
            >
          </section>

          <div class="machine-file-controls">
            <label class="field field--sm field--on-soft machine-search">
              <AppIcon name="fileSearch" class="size-4" aria-hidden="true" />
              <span class="sr-only">{{ t('configuration.files.search') }}</span>
              <input
                v-model="search"
                type="search"
                :placeholder="t('configuration.files.search')"
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

          <div class="machine-file-columns">
            <button
              type="button"
              class="text-action machine-sort-header"
              :aria-label="t('configuration.files.name')"
              @click="setSort('name')"
            >
              <span>{{ t('configuration.files.name') }}</span>
              <AppIcon
                v-if="sortKey === 'name'"
                :name="sortDirection === 'ascending' ? 'up' : 'down'"
                class="machine-sort-indicator"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="text-action machine-sort-header"
              :aria-label="t('configuration.files.size')"
              @click="setSort('size')"
            >
              <span>{{ t('configuration.files.size') }}</span>
              <AppIcon
                v-if="sortKey === 'size'"
                :name="sortDirection === 'ascending' ? 'up' : 'down'"
                class="machine-sort-indicator"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="text-action machine-sort-header"
              :aria-label="t('configuration.files.modified')"
              @click="setSort('modified')"
            >
              <span>{{ t('configuration.files.modified') }}</span>
              <AppIcon
                v-if="sortKey === 'modified'"
                :name="sortDirection === 'ascending' ? 'up' : 'down'"
                class="machine-sort-indicator"
                aria-hidden="true"
              />
            </button>
          </div>

          <ul
            class="machine-file-list"
            :class="{ 'machine-file-list--drop-active': isExternalDropZoneActive }"
            :aria-label="t('configuration.files.contents')"
            :aria-busy="machineFiles.isDirectoryLoading || undefined"
            @dragenter="onExternalDragEnter"
            @dragover="onExternalDragOver"
            @dragleave="onExternalDragLeave"
            @drop="onExternalDrop"
          >
            <li v-if="machineFiles.currentPath && !search.trim()" class="machine-parent-entry">
              <button
                type="button"
                class="file-select machine-file-row machine-file-row--parent"
                :disabled="!moonrakerAvailability.isAvailable"
                :aria-label="t('configuration.files.parent')"
                :title="
                  draggingEntry
                    ? t('configuration.move.dropHint', { name: '..' })
                    : t('configuration.files.parent')
                "
                :data-drop-target="dropTargetKey === 'parent' ? 'true' : undefined"
                @click="navigateTo(parentPath)"
                @dragover="onDragOver($event, 'parent')"
                @dragleave="onDragLeave('parent')"
                @drop="onDrop($event, 'parent')"
              >
                <span class="machine-file-name">
                  <AppIcon
                    name="folderUp"
                    class="machine-file-icon--folder size-5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="machine-file-name__details">
                    <span class="machine-file-name__label">..</span>
                  </span>
                </span>
                <span class="machine-file-meta text-field-label text-muted">{{
                  t('configuration.files.folder')
                }}</span>
                <span class="machine-file-meta" aria-hidden="true"></span>
              </button>
            </li>
            <!--
              Keyed by position, not by path: a folder switch replaces the
              whole list's content, and keying by path would make Vue tear
              down the row under the pointer and mount a new one in its place.
              The pointer doesn't move, so the browser drops :hover on the
              node that vanishes and only re-applies it on the next real mouse
              event — a visible blink. Reusing the row at each position lets
              the browser patch its content in place instead, so hover (and
              focus) stay exactly where the pointer already is straight
              through the navigation.
            -->
            <li v-for="(entry, index) in filteredEntries" :key="index">
              <button
                type="button"
                class="file-select machine-file-row"
                :class="{
                  'machine-file-row--active':
                    entry.kind === 'file' &&
                    machineFiles.currentFile?.path ===
                      ('path' in entry
                        ? entry.path
                        : machineFiles.currentPath
                          ? `${machineFiles.currentPath}/${entry.name}`
                          : entry.name),
                }"
                :disabled="!moonrakerAvailability.isAvailable"
                :draggable="isWritable(entry) && entry.kind === 'file'"
                :data-dragging="
                  draggingEntry && entryKey(draggingEntry) === entryKey(entry) ? 'true' : undefined
                "
                :data-drop-target="dropTargetKey === entryKey(entry) ? 'true' : undefined"
                :data-context-open="
                  contextMenu && entryKey(contextMenu.entry) === entryKey(entry)
                    ? 'true'
                    : undefined
                "
                @click="chooseEntry(entry)"
                @contextmenu.prevent="openContextMenu($event, entry)"
                @dragstart="onDragStart($event, entry)"
                @dragend="onDragEnd"
                @dragover="onDragOver($event, entry)"
                @dragleave="onDragLeave(entry)"
                @drop="onDrop($event, entry)"
              >
                <span class="machine-file-name">
                  <!--
                    The tooltip lives on this wrapper, not the AppIcon svg: an
                    unfilled stroke icon only paints a thin outline, and SVG
                    shapes hit-test against painted pixels by default, so
                    hovering the icon's own empty middle would never trigger it.
                  -->
                  <span
                    class="machine-file-icon-hover"
                    :title="
                      isEntryIncluded(entry)
                        ? t('configuration.files.includedInPrimaryConfig')
                        : undefined
                    "
                  >
                    <AppIcon
                      :name="entry.kind === 'directory' ? 'folder' : fileIcon(entry.name)"
                      :class="[
                        'size-5 shrink-0',
                        {
                          'machine-file-icon--folder': entry.kind === 'directory',
                          'machine-file-icon--included': isEntryIncluded(entry),
                          'machine-file-icon--dirty': isEntryDirty(entry),
                        },
                      ]"
                      aria-hidden="true"
                    />
                  </span>
                  <span class="machine-file-name__details">
                    <span
                      class="machine-file-name__label"
                      :class="{ 'machine-file-name__label--dirty': isEntryDirty(entry) }"
                      :title="entry.name"
                      >{{ entry.name }}</span
                    >
                    <span v-if="isEntryDirty(entry)" class="machine-dirty-mark">{{
                      t('configuration.editor.unsaved')
                    }}</span>
                    <!--
                      Marked per row only where read-only is the exception. In a
                      wholly read-only root every row would carry the same mark,
                      which states one fact as many times as there are files —
                      the selected tab already says it once.
                    -->
                    <span
                      v-if="machineFiles.isRootEditable && !entry.permissions.includes('w')"
                      class="machine-readonly-mark"
                    >
                      {{ t('configuration.files.readOnlyShort') }}
                    </span>
                  </span>
                </span>
                <span class="machine-file-meta font-mono text-xs tabular-nums text-muted">
                  {{
                    entry.kind === 'directory'
                      ? t('configuration.files.folder')
                      : formatSize(entry.size)
                  }}
                </span>
                <span class="machine-file-meta text-xs text-muted">{{
                  formatModified(entry.modified)
                }}</span>
              </button>
            </li>

            <li
              v-if="!machineFiles.isDirectoryLoading && filteredEntries.length === 0"
              class="machine-empty-state"
            >
              <AppIcon name="fileSearch" class="size-6" aria-hidden="true" />
              <p class="font-bold">
                {{ t(search ? 'configuration.files.noResults' : 'configuration.files.empty') }}
              </p>
            </li>
          </ul>
        </aside>

        <section class="machine-editor-pane" :aria-label="t('configuration.editor.title')">
          <template v-if="machineFiles.currentFile">
            <header class="machine-editor-header">
              <div class="machine-editor-identity min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-2">
                  <div
                    class="machine-editor-history"
                    role="group"
                    :aria-label="t('configuration.editor.history')"
                  >
                    <AppButton
                      icon-only
                      size="xs"
                      icon="back"
                      :disabled="!canNavigateFileHistoryBack"
                      :aria-label="t('configuration.editor.historyBack')"
                      :title="t('configuration.editor.historyBack')"
                      @click="navigateFileHistoryBack"
                    />
                    <AppButton
                      icon-only
                      size="xs"
                      icon="forward"
                      :disabled="!canNavigateFileHistoryForward"
                      :aria-label="t('configuration.editor.historyForward')"
                      :title="t('configuration.editor.historyForward')"
                      @click="navigateFileHistoryForward"
                    />
                  </div>
                  <AppIcon
                    :name="fileIcon(machineFiles.currentFile.name)"
                    class="size-5 shrink-0 text-action"
                    aria-hidden="true"
                  />
                  <h2 class="truncate text-dialog-title">
                    {{ machineFiles.currentFile.name }}
                  </h2>
                  <span v-if="machineFiles.isDirty" class="machine-dirty-mark">{{
                    t('configuration.editor.unsaved')
                  }}</span>
                  <span v-if="currentFileReadOnly" class="machine-readonly-mark">{{
                    t('configuration.editor.readOnly')
                  }}</span>
                </div>
                <p class="mt-1 truncate font-mono text-xs text-muted">
                  /config/{{ machineFiles.currentFile.path }}
                </p>
              </div>

              <div class="machine-editor-actions">
                <div
                  class="segmented machine-editor-mode"
                  role="group"
                  :aria-label="t('configuration.editor.displayMode')"
                >
                  <AppButton
                    size="sm"
                    :aria-pressed="editorDisplayMode === 'maximized'"
                    :aria-label="t('configuration.editor.maximized')"
                    :title="t('configuration.editor.maximized')"
                    @click="setEditorDisplayMode('maximized')"
                  >
                    <AppIcon name="expand" class="size-4" aria-hidden="true" />
                    <span>{{ t('configuration.editor.maximized') }}</span>
                  </AppButton>
                  <AppButton
                    size="sm"
                    :aria-pressed="editorDisplayMode === 'fullscreen'"
                    :aria-label="t('configuration.editor.fullscreen')"
                    :title="t('configuration.editor.fullscreen')"
                    @click="setEditorDisplayMode('fullscreen')"
                  >
                    <AppIcon name="fullscreen" class="size-4" aria-hidden="true" />
                    <span>{{ t('configuration.editor.fullscreen') }}</span>
                  </AppButton>
                </div>
                <AppButton
                  v-if="!isCurrentFilePreview"
                  variant="primary"
                  class="machine-editor-action"
                  :disabled="!canSave || !machineFiles.isDirty"
                  :aria-label="t('configuration.editor.save')"
                  :title="t('configuration.editor.save')"
                  @click="save(false)"
                >
                  <AppIcon name="save" class="size-5" aria-hidden="true" />
                  <span>{{ t('configuration.editor.save') }}</span>
                </AppButton>
                <AppButton
                  v-if="!isCurrentFilePreview"
                  class="machine-editor-action"
                  :disabled="!canSave || !machineFiles.isDirty || !klipperAvailability.isAvailable"
                  :aria-label="t('configuration.editor.saveRestart')"
                  :title="t('configuration.editor.saveRestart')"
                  @click="save(true)"
                >
                  <AppIcon name="refresh" class="size-5" aria-hidden="true" />
                  <span>{{ t('configuration.editor.saveRestart') }}</span>
                </AppButton>
                <AppButton
                  v-if="!isCurrentFilePreview"
                  variant="danger-quiet"
                  class="machine-editor-action"
                  :disabled="!machineFiles.isDirty"
                  :aria-label="t('configuration.editor.discard')"
                  :title="t('configuration.editor.discard')"
                  @click="requestDiscardChanges"
                >
                  <AppIcon name="undo" class="size-5" aria-hidden="true" />
                  <span>{{ t('configuration.editor.discard') }}</span>
                </AppButton>
                <AppButton
                  v-if="!isCurrentFilePreview"
                  icon-only
                  icon="help"
                  aria-haspopup="dialog"
                  :aria-label="t('configuration.shortcuts.open')"
                  :title="t('configuration.shortcuts.open')"
                  @click="shortcutsOpen = true"
                />
                <AppButton
                  icon-only
                  icon="close"
                  :aria-label="t('configuration.editor.close')"
                  :title="t('configuration.editor.close')"
                  @click="closeEditor"
                />
              </div>
            </header>

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
              <div
                v-else
                class="machine-code-editor"
                :data-pending="machineFiles.isEditorLoading || machineFiles.isMutating"
              >
                <!--
                  Stands in the body's own cell while the browser lays out a large
                  file, so arriving here is instant and the wait belongs to the
                  editor. The body then fades in over the same surface the bar sat
                  on — see ADR 0004 on a fade being a consequence of deferring.
                -->
                <div
                  v-if="!editorBodyMounted"
                  class="machine-editor-loading"
                  role="status"
                  aria-live="polite"
                >
                  <p>
                    {{ t('configuration.editor.opening', { name: machineFiles.currentFile.name }) }}
                  </p>
                  <div class="machine-editor-loading__track" aria-hidden="true">
                    <span></span>
                  </div>
                </div>
                <!--
                  Both layers mount only the lines the window covers, and hold
                  the place of everything above it with one spacer. The spans
                  are joined tag-to-tag on purpose: this is `white-space: pre`,
                  so any whitespace between them would print.
                -->
                <div
                  v-if="editorBodyMounted"
                  class="machine-line-numbers"
                  :class="{ 'machine-editor-body-in': editorBodyDeferred }"
                  aria-hidden="true"
                >
                  <pre ref="lineNumbersContent"><span
                    class="machine-code-spacer"
                    :style="{ height: `${renderedWindowOffset}px` }"
                  ></span><span
                    v-for="row in highlightedLines"
                    :key="row.line"
                    class="machine-line-number"
                    :class="{ 'machine-line-number--current': currentEditorLine === row.line + 1 }"
                  >{{ row.line + 1 }}</span></pre>
                </div>
                <div
                  v-if="editorBodyMounted"
                  class="machine-editor-source"
                  :class="{ 'machine-editor-body-in': editorBodyDeferred }"
                >
                  <pre class="machine-code-highlight selectable" aria-hidden="true"><code
                    ref="syntaxContent"
                  ><span
                    class="machine-code-spacer"
                    :style="{ height: `${renderedWindowOffset}px` }"
                  ></span><span
                    v-for="row in highlightedLines"
                    :key="row.line"
                    class="machine-code-line"
                    :class="{ 'machine-code-line--current': currentEditorLine === row.line + 1 }"
                  ><span
                    v-for="(token, tokenIndex) in row.tokens"
                    :key="tokenIndex"
                    :class="[
                      `machine-syntax--${token.kind}`,
                      {
                        'machine-syntax--includePath-dead':
                          token.kind === 'includePath' && deadIncludeLines.has(row.line),
                        'machine-syntax--includePath-hover':
                          token.kind === 'includePath' &&
                          hoveredIncludeLink?.line === row.line &&
                          !deadIncludeLines.has(row.line),
                      },
                    ]"
                  >{{ token.text }}</span></span></code></pre>
                  <textarea
                    ref="editor"
                    v-model="machineFiles.editorContent"
                    spellcheck="false"
                    :readonly="currentFileReadOnly"
                    :class="{
                      'machine-code-editor__textarea--hotlink':
                        hoveredIncludeLink && isLinkModifierHeld,
                    }"
                    :title="hotlinkTooltip"
                    :aria-label="
                      t('configuration.editor.contentLabel', {
                        name: machineFiles.currentFile.name,
                      })
                    "
                    @click="handleEditorClick"
                    @input="updateCurrentEditorLine"
                    @keydown="handleEditorKeydown"
                    @keyup="updateCurrentEditorLine"
                    @scroll="syncEditorScroll"
                    @select="updateCurrentEditorLine"
                    @mousemove="handleEditorMouseMove"
                    @mouseleave="handleEditorMouseLeave"
                  ></textarea>
                </div>
              </div>

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
            <p class="mt-2 max-w-md text-sm leading-relaxed text-muted">
              {{ t('configuration.editor.emptyDescription') }}
            </p>
            <div
              class="segmented machine-editor-mode machine-editor-mode--empty"
              role="group"
              :aria-label="t('configuration.editor.displayMode')"
            >
              <AppButton
                size="sm"
                :aria-pressed="editorDisplayMode === 'maximized'"
                :aria-label="t('configuration.editor.maximized')"
                :title="t('configuration.editor.maximized')"
                @click="setEditorDisplayMode('maximized')"
              >
                <AppIcon name="expand" class="size-4" aria-hidden="true" />
                <span>{{ t('configuration.editor.maximized') }}</span>
              </AppButton>
              <AppButton
                size="sm"
                :aria-pressed="editorDisplayMode === 'fullscreen'"
                :aria-label="t('configuration.editor.fullscreen')"
                :title="t('configuration.editor.fullscreen')"
                @click="setEditorDisplayMode('fullscreen')"
              >
                <AppIcon name="fullscreen" class="size-4" aria-hidden="true" />
                <span>{{ t('configuration.editor.fullscreen') }}</span>
              </AppButton>
            </div>
          </div>
        </section>
      </div>
    </AvailabilityRegion>

    <ConfirmDialog
      :open="pendingDiscard"
      :title="t('configuration.editor.discardTitle')"
      :description="
        t('configuration.editor.discardDescription', { name: machineFiles.currentFile?.name ?? '' })
      "
      :confirm-label="t('configuration.editor.discardConfirm')"
      tone="danger"
      @confirm="confirmDiscardChanges"
      @cancel="pendingDiscard = false"
    />

    <ConfirmDialog
      :open="pendingSaveAll"
      :title="t('configuration.saveAll.title')"
      :description="t('configuration.saveAll.description')"
      :items="machineFiles.unsavedFilePaths"
      :confirm-label="t('configuration.saveAll.confirm')"
      @confirm="confirmSaveAll"
      @cancel="pendingSaveAll = false"
    />

    <ConfirmDialog
      :open="pendingDiscardAll"
      :title="t('configuration.discardAll.title')"
      :description="t('configuration.discardAll.description')"
      :items="machineFiles.unsavedFilePaths"
      :confirm-label="t('configuration.discardAll.confirm')"
      tone="danger"
      @confirm="confirmDiscardAll"
      @cancel="pendingDiscardAll = false"
    />

    <ConfirmDialog
      :open="pendingRestartWithUnsaved"
      :title="t('configuration.editor.saveAllRestartTitle')"
      :description="t('configuration.editor.saveAllRestartDescription')"
      :items="machineFiles.unsavedFilePaths"
      :confirm-label="t('configuration.editor.saveRestartConfirm')"
      @confirm="confirmSaveAllAndRestart"
      @cancel="pendingRestartWithUnsaved = false"
    />

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
      @cancel="pendingDelete = null"
      @confirm="confirmDeleteEntry"
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
      @confirm="confirmPendingFileOpen"
      @cancel="cancelPendingFileOpen"
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
      @confirm="confirmCreateIncludeTarget"
      @cancel="cancelCreateIncludeTarget"
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
  </section>
</template>
