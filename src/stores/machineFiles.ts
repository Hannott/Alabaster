import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import {
  classifyFileKind,
  isLargeFile,
  PRIMARY_CONFIG,
  type MachineFileKind,
} from '@/features/machine/fileKind'
import { withBaseHref } from '@/features/machine/htmlPreview'
import {
  addConfigInclude,
  findIncludeRewrite,
  normalizeConfigPath,
  removeConfigInclude,
  resolvedIncludePaths,
  type IncludeRewrite,
} from '@/features/machine/includes'
import {
  fetchMoonrakerTextFile,
  moonrakerFileUrl,
  normalizeMoonrakerRelativePath,
  uploadMoonrakerFile,
  validMoonrakerFilename,
  type MoonrakerDirectoryResult,
} from '@/services/moonraker'
import { useAvailabilityStore } from '@/stores/availability'
import { useMoonrakerStore } from '@/stores/moonraker'

/**
 * The Moonraker roots this workspace serves. Configuration is what the
 * destination is for; logs ride along because a log is a text file, and a
 * log-files panel bolted onto another page is what this replaces.
 */
export type MachineFileRoot = 'config' | 'logs'

export interface MachineFileEntry {
  kind: 'directory' | 'file'
  name: string
  modified: number
  size: number
  permissions: string
  /**
   * The entry's path within the root, for an entry listed somewhere other than
   * the folder currently browsed — a tree row in another folder, a search
   * result. Without it, a path is the browsed folder joined with `name`, which
   * would rename, move, or delete a same-named file in the wrong folder.
   */
  path?: string
}

export interface OpenMachineFile extends MachineFileEntry {
  kind: 'file'
  path: string
}

/**
 * A file with a tab in the viewer. A preview tab is the one a single click in
 * the explorer reuses, so browsing does not leave a tab behind for every file
 * glanced at; editing it, or opening it deliberately, keeps it.
 */
/**
 * One text file held in memory. `saved` is what disk holds now, `origin` is
 * what it held when the file was first read this session; see `fileBuffers`.
 */
export interface MachineFileBuffer {
  content: string
  saved: string
  origin: string
}

export interface MachineFileTab {
  file: OpenMachineFile
  preview: boolean
}

export interface OpenFileOptions {
  /** Open in the preview tab rather than a kept one. Defaults to a kept tab. */
  preview?: boolean
}

export type MachineFileError =
  'directory' | 'file' | 'save' | 'saveAll' | 'mutation' | 'restart' | null
export type MachineFileNotice =
  | 'saved'
  | 'savedRestarting'
  | 'savedAll'
  | 'savedAllRestarting'
  | 'created'
  | 'uploaded'
  | 'renamed'
  | 'deleted'
  | 'moved'
  | 'includeUpdated'
  | 'includeAdded'
  | 'includeAlreadyAdded'
  | 'includeRemoved'
  | 'includeNotFound'
  | null

function directoryEntries(result: MoonrakerDirectoryResult): MachineFileEntry[] {
  const directories = result.dirs.map((entry) => ({
    kind: 'directory' as const,
    name: entry.dirname,
    modified: entry.modified,
    size: entry.size,
    permissions: entry.permissions,
  }))
  const files = result.files.map((entry) => ({
    kind: 'file' as const,
    name: entry.filename,
    modified: entry.modified,
    size: entry.size,
    permissions: entry.permissions,
  }))
  const byName = (left: MachineFileEntry, right: MachineFileEntry) =>
    left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  return [...directories.sort(byName), ...files.sort(byName)]
}

export { PRIMARY_CONFIG }

function joinPath(...parts: string[]): string {
  return normalizeMoonrakerRelativePath(parts.filter(Boolean).join('/'))
}

export const useMachineFilesStore = defineStore('machineFiles', () => {
  const availability = useAvailabilityStore()
  const moonraker = useMoonrakerStore()
  /*
   * Which Moonraker root the workspace is browsing. Configuration is what this
   * destination is for, and `logs` rides along because a log is a text file and
   * the workspace that shows text files well should show them — see
   * `docs/design/navigation-plan.md`.
   */
  const currentRoot = ref<MachineFileRoot>('config')
  /*
   * Only the config root is editable. Moonraker serves logs read-only and there
   * is nothing in a log to save, so every write path checks this rather than
   * relying on the reported permissions alone: a root that answered `rw` by
   * mistake must still not be written to from here.
   */
  const isRootEditable = computed(() => currentRoot.value === 'config')
  /*
   * Whether a config file has been written since Klipper last read its config.
   *
   * Saving is not applying: `printer.cfg` on disk changes the moment Save
   * finishes, and Klipper goes on running the config it loaded at startup until a
   * firmware restart. The editor's own "Save and restart" disables itself the
   * instant the buffer is clean, so after a plain Save nothing on screen said the
   * change had not taken effect yet — which is how a value gets edited, saved,
   * and then measured against a printer still running the old one.
   *
   * Local knowledge rather than a Klipper fact: nothing in Moonraker reports
   * "the file on disk differs from what I loaded". It is set when we write and
   * cleared when Klipper comes back up, whoever restarted it. A page reload
   * loses it, which is the one gap — reloading is rare, and the alternative
   * (persisting it per printer) cannot tell a first connection from a restart
   * without more bookkeeping than the reminder is worth.
   */
  const hasUnappliedConfigChanges = ref(false)
  const currentPath = ref('')
  const entries = ref<MachineFileEntry[]>([])
  const searchFiles = ref<OpenMachineFile[]>([])
  const searchFilesLoaded = ref(false)
  /*
   * The content-search results for `contentSearchQuery`, kept apart from
   * `searchFiles`'s name match so a component can tell the two searches'
   * results apart without re-deriving which query either one answers.
   */
  const contentSearchMatches = ref<Set<string>>(new Set())
  const contentSearchQuery = ref('')
  const isSearchingFileContents = ref(false)
  let contentSearchGeneration = 0
  const diskUsage = ref({ total: 0, used: 0, free: 0 })
  const rootPermissions = ref('r')
  const currentDirectoryPermissions = ref('r')
  const currentFile = ref<OpenMachineFile | null>(null)
  /*
   * Every text file the user has opened this session keeps its own in-memory
   * buffer here, keyed by path, for as long as the app stays loaded — not just
   * the currently open one. Switching files, folders, or pages never discards
   * an edit: only saving (which resyncs `saved` to `content`) or an explicit
   * discard clears the difference that makes a path count as dirty.
   *
   * `origin` is what disk held when the path was first read this session, and
   * it is what lets the editor's gutter separate an edit still only in the
   * browser from one already written to the printer: a save moves `saved` up to
   * `content` and deliberately leaves `origin` behind, so the line keeps a mark
   * saying it was touched. Only a fresh read of the file moves `origin`.
   */
  const fileBuffers = ref(new Map<string, MachineFileBuffer>())
  /*
   * A file opened from a read-only root is shown from here and never given a
   * buffer entry. Keeping the buffer map to one root is what makes a collision
   * impossible rather than merely handled: buffers are keyed by path, so a log
   * and a config file sharing a filename would otherwise share one buffer — and
   * the failure mode of that is a log's text being saved over a config file.
   */
  const viewerContent = ref('')
  /*
   * An HTML file is never buffered for editing — the config root doesn't
   * offer HTML as a writable type in the first place — so its fetched source
   * lives here rather than in `fileBuffers` or `viewerContent`, both of which
   * are read through `isRootEditable` and would answer for the wrong root.
   */
  const htmlContent = ref('')
  const imageCacheBust = ref(0)
  const isDirectoryLoading = ref(false)
  const isEditorLoading = ref(false)
  const isMutating = ref(false)
  const lastError = ref<MachineFileError>(null)
  const notice = ref<MachineFileNotice>(null)
  let directoryGeneration = 0
  let fileGeneration = 0
  let started = false
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let searchFilesRequest: Promise<void> | null = null
  let stopAvailabilityWatch: WatchStopHandle | null = null
  let stopFileNotifications: (() => void) | null = null
  let stopPrinterChangeReset: (() => void) | null = null
  const permissionsByPath = new Map<string, string>()
  /*
   * Every folder listing the explorer tree holds, keyed by path within the
   * root ('' is the root itself). The browsed folder's listing is also
   * `entries`; the rest belong to folders expanded in the tree, and each one is
   * refreshed with the browsed folder so an expanded folder never goes stale
   * behind a notification that only said "something changed".
   */
  const directoryListings = ref(new Map<string, MachineFileEntry[]>())
  const expandedDirectories = ref(new Set<string>())
  /*
   * Tabs of the root currently browsed, in the order they were opened. The
   * other root's tabs wait in `tabsByRoot` until it is browsed again, since a
   * tab names a path and a path means a different file in each root.
   */
  const openTabs = ref<MachineFileTab[]>([])
  const tabsByRoot = new Map<
    MachineFileRoot,
    { tabs: MachineFileTab[]; activePath: string | null; expanded: Set<string> }
  >()
  const includedConfigPaths = ref<Set<string>>(new Set())
  const includedConfigPathsReady = ref(false)
  let includedPathsGeneration = 0

  /*
   * `editorContent`/`savedContent` are the reactive window onto the current
   * file's own buffer entry: reading and writing them (the textarea's
   * v-model, an include rewrite, a test poking state directly) transparently
   * reads and writes `fileBuffers`, so there is exactly one source of truth
   * for "what does this path currently look like" whether or not it happens
   * to be the open file. Nothing is open only when `currentFile` is null.
   */
  const editorContent = computed<string>({
    get: () => {
      if (!currentFile.value) return ''
      if (!isRootEditable.value) return viewerContent.value
      return fileBuffers.value.get(currentFile.value.path)?.content ?? ''
    },
    set: (content) => {
      const file = currentFile.value
      if (!file || !isRootEditable.value) return
      const buffer = fileBuffers.value.get(file.path)
      fileBuffers.value.set(file.path, {
        content,
        saved: buffer?.saved ?? '',
        origin: buffer?.origin ?? '',
      })
    },
  })
  const savedContent = computed<string>({
    get: () => {
      if (!currentFile.value) return ''
      // Equal to the shown content, so a read-only file is never dirty.
      if (!isRootEditable.value) return viewerContent.value
      return fileBuffers.value.get(currentFile.value.path)?.saved ?? ''
    },
    set: (saved) => {
      const file = currentFile.value
      if (!file || !isRootEditable.value) return
      const buffer = fileBuffers.value.get(file.path)
      fileBuffers.value.set(file.path, {
        content: buffer?.content ?? '',
        saved,
        origin: buffer?.origin ?? '',
      })
    },
  })
  /*
   * What disk held for the open file when it was first read this session. Read
   * only — nothing outside a fresh read of the file may move a baseline whose
   * whole job is to stay put across saves.
   */
  const originContent = computed(() => {
    if (!currentFile.value) return ''
    if (!isRootEditable.value) return viewerContent.value
    return fileBuffers.value.get(currentFile.value.path)?.origin ?? ''
  })
  const isDirty = computed(
    () => currentFile.value !== null && editorContent.value !== savedContent.value,
  )
  /*
   * Whether `path` has edits in memory that differ from its last-saved content.
   * The open file needs no special case: `editorContent` writes into the same
   * buffer entry this reads, so an unsaved edit looks identical whether or not
   * the editor happens to be showing it.
   */
  function isPathDirty(path: string): boolean {
    const buffer = fileBuffers.value.get(path)
    return buffer !== undefined && buffer.content !== buffer.saved
  }
  /*
   * Every path with edits in memory, in the order they were first opened, so
   * the Save all / Discard all confirmations can list exactly what they are
   * about to touch rather than a bare count.
   */
  const unsavedFilePaths = computed(() =>
    [...fileBuffers.value.entries()]
      .filter(([, buffer]) => buffer.content !== buffer.saved)
      .map(([path]) => path),
  )
  const hasUnsavedFiles = computed(() => unsavedFilePaths.value.length > 0)
  /** Whether any buffered path other than `path` itself is dirty. */
  function hasOtherUnsavedFiles(path: string): boolean {
    return unsavedFilePaths.value.some((candidate) => candidate !== path)
  }
  /*
   * Whether anything unsaved lives inside the directory at `path`, so a folder
   * row can carry the same caution color as the files it contains — an edit two
   * levels down is still invisible from the row that hides it.
   */
  function hasUnsavedFilesUnder(path: string): boolean {
    const prefix = path === '' ? '' : path + '/'
    return unsavedFilePaths.value.some((candidate) => candidate.startsWith(prefix))
  }
  /** Moves (or, with `nextPath` null, drops) every buffer at or under `previousPath`. */
  function repointBuffers(previousPath: string, nextPath: string | null): void {
    const moved: Array<[string, MachineFileBuffer]> = []
    for (const [path, buffer] of fileBuffers.value) {
      if (path !== previousPath && !path.startsWith(previousPath + '/')) continue
      fileBuffers.value.delete(path)
      if (nextPath !== null) moved.push([nextPath + path.slice(previousPath.length), buffer])
    }
    for (const [path, buffer] of moved) fileBuffers.value.set(path, buffer)
  }
  const directoryRpcPath = computed(() => joinPath(currentRoot.value, currentPath.value))
  const currentFileKind = computed<MachineFileKind | null>(() =>
    currentFile.value ? classifyFileKind(currentFile.value.name) : null,
  )
  const currentImageUrl = computed(() =>
    currentFile.value && currentFileKind.value === 'image'
      ? `${moonrakerFileUrl(currentRoot.value, currentFile.value.path, moonraker.endpoint)}?t=${imageCacheBust.value}`
      : null,
  )
  /*
   * Handed to the viewer as a `srcdoc` document rather than pointing an
   * iframe at the file's URL: Moonraker's file-download endpoint answers
   * every GET with `Content-Disposition: attachment`, which a browser
   * respects for a frame *navigation* by triggering a download and leaving
   * the frame blank — the same header `<img>` and `fetch` both ignore, which
   * is why images and the text editor never hit this. A `<base>` pointed at
   * the file's own folder keeps its relative asset references resolving
   * against Moonraker rather than against `about:srcdoc`.
   */
  const currentHtmlDocument = computed(() => {
    if (!currentFile.value || currentFileKind.value !== 'html') return null
    const fileUrl = moonrakerFileUrl(currentRoot.value, currentFile.value.path, moonraker.endpoint)
    return withBaseHref(htmlContent.value, fileUrl.slice(0, fileUrl.lastIndexOf('/') + 1))
  })

  function clearFeedback(): void {
    lastError.value = null
    notice.value = null
  }

  /** Records a listing for the tree, and the permissions of the folders it names. */
  function storeListing(path: string, result: MoonrakerDirectoryResult): MachineFileEntry[] {
    const listing = directoryEntries(result)
    directoryListings.value.set(path, listing)
    rootPermissions.value = result.root_info?.permissions ?? rootPermissions.value
    permissionsByPath.set('', rootPermissions.value)
    for (const directory of result.dirs) {
      permissionsByPath.set(joinPath(path, directory.dirname), directory.permissions)
    }
    return listing
  }

  /*
   * Commits a fetched directory listing for `path` in one synchronous pass —
   * entries, disk usage, permissions — so a render never catches it half
   * applied. Callers control what else changes in that same pass: a same-folder
   * refresh leaves currentPath alone, a navigation sets it right before this
   * runs, so the old folder never mixes with the new one across a frame.
   */
  function applyDirectoryResult(path: string, result: MoonrakerDirectoryResult): void {
    entries.value = storeListing(path, result)
    diskUsage.value = result.disk_usage
    currentDirectoryPermissions.value = permissionsByPath.get(path) ?? rootPermissions.value
  }

  /*
   * Every listing the tree shows besides the browsed folder's: the root, and
   * each expanded folder. A folder that no longer answers has been removed or
   * renamed under us, so it stops being expanded rather than being retried on
   * every refresh.
   */
  async function refreshTreeListings(): Promise<void> {
    if (!availability.isMoonrakerConnected) return
    const root = currentRoot.value
    const paths = new Set(['', ...expandedDirectories.value])
    paths.delete(currentPath.value)
    await Promise.all(
      [...paths].map(async (path) => {
        try {
          const result = await moonraker.rpcCall('server.files.get_directory', {
            path: joinPath(root, path),
          })
          if (root !== currentRoot.value) return
          storeListing(path, result)
          if (path === '') diskUsage.value = result.disk_usage
        } catch {
          if (root !== currentRoot.value || path === '') return
          expandedDirectories.value.delete(path)
          directoryListings.value.delete(path)
        }
      }),
    )
  }

  async function refreshDirectory(): Promise<boolean> {
    if (!availability.isMoonrakerConnected) return false
    const generation = ++directoryGeneration
    isDirectoryLoading.value = true
    lastError.value = null
    void refreshTreeListings()
    try {
      const result = await moonraker.rpcCall('server.files.get_directory', {
        path: directoryRpcPath.value,
      })
      if (generation !== directoryGeneration) return false
      applyDirectoryResult(currentPath.value, result)
      if (searchFilesLoaded.value) void refreshSearchFiles(true)
      return true
    } catch {
      if (generation === directoryGeneration) lastError.value = 'directory'
      return false
    } finally {
      if (generation === directoryGeneration) isDirectoryLoading.value = false
    }
  }

  /**
   * Opens a folder in the tree. A listing already held is shown at once and
   * refreshed behind it, so expanding a folder again never blanks it first.
   */
  async function expandDirectory(path: string): Promise<boolean> {
    const normalized = normalizeMoonrakerRelativePath(path)
    if (normalized === '') return true
    const root = currentRoot.value
    expandedDirectories.value.add(normalized)
    if (!availability.isMoonrakerConnected) return directoryListings.value.has(normalized)
    try {
      const result = await moonraker.rpcCall('server.files.get_directory', {
        path: joinPath(root, normalized),
      })
      if (root !== currentRoot.value) return false
      storeListing(normalized, result)
      return true
    } catch {
      if (root === currentRoot.value) expandedDirectories.value.delete(normalized)
      return false
    }
  }

  function collapseDirectory(path: string): void {
    expandedDirectories.value.delete(normalizeMoonrakerRelativePath(path))
  }

  /** Expands every folder above `path`, so the file or folder it names is on screen. */
  async function revealPath(path: string): Promise<void> {
    const segments = normalizeMoonrakerRelativePath(path).split('/').slice(0, -1)
    await Promise.all(
      segments.map((_, index) => expandDirectory(segments.slice(0, index + 1).join('/'))),
    )
  }

  function collapseAllDirectories(): void {
    expandedDirectories.value.clear()
  }

  /*
   * Makes `path` the folder new files, folders, and uploads land in, without
   * a round trip when the tree already holds its listing.
   */
  async function selectDirectory(path: string): Promise<boolean> {
    const normalized = normalizeMoonrakerRelativePath(path)
    const listing = directoryListings.value.get(normalized)
    if (!listing) return navigate(normalized)
    directoryGeneration += 1
    isDirectoryLoading.value = false
    currentPath.value = normalized
    entries.value = listing
    currentDirectoryPermissions.value = permissionsByPath.get(normalized) ?? rootPermissions.value
    return true
  }

  function refreshSearchFiles(force = false): Promise<void> {
    if (!availability.isMoonrakerConnected || (searchFilesLoaded.value && !force)) {
      return Promise.resolve()
    }
    if (searchFilesRequest && !force) return searchFilesRequest
    searchFilesRequest = (async () => {
      try {
        const files = await moonraker.rpcCall('server.files.list', { root: currentRoot.value })
        searchFiles.value = files.map((file) => {
          const path = normalizeMoonrakerRelativePath(file.path)
          const segments = path.split('/')
          return {
            kind: 'file' as const,
            name: segments.at(-1) ?? path,
            path,
            modified: file.modified,
            size: file.size,
            permissions: file.permissions ?? permissionsByPath.get(path) ?? 'r',
          }
        })
        searchFilesLoaded.value = true
      } catch {
        // Directory browsing remains available when the optional search index is unavailable.
      } finally {
        searchFilesRequest = null
      }
    })()
    return searchFilesRequest
  }

  /**
   * Switches which root is browsed. Buffers are deliberately kept: an unsaved
   * config edit surviving a trip to the logs is the same promise the workspace
   * already makes about switching files, folders, and pages.
   */
  async function setRoot(root: MachineFileRoot): Promise<boolean> {
    if (root === currentRoot.value) return true
    tabsByRoot.set(currentRoot.value, {
      tabs: openTabs.value,
      activePath: currentFile.value?.path ?? null,
      expanded: new Set(expandedDirectories.value),
    })
    currentRoot.value = root
    closeFile()
    viewerContent.value = ''
    htmlContent.value = ''
    currentPath.value = ''
    entries.value = []
    // The search index, the per-path permissions, and the tree's listings all
    // describe the root that was being browsed, so carrying any of them across
    // would answer questions about one root with facts about the other.
    searchFiles.value = []
    searchFilesLoaded.value = false
    clearContentSearch()
    permissionsByPath.clear()
    directoryListings.value = new Map()
    const restored = tabsByRoot.get(root)
    expandedDirectories.value = new Set(restored?.expanded)
    openTabs.value = restored?.tabs ?? []
    const listed = await refreshDirectory()
    if (restored?.activePath && currentRoot.value === root) {
      const tab = openTabs.value.find((candidate) => candidate.file.path === restored.activePath)
      if (tab) await openFileByPath(tab.file, { preview: tab.preview })
    }
    return listed
  }

  function ensureSearchFiles(): Promise<void> {
    return refreshSearchFiles()
  }

  function clearContentSearch(): void {
    contentSearchGeneration += 1
    contentSearchQuery.value = ''
    contentSearchMatches.value = new Set()
    isSearchingFileContents.value = false
  }

  /**
   * Extends the name-only match `filteredEntries` does client-side to the text
   * of every reasonably small text file under the current root. Content is read
   * from `fileBuffers` first, so a match reflects an unsaved edit the same way
   * the editor is currently showing it, and is fetched from Moonraker only for
   * a path with nothing buffered — never cached past that, since a save,
   * rename, or delete would otherwise need to know to invalidate it.
   */
  async function searchFileContents(query: string): Promise<void> {
    const trimmed = query.trim()
    const generation = ++contentSearchGeneration
    if (!trimmed) {
      contentSearchQuery.value = ''
      contentSearchMatches.value = new Set()
      isSearchingFileContents.value = false
      return
    }
    await ensureSearchFiles()
    if (generation !== contentSearchGeneration) return
    const needle = trimmed.toLocaleLowerCase()
    const candidates = searchFiles.value.filter(
      (file) => classifyFileKind(file.name) === 'text' && !isLargeFile('text', file.size),
    )
    isSearchingFileContents.value = true
    const matches = new Set<string>()
    await Promise.all(
      candidates.map(async (file) => {
        const buffered = isRootEditable.value
          ? fileBuffers.value.get(file.path)?.content
          : undefined
        let content = buffered
        if (content === undefined) {
          try {
            content = await fetchMoonrakerTextFile(currentRoot.value, file.path, moonraker.endpoint)
          } catch {
            return
          }
        }
        if (content.toLocaleLowerCase().includes(needle)) matches.add(file.path)
      }),
    )
    if (generation !== contentSearchGeneration) return
    contentSearchQuery.value = trimmed
    contentSearchMatches.value = matches
    isSearchingFileContents.value = false
  }

  /*
   * Switches folders without ever rendering a frame in between: the old
   * folder's entries, breadcrumb, and permissions all stay exactly as they
   * are — not cleared, not guessed at — until the new folder's listing has
   * fully arrived, at which point currentPath and the listing are set in the
   * same synchronous pass. One frame is the old folder, the next is the new
   * one, fully populated.
   */
  async function navigate(path: string): Promise<boolean> {
    const normalized = normalizeMoonrakerRelativePath(path)
    if (normalized === currentPath.value) return refreshDirectory()
    if (!availability.isMoonrakerConnected) return false
    const generation = ++directoryGeneration
    isDirectoryLoading.value = true
    lastError.value = null
    try {
      const result = await moonraker.rpcCall('server.files.get_directory', {
        path: joinPath(currentRoot.value, normalized),
      })
      if (generation !== directoryGeneration) return false
      currentPath.value = normalized
      applyDirectoryResult(normalized, result)
      if (searchFilesLoaded.value) void refreshSearchFiles(true)
      return true
    } catch {
      if (generation === directoryGeneration) lastError.value = 'directory'
      return false
    } finally {
      if (generation === directoryGeneration) isDirectoryLoading.value = false
    }
  }

  async function enterDirectory(name: string): Promise<boolean> {
    if (!validMoonrakerFilename(name)) return false
    return navigate(joinPath(currentPath.value, name))
  }

  /*
   * Gives the file just shown a tab, or refreshes the one it already has. A
   * preview open reuses the preview tab in place, so browsing replaces one tab
   * rather than piling them up; a kept open promotes a preview tab, never the
   * other way round. A file with unsaved edits is never a preview, since
   * replacing its tab would hide the only sign on the tab row that it has any.
   */
  function registerTab(file: OpenMachineFile, preview: boolean): void {
    const index = openTabs.value.findIndex((tab) => tab.file.path === file.path)
    if (index >= 0) {
      const existing = openTabs.value[index]!
      openTabs.value.splice(index, 1, { file, preview: existing.preview && preview })
      return
    }
    const asPreview = preview && !isPathDirty(file.path)
    const previewIndex = asPreview ? openTabs.value.findIndex((tab) => tab.preview) : -1
    if (previewIndex >= 0) openTabs.value.splice(previewIndex, 1, { file, preview: true })
    else openTabs.value.push({ file, preview: asPreview })
  }

  function showFile(file: OpenMachineFile, preview: boolean): void {
    currentFile.value = file
    registerTab(file, preview)
  }

  /*
   * The one way a file is opened, whether its path came from the browsed
   * folder, a tree row, a tab, a pin, or an include — so there is never a
   * second, divergent way to load a file.
   */
  async function openFileAtPath(
    path: string,
    entry: MachineFileEntry,
    { preview = false }: OpenFileOptions = {},
  ): Promise<boolean> {
    const generation = ++fileGeneration
    const file: OpenMachineFile = { ...entry, kind: 'file', path }
    const kind = classifyFileKind(entry.name)
    if (kind === 'image') {
      showFile(file, preview)
      imageCacheBust.value += 1
      lastError.value = null
      isEditorLoading.value = false
      return true
    }

    // A dirty buffer already holds the edit that matters; reopening it must
    // never refetch over it. A read-only root has no buffers to consult.
    const existing = isRootEditable.value ? fileBuffers.value.get(path) : undefined
    if (existing && existing.content !== existing.saved) {
      showFile(file, preview)
      lastError.value = null
      isEditorLoading.value = false
      return true
    }
    /*
     * A clean buffer is a cache of what disk held last time. It is shown at
     * once — switching tabs must not dim the editor for a fetch every time —
     * and refreshed behind it in case something else changed the file while it
     * was not shown. The refresh only lands while the buffer is still clean, so
     * an edit typed during the fetch is never overwritten.
     */
    if (existing && kind === 'text') {
      showFile(file, preview)
      lastError.value = null
      isEditorLoading.value = false
      const root = currentRoot.value
      void fetchMoonrakerTextFile(root, path, moonraker.endpoint).then(
        (content) => {
          const buffer = fileBuffers.value.get(path)
          if (root !== currentRoot.value || !buffer || buffer.content !== buffer.saved) return
          if (buffer.saved !== content)
            fileBuffers.value.set(path, { content, saved: content, origin: content })
        },
        () => undefined,
      )
      return true
    }

    isEditorLoading.value = true
    lastError.value = null
    try {
      const content = await fetchMoonrakerTextFile(currentRoot.value, path, moonraker.endpoint)
      if (generation !== fileGeneration) return false
      if (kind === 'html') htmlContent.value = content
      else if (isRootEditable.value)
        fileBuffers.value.set(path, { content, saved: content, origin: content })
      else viewerContent.value = content
      showFile(file, preview)
      return true
    } catch {
      if (generation === fileGeneration) lastError.value = 'file'
      return false
    } finally {
      if (generation === fileGeneration) isEditorLoading.value = false
    }
  }

  async function openFile(entry: MachineFileEntry, options?: OpenFileOptions): Promise<boolean> {
    if (entry.kind !== 'file' || !validMoonrakerFilename(entry.name)) return false
    return openFileAtPath(entry.path ?? joinPath(currentPath.value, entry.name), entry, options)
  }

  /*
   * Opens a file at its own path without moving the explorer: a tab, a pin, or
   * an include names a file wherever it lives, and following it into the
   * viewer should not also drag the browsed folder along behind it.
   */
  async function openFileByPath(
    file: OpenMachineFile,
    options?: OpenFileOptions,
  ): Promise<boolean> {
    if (!validMoonrakerFilename(file.name)) return false
    return openFileAtPath(file.path, file, options)
  }

  /** Stops showing a file without closing its tab. */
  function closeFile(): void {
    fileGeneration += 1
    currentFile.value = null
    isEditorLoading.value = false
    clearFeedback()
  }

  /** Turns the preview tab for `path` into a kept one. */
  function keepTab(path: string): void {
    const index = openTabs.value.findIndex((tab) => tab.file.path === path)
    const tab = openTabs.value[index]
    if (!tab?.preview) return
    openTabs.value.splice(index, 1, { ...tab, preview: false })
  }

  /*
   * Puts a kept tab for `file` first among the tabs, opening nothing: an
   * unpinned file drops from the pinned row to the start of the rest, whether
   * or not it had been opened this session.
   */
  function placeTabFirst(file: OpenMachineFile): void {
    const existing = openTabs.value.find((tab) => tab.file.path === file.path)
    openTabs.value = [
      { file: existing?.file ?? file, preview: false },
      ...openTabs.value.filter((tab) => tab.file.path !== file.path),
    ]
  }

  async function activateTab(path: string): Promise<boolean> {
    const tab = openTabs.value.find((candidate) => candidate.file.path === path)
    if (!tab) return false
    if (currentFile.value?.path === path) return true
    return openFileByPath(tab.file, { preview: tab.preview })
  }

  /*
   * Closing a tab never touches its buffer: an unsaved edit outlives the tab
   * exactly as it outlives switching files, and the explorer keeps marking it.
   * When the tab being closed is the one shown, its right-hand neighbour takes
   * over, or its left-hand one at the end of the row — the neighbour the
   * reader's eye is already on.
   */
  async function closeTabs(paths: readonly string[]): Promise<void> {
    const closing = new Set(paths)
    const activePath = currentFile.value?.path ?? null
    const activeIndex = openTabs.value.findIndex((tab) => tab.file.path === activePath)
    openTabs.value = openTabs.value.filter((tab) => !closing.has(tab.file.path))
    if (activePath === null || !closing.has(activePath)) return
    const next = openTabs.value[Math.min(activeIndex, openTabs.value.length - 1)]
    if (next) await openFileByPath(next.file, { preview: next.preview })
    else closeFile()
  }

  function closeTab(path: string): Promise<void> {
    return closeTabs([path])
  }

  /** Moves (or, with `nextPath` null, closes) every tab at or under `previousPath`. */
  function repointTabs(previousPath: string, nextPath: string | null): void {
    const tabs: MachineFileTab[] = []
    for (const tab of openTabs.value) {
      const path = tab.file.path
      if (path !== previousPath && !path.startsWith(previousPath + '/')) {
        tabs.push(tab)
        continue
      }
      if (nextPath === null) continue
      const moved = nextPath + path.slice(previousPath.length)
      tabs.push({
        ...tab,
        file: { ...tab.file, path: moved, name: moved.slice(moved.lastIndexOf('/') + 1) },
      })
    }
    openTabs.value = tabs
  }

  /** Drops the in-memory edit at `path`, restoring it to its last-saved content. */
  function discardChangesAt(path: string): void {
    const buffer = fileBuffers.value.get(path)
    if (!buffer) return
    fileBuffers.value.set(path, { ...buffer, content: buffer.saved })
  }

  /** Drops the current file's in-memory edit, restoring it to its last-saved content. */
  function discardCurrentFileChanges(): void {
    if (currentFile.value) discardChangesAt(currentFile.value.path)
  }

  /** Drops every in-memory edit, across every file opened this session. */
  function discardAllChanges(): void {
    for (const path of unsavedFilePaths.value) discardChangesAt(path)
  }

  /**
   * Uploads `content` as the text file at `path`, relative to the config root.
   * Pinned to that root rather than the browsed one: everything this writes is a
   * configuration file, and a save must not follow the user into a log folder.
   */
  async function uploadFileContent(path: string, content: string): Promise<void> {
    if (!isRootEditable.value) throw new Error('The browsed root is read-only')
    await uploadConfigFile(path, content)
  }

  async function uploadConfigFile(path: string, content: string): Promise<void> {
    const segments = path.split('/')
    const filename = segments.pop()
    if (!filename) throw new Error(`Invalid path: ${path}`)
    await uploadMoonrakerFile(
      'config',
      segments.join('/'),
      new Blob([content], { type: 'text/plain;charset=utf-8' }),
      filename,
      moonraker.endpoint,
    )
  }

  /*
   * A firmware restart, not Klipper's plain RESTART: a configuration edit can
   * change values the MCU only reads while connecting, so reloading the config
   * without reinitializing the firmware would leave the printer running against
   * settings the file no longer describes. This is the same
   * `printer.firmware_restart` the header's power menu issues.
   */
  async function firmwareRestartNow(): Promise<boolean> {
    try {
      await moonraker.rpcCall('printer.firmware_restart')
      hasUnappliedConfigChanges.value = false
      return true
    } catch {
      lastError.value = 'restart'
      return false
    }
  }

  async function saveFile(restartFirmware = false): Promise<boolean> {
    if (!isRootEditable.value) return false
    if (
      !currentFile.value ||
      classifyFileKind(currentFile.value.name) !== 'text' ||
      !currentFile.value.permissions.includes('w') ||
      !availability.isMoonrakerConnected ||
      isMutating.value
    )
      return false
    const file = currentFile.value
    const content = editorContent.value
    isMutating.value = true
    clearFeedback()
    try {
      await uploadFileContent(file.path, content)
      fileBuffers.value.set(file.path, {
        content,
        saved: content,
        origin: fileBuffers.value.get(file.path)?.origin ?? content,
      })
      currentFile.value = { ...file, modified: Date.now() / 1000, size: new Blob([content]).size }
      if (file.path === PRIMARY_CONFIG) applyIncludedConfigPaths(content)
      hasUnappliedConfigChanges.value = true
      notice.value = restartFirmware ? 'savedRestarting' : 'saved'
      if (restartFirmware && !(await firmwareRestartNow())) return false
      void refreshDirectory()
      return true
    } catch {
      lastError.value = 'save'
      return false
    } finally {
      isMutating.value = false
    }
  }

  /*
   * Saves every dirty buffer, not just the open file — used ahead of a
   * restart so a config edit sitting unsaved in a file that isn't currently
   * open still reaches disk before Klipper reloads it. A failure partway
   * through leaves the failed paths dirty (and skips the restart) rather than
   * losing track of which edits actually made it to disk.
   */
  async function saveAllFiles(restartFirmware = false): Promise<boolean> {
    if (!isRootEditable.value) return false
    if (!availability.isMoonrakerConnected || isMutating.value) return false
    const dirtyPaths = [...fileBuffers.value.entries()]
      .filter(([, buffer]) => buffer.content !== buffer.saved)
      .map(([path]) => path)
    isMutating.value = true
    clearFeedback()
    let allSaved = true
    try {
      for (const path of dirtyPaths) {
        const buffer = fileBuffers.value.get(path)
        if (!buffer) continue
        try {
          await uploadFileContent(path, buffer.content)
          fileBuffers.value.set(path, { ...buffer, saved: buffer.content })
          if (currentFile.value?.path === path) {
            currentFile.value = {
              ...currentFile.value,
              modified: Date.now() / 1000,
              size: new Blob([buffer.content]).size,
            }
          }
          if (path === PRIMARY_CONFIG) applyIncludedConfigPaths(buffer.content)
        } catch {
          allSaved = false
        }
      }
      if (!allSaved) {
        lastError.value = 'saveAll'
        return false
      }
      hasUnappliedConfigChanges.value = true
      notice.value = restartFirmware ? 'savedAllRestarting' : 'savedAll'
      if (restartFirmware && !(await firmwareRestartNow())) return false
      void refreshDirectory()
      return true
    } finally {
      isMutating.value = false
    }
  }

  /*
   * Quick config edits the same files the editor does, through these same
   * buffers, so the two views can never race each other to disk: an edit made
   * in either one marks the file unsaved in both, and whichever saves writes
   * both edits. Everything below is pinned to the config root rather than the
   * browsed one, because Quick config reads configuration whatever the file
   * browser happens to be showing.
   */

  /** Every file in the config root, relative to it. */
  async function listConfigFiles(): Promise<string[]> {
    const files = await moonraker.rpcCall('server.files.list', { root: 'config' })
    return files.map((file) => normalizeMoonrakerRelativePath(file.path))
  }

  /** The buffer for a config file, or undefined if it has never been loaded. */
  function configBuffer(path: string): MachineFileBuffer | undefined {
    return fileBuffers.value.get(path)
  }

  /**
   * Reads each file from disk into its buffer. A dirty buffer is left alone,
   * since it already holds the edit that matters; a clean one is refreshed in
   * case something else changed the file.
   */
  async function loadConfigFiles(paths: readonly string[]): Promise<boolean> {
    let allLoaded = true
    await Promise.all(
      paths.map(async (path) => {
        if (isPathDirty(path)) return
        try {
          const content = await fetchMoonrakerTextFile('config', path, moonraker.endpoint)
          if (isPathDirty(path)) return
          fileBuffers.value.set(path, { content, saved: content, origin: content })
        } catch {
          allLoaded = false
        }
      }),
    )
    return allLoaded
  }

  function setConfigBufferContent(path: string, content: string): void {
    const buffer = fileBuffers.value.get(path)
    if (!buffer) return
    fileBuffers.value.set(path, { ...buffer, content })
  }

  /**
   * Writes the named files that have unsaved edits, then optionally restarts.
   * Like `saveAllFiles`, a failure leaves the failed paths dirty and skips the
   * restart, so a restart never runs against a config half written.
   */
  async function saveConfigFiles(
    paths: readonly string[],
    restartFirmware = false,
  ): Promise<boolean> {
    if (!availability.isMoonrakerConnected || isMutating.value) return false
    isMutating.value = true
    clearFeedback()
    let allSaved = true
    try {
      for (const path of paths) {
        const buffer = fileBuffers.value.get(path)
        if (!buffer || buffer.content === buffer.saved) continue
        try {
          await uploadConfigFile(path, buffer.content)
          fileBuffers.value.set(path, { ...buffer, saved: buffer.content })
          if (path === PRIMARY_CONFIG) applyIncludedConfigPaths(buffer.content)
          hasUnappliedConfigChanges.value = true
        } catch {
          allSaved = false
        }
      }
      if (!allSaved) {
        lastError.value = 'saveAll'
        return false
      }
      if (restartFirmware && !(await firmwareRestartNow())) return false
      if (isRootEditable.value) void refreshDirectory()
      return true
    } finally {
      isMutating.value = false
    }
  }

  async function createFile(name: string): Promise<boolean> {
    if (!isRootEditable.value) return false
    const filename = name.trim()
    if (!validMoonrakerFilename(filename) || !availability.isMoonrakerConnected) {
      lastError.value = 'mutation'
      return false
    }
    isMutating.value = true
    clearFeedback()
    try {
      await uploadMoonrakerFile(
        currentRoot.value,
        currentPath.value,
        new Blob([''], { type: 'text/plain;charset=utf-8' }),
        filename,
        moonraker.endpoint,
      )
      notice.value = 'created'
      await refreshDirectory()
      const created = entries.value.find(
        (entry) => entry.kind === 'file' && entry.name === filename,
      )
      if (created) await openFile(created)
      return true
    } catch {
      lastError.value = 'mutation'
      return false
    } finally {
      isMutating.value = false
    }
  }

  async function createDirectory(name: string): Promise<boolean> {
    if (!isRootEditable.value) return false
    const directoryName = name.trim()
    if (!validMoonrakerFilename(directoryName) || !availability.isMoonrakerConnected) {
      lastError.value = 'mutation'
      return false
    }
    isMutating.value = true
    clearFeedback()
    try {
      await moonraker.rpcCall('server.files.post_directory', {
        path: joinPath(directoryRpcPath.value, directoryName),
      })
      notice.value = 'created'
      await refreshDirectory()
      return true
    } catch {
      lastError.value = 'mutation'
      return false
    } finally {
      isMutating.value = false
    }
  }

  /**
   * Creates a directory at an arbitrary config-root-relative path, for the
   * editor's "create the missing folder" hotlink prompt — unlike
   * {@link createDirectory}, `path` isn't a bare name under the folder
   * currently browsed. `normalizeMoonrakerRelativePath` is what keeps this
   * safe: it rejects `..`, empty segments, and null bytes in every segment,
   * so the request can never land outside the config root.
   */
  async function createDirectoryAt(path: string): Promise<boolean> {
    if (!isRootEditable.value) return false
    let normalized: string
    try {
      normalized = normalizeMoonrakerRelativePath(path)
    } catch {
      normalized = ''
    }
    if (!normalized || !availability.isMoonrakerConnected) {
      lastError.value = 'mutation'
      return false
    }
    isMutating.value = true
    clearFeedback()
    try {
      await moonraker.rpcCall('server.files.post_directory', {
        path: joinPath(currentRoot.value, normalized),
      })
      notice.value = 'created'
      await refreshDirectory()
      return true
    } catch {
      lastError.value = 'mutation'
      return false
    } finally {
      isMutating.value = false
    }
  }

  /**
   * Creates an empty file at an arbitrary config-root-relative path — used to
   * fill in a broken `[include]` target from the editor's hotlink. Its
   * directory must already exist; the hotlink prompt creates that first when
   * it doesn't. Path safety is the same `normalizeMoonrakerRelativePath` used
   * everywhere else a path arrives from outside the current directory.
   */
  async function createFileAt(path: string): Promise<boolean> {
    if (!isRootEditable.value) return false
    let normalized: string
    try {
      normalized = normalizeMoonrakerRelativePath(path)
    } catch {
      normalized = ''
    }
    const filename = normalized.slice(normalized.lastIndexOf('/') + 1)
    if (!normalized || !validMoonrakerFilename(filename) || !availability.isMoonrakerConnected) {
      lastError.value = 'mutation'
      return false
    }
    isMutating.value = true
    clearFeedback()
    try {
      await uploadFileContent(normalized, '')
      notice.value = 'created'
      await refreshDirectory()
      return true
    } catch {
      lastError.value = 'mutation'
      return false
    } finally {
      isMutating.value = false
    }
  }

  async function uploadFiles(
    files: readonly File[],
    directory: string = currentPath.value,
  ): Promise<boolean> {
    if (!isRootEditable.value) return false
    if (files.length === 0 || !availability.isMoonrakerConnected) return false
    isMutating.value = true
    clearFeedback()
    try {
      for (const file of files) {
        if (!validMoonrakerFilename(file.name)) throw new Error('Invalid filename')
        await uploadMoonrakerFile(currentRoot.value, directory, file, file.name, moonraker.endpoint)
      }
      notice.value = 'uploaded'
      await refreshDirectory()
      return true
    } catch {
      lastError.value = 'mutation'
      return false
    } finally {
      isMutating.value = false
    }
  }

  /** Path of an entry within the browsed root: its own, or the browsed folder's joined with its name. */
  function entryPath(entry: MachineFileEntry): string {
    return entry.path ?? joinPath(currentPath.value, entry.name)
  }

  /*
   * A renamed, moved, or deleted folder takes its expanded state and cached
   * listings with it, and the browsed folder follows it rather than pointing
   * at a path that is gone.
   */
  function repointDirectoryState(previousPath: string, nextPath: string | null): void {
    const under = (path: string) => path === previousPath || path.startsWith(previousPath + '/')
    const moved = (path: string) =>
      nextPath === null ? null : nextPath + path.slice(previousPath.length)
    const expanded = new Set<string>()
    for (const path of expandedDirectories.value) {
      if (!under(path)) expanded.add(path)
      else if (moved(path) !== null) expanded.add(moved(path)!)
    }
    expandedDirectories.value = expanded
    for (const path of [...directoryListings.value.keys()]) {
      if (under(path)) directoryListings.value.delete(path)
    }
    if (under(currentPath.value) && currentPath.value !== '') {
      currentPath.value = moved(currentPath.value) ?? previousPath.split('/').slice(0, -1).join('/')
    }
  }

  function downloadUrlFor(entry: MachineFileEntry): string | null {
    if (entry.kind !== 'file') return null
    return moonrakerFileUrl(currentRoot.value, entryPath(entry), moonraker.endpoint)
  }

  /*
   * Keeps the viewer consistent with a path that just changed underneath it:
   * the file itself, or a folder it lives in. Renaming or moving the file being
   * edited must not leave the viewer, or any tab, pointed at a path the printer
   * no longer has.
   */
  function repointOpenFile(previousPath: string, nextPath: string | null): void {
    repointTabs(previousPath, nextPath)
    const file = currentFile.value
    if (!file || (file.path !== previousPath && !file.path.startsWith(previousPath + '/'))) return
    if (nextPath === null) {
      closeFile()
      return
    }
    const path = nextPath + file.path.slice(previousPath.length)
    currentFile.value = { ...file, path, name: path.slice(path.lastIndexOf('/') + 1) }
  }

  async function renameEntry(entry: MachineFileEntry, name: string): Promise<boolean> {
    if (!isRootEditable.value) return false
    const filename = name.trim()
    if (
      !validMoonrakerFilename(filename) ||
      filename === entry.name ||
      !availability.isMoonrakerConnected ||
      isMutating.value
    ) {
      lastError.value = 'mutation'
      return false
    }
    const previousPath = entryPath(entry)
    // Renamed where it lives, which is not always the folder being browsed.
    const nextPath = joinPath(previousPath.split('/').slice(0, -1).join('/'), filename)
    isMutating.value = true
    clearFeedback()
    try {
      await moonraker.rpcCall('server.files.move', {
        source: joinPath(currentRoot.value, previousPath),
        dest: joinPath(currentRoot.value, nextPath),
      })
      repointBuffers(previousPath, nextPath)
      repointOpenFile(previousPath, nextPath)
      repointDirectoryState(previousPath, nextPath)
      notice.value = 'renamed'
      await refreshDirectory()
      return true
    } catch {
      lastError.value = 'mutation'
      return false
    } finally {
      isMutating.value = false
    }
  }

  async function deleteEntry(entry: MachineFileEntry): Promise<boolean> {
    if (!isRootEditable.value) return false
    if (!availability.isMoonrakerConnected || isMutating.value) {
      lastError.value = 'mutation'
      return false
    }
    const path = entryPath(entry)
    isMutating.value = true
    clearFeedback()
    try {
      // Directories need the recursive endpoint; the file endpoint rejects them.
      if (entry.kind === 'directory') {
        await moonraker.rpcCall('server.files.delete_directory', {
          path: joinPath(currentRoot.value, path),
          force: true,
        })
      } else {
        await moonraker.rpcCall('server.files.delete_file', {
          path: joinPath(currentRoot.value, path),
        })
      }
      repointBuffers(path, null)
      repointOpenFile(path, null)
      repointDirectoryState(path, null)
      notice.value = 'deleted'
      await refreshDirectory()
      return true
    } catch {
      lastError.value = 'mutation'
      return false
    } finally {
      isMutating.value = false
    }
  }

  /*
   * Moves an entry into a destination directory relative to the config root, ''
   * meaning the root itself. Resolves to the new path so the caller can
   * reconcile an include that pointed at the old one.
   */
  async function moveEntryTo(
    entry: MachineFileEntry,
    destinationDirectory: string,
  ): Promise<{ previousPath: string; nextPath: string } | null> {
    if (!isRootEditable.value) return null
    if (!availability.isMoonrakerConnected || isMutating.value) {
      lastError.value = 'mutation'
      return null
    }
    const previousPath = entryPath(entry)
    const nextPath = joinPath(destinationDirectory, entry.name)
    // Moving onto its own location, or a directory into its own subtree, is a
    // no-op Moonraker would either reject or use to destroy the tree.
    if (nextPath === previousPath || nextPath.startsWith(previousPath + '/')) return null
    isMutating.value = true
    clearFeedback()
    try {
      await moonraker.rpcCall('server.files.move', {
        source: joinPath(currentRoot.value, previousPath),
        dest: joinPath(currentRoot.value, nextPath),
      })
      repointBuffers(previousPath, nextPath)
      repointOpenFile(previousPath, nextPath)
      repointDirectoryState(previousPath, nextPath)
      notice.value = 'moved'
      await refreshDirectory()
      return { previousPath, nextPath }
    } catch {
      lastError.value = 'mutation'
      return null
    } finally {
      isMutating.value = false
    }
  }

  /*
   * Reports the include in printer.cfg that points at `previousPath`, without
   * writing anything or requiring the move to have happened yet. The caller
   * decides whether to apply it: rewriting the printer configuration behind
   * the user's back is not ours to choose.
   */
  async function findIncludeUpdate(
    previousPath: string,
    nextPath: string,
  ): Promise<IncludeRewrite | null> {
    if (!availability.isMoonrakerConnected) return null
    try {
      const source = await fetchMoonrakerTextFile('config', PRIMARY_CONFIG, moonraker.endpoint)
      return findIncludeRewrite(source, PRIMARY_CONFIG, previousPath, nextPath)
    } catch {
      // An unreadable printer.cfg means there is simply no include to
      // reconcile, not that the move (if it happens) will fail.
      return null
    }
  }

  /*
   * Previews the include impact of moving `entry` to `destinationDirectory`
   * before anything moves, so the caller can warn the user first and let them
   * choose not to move the file at all.
   */
  async function checkMoveInclude(
    entry: MachineFileEntry,
    destinationDirectory: string,
  ): Promise<{ previousPath: string; nextPath: string; rewrite: IncludeRewrite | null }> {
    const previousPath = entryPath(entry)
    const nextPath = joinPath(destinationDirectory, entry.name)
    const rewrite =
      previousPath === nextPath ? null : await findIncludeUpdate(previousPath, nextPath)
    return { previousPath, nextPath, rewrite }
  }

  /** Writes back printer.cfg with an include rewrite the user accepted. */
  async function applyIncludeUpdate(content: string): Promise<boolean> {
    if (!availability.isMoonrakerConnected || isMutating.value) {
      lastError.value = 'mutation'
      return false
    }
    isMutating.value = true
    clearFeedback()
    try {
      await uploadMoonrakerFile(
        'config',
        '',
        new Blob([content], { type: 'text/plain;charset=utf-8' }),
        PRIMARY_CONFIG,
        moonraker.endpoint,
      )
      // The editor may be showing printer.cfg; keep it consistent with disk.
      if (currentFile.value?.path === PRIMARY_CONFIG) {
        editorContent.value = content
        savedContent.value = content
      }
      applyIncludedConfigPaths(content)
      notice.value = 'includeUpdated'
      await refreshDirectory()
      return true
    } catch {
      lastError.value = 'mutation'
      return false
    } finally {
      isMutating.value = false
    }
  }

  function applyIncludedConfigPaths(source: string): void {
    includedConfigPaths.value = resolvedIncludePaths(source, PRIMARY_CONFIG)
    includedConfigPathsReady.value = true
  }

  /*
   * Refreshes which files printer.cfg currently includes, for the faint tint
   * on their file icons. Always fire-and-forget: it must never sit in the
   * await chain of refreshDirectory, or a slow printer.cfg would stall a file
   * list that has nothing to do with it.
   */
  async function refreshIncludedConfigPaths(): Promise<void> {
    if (!availability.isMoonrakerConnected) return
    const generation = ++includedPathsGeneration
    try {
      const source = await fetchMoonrakerTextFile('config', PRIMARY_CONFIG, moonraker.endpoint)
      if (generation === includedPathsGeneration) applyIncludedConfigPaths(source)
    } catch {
      // An unreadable printer.cfg means there is simply nothing included yet,
      // not that the check itself failed.
      if (generation === includedPathsGeneration) includedConfigPathsReady.value = true
    }
  }

  function ensureIncludedConfigPaths(): Promise<void> {
    return includedConfigPathsReady.value ? Promise.resolve() : refreshIncludedConfigPaths()
  }

  /** Synchronous membership check against the cached include set, for the file list's per-row tint. */
  function isPathIncluded(path: string): boolean {
    return includedConfigPaths.value.has(normalizeConfigPath(path))
  }

  /*
   * Reports whether printer.cfg already has a literal include that resolves
   * to `entry`, so the context menu can decide whether to offer "Add to
   * printer.cfg" or "Remove from printer.cfg" before it opens, rather than
   * flipping the label after the fact. Reuses the same cache as the file
   * list's tint, only awaiting a fetch the first time it isn't warm yet.
   */
  async function isIncludedInPrimaryConfig(entry: MachineFileEntry): Promise<boolean> {
    await ensureIncludedConfigPaths()
    return isPathIncluded(entryPath(entry))
  }

  /*
   * Adds an `[include]` for `entry` to printer.cfg. Used from the context
   * menu on a config file that is not wired into the printer's startup yet.
   */
  async function addIncludeFor(entry: MachineFileEntry): Promise<boolean> {
    if (!availability.isMoonrakerConnected || isMutating.value) {
      lastError.value = 'mutation'
      return false
    }
    const targetPath = entryPath(entry)
    isMutating.value = true
    clearFeedback()
    try {
      const source = await fetchMoonrakerTextFile('config', PRIMARY_CONFIG, moonraker.endpoint)
      const updated = addConfigInclude(source, PRIMARY_CONFIG, targetPath)
      if (updated === null) {
        applyIncludedConfigPaths(source)
        notice.value = 'includeAlreadyAdded'
        return true
      }
      await uploadMoonrakerFile(
        'config',
        '',
        new Blob([updated], { type: 'text/plain;charset=utf-8' }),
        PRIMARY_CONFIG,
        moonraker.endpoint,
      )
      // The editor may be showing printer.cfg; keep it consistent with disk.
      if (currentFile.value?.path === PRIMARY_CONFIG) {
        editorContent.value = updated
        savedContent.value = updated
      }
      applyIncludedConfigPaths(updated)
      notice.value = 'includeAdded'
      await refreshDirectory()
      return true
    } catch {
      lastError.value = 'mutation'
      return false
    } finally {
      isMutating.value = false
    }
  }

  /*
   * Removes the `[include]` for `entry` from printer.cfg. The other half of
   * the same context menu action, so it can undo what it just offered.
   */
  async function removeIncludeFor(entry: MachineFileEntry): Promise<boolean> {
    if (!availability.isMoonrakerConnected || isMutating.value) {
      lastError.value = 'mutation'
      return false
    }
    const targetPath = entryPath(entry)
    isMutating.value = true
    clearFeedback()
    try {
      const source = await fetchMoonrakerTextFile('config', PRIMARY_CONFIG, moonraker.endpoint)
      const updated = removeConfigInclude(source, PRIMARY_CONFIG, targetPath)
      if (updated === null) {
        applyIncludedConfigPaths(source)
        notice.value = 'includeNotFound'
        return true
      }
      await uploadMoonrakerFile(
        'config',
        '',
        new Blob([updated], { type: 'text/plain;charset=utf-8' }),
        PRIMARY_CONFIG,
        moonraker.endpoint,
      )
      // The editor may be showing printer.cfg; keep it consistent with disk.
      if (currentFile.value?.path === PRIMARY_CONFIG) {
        editorContent.value = updated
        savedContent.value = updated
      }
      applyIncludedConfigPaths(updated)
      notice.value = 'includeRemoved'
      await refreshDirectory()
      return true
    } catch {
      lastError.value = 'mutation'
      return false
    } finally {
      isMutating.value = false
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refreshDirectory()
      void refreshIncludedConfigPaths()
    }, 120)
  }

  /**
   * Everything browsed, opened, or indexed here names files on the machine we
   * just left, so it all goes — including the unsaved buffers, which is the
   * one deliberate loss: they are keyed by path alone, and a path names a
   * different file on a different printer, so a buffer carried across would
   * offer to save one machine's edit into another machine's config. The root
   * returns to `config` because the set of roots is itself per-printer — the
   * one being browsed may not exist on the new machine.
   */
  function printerChanged(): void {
    hasUnappliedConfigChanges.value = false
    directoryGeneration += 1
    fileGeneration += 1
    includedPathsGeneration += 1
    closeFile()
    fileBuffers.value = new Map()
    openTabs.value = []
    tabsByRoot.clear()
    directoryListings.value = new Map()
    expandedDirectories.value = new Set()
    currentRoot.value = 'config'
    viewerContent.value = ''
    currentPath.value = ''
    entries.value = []
    searchFiles.value = []
    searchFilesLoaded.value = false
    permissionsByPath.clear()
    diskUsage.value = { total: 0, used: 0, free: 0 }
    rootPermissions.value = 'r'
    currentDirectoryPermissions.value = 'r'
    includedConfigPaths.value = new Set()
    includedConfigPathsReady.value = false
    isDirectoryLoading.value = false
    isEditorLoading.value = false
    isMutating.value = false
  }

  /*
   * Cleared on the transition into ready rather than on being ready. Klipper is
   * already ready when the app connects, so treating that as a restart would
   * clear a flag set moments earlier in the same session.
   *
   * Registered here rather than in `start()` on purpose: the Configuration route
   * starts and stops this store, and a reminder that only clears itself while
   * that page is open would outlive the restart it is reporting.
   */
  watch(
    () => availability.isKlipperReady,
    (ready) => {
      if (ready) hasUnappliedConfigChanges.value = false
    },
    /*
     * Synchronous, because this watcher and the save that sets the flag are
     * ordered against each other. A default `pre` watcher runs on the next tick,
     * so connecting and then saving inside the same tick let the connection's own
     * false-to-true transition land *after* the save and clear a reminder that
     * had just been earned.
     */
    { flush: 'sync' },
  )

  // An edit keeps a preview tab, whichever view made it: Quick config writes
  // these same buffers, and its edit must not vanish with the next click.
  watch(unsavedFilePaths, (paths) => {
    for (const path of paths) keepTab(path)
  })

  // A save refreshes the shown file's size and modified time; its tab carries
  // the same record, so it is refreshed with it.
  watch(currentFile, (file) => {
    if (!file) return
    const index = openTabs.value.findIndex((tab) => tab.file.path === file.path)
    const tab = openTabs.value[index]
    if (tab && tab.file !== file) openTabs.value.splice(index, 1, { ...tab, file })
  })

  function start(): void {
    if (started) return
    started = true
    stopPrinterChangeReset = moonraker.onPrinterChange(printerChanged)
    stopAvailabilityWatch = watch(
      () => availability.isMoonrakerConnected,
      (connected) => {
        if (connected) {
          void refreshDirectory()
          void refreshIncludedConfigPaths()
          if (currentFile.value && !isDirty.value) void openFileByPath(currentFile.value)
        } else {
          directoryGeneration += 1
          fileGeneration += 1
          isDirectoryLoading.value = false
          isEditorLoading.value = false
        }
      },
      { immediate: true },
    )
    try {
      stopFileNotifications = moonraker.onNotification('notify_filelist_changed', scheduleRefresh)
    } catch {
      stopFileNotifications = null
    }
  }

  function stop(): void {
    if (!started) return
    started = false
    directoryGeneration += 1
    fileGeneration += 1
    includedPathsGeneration += 1
    stopAvailabilityWatch?.()
    stopAvailabilityWatch = null
    stopFileNotifications?.()
    stopFileNotifications = null
    stopPrinterChangeReset?.()
    stopPrinterChangeReset = null
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
  }

  return {
    currentRoot,
    isRootEditable,
    hasUnappliedConfigChanges,
    setRoot,
    currentPath,
    entries,
    searchFiles,
    searchFilesLoaded,
    ensureSearchFiles,
    refreshSearchFiles,
    contentSearchMatches,
    contentSearchQuery,
    isSearchingFileContents,
    searchFileContents,
    clearContentSearch,
    diskUsage,
    rootPermissions,
    currentDirectoryPermissions,
    currentFile,
    editorContent,
    savedContent,
    originContent,
    isDirty,
    isPathDirty,
    unsavedFilePaths,
    hasUnsavedFiles,
    hasOtherUnsavedFiles,
    hasUnsavedFilesUnder,
    isDirectoryLoading,
    isEditorLoading,
    isMutating,
    lastError,
    notice,
    openTabs,
    directoryListings,
    expandedDirectories,
    currentFileKind,
    currentImageUrl,
    currentHtmlDocument,
    start,
    stop,
    refreshDirectory,
    navigate,
    enterDirectory,
    openFile,
    openFileByPath,
    closeFile,
    activateTab,
    keepTab,
    placeTabFirst,
    closeTab,
    closeTabs,
    expandDirectory,
    collapseDirectory,
    collapseAllDirectories,
    revealPath,
    selectDirectory,
    saveFile,
    saveAllFiles,
    discardCurrentFileChanges,
    discardAllChanges,
    discardChangesAt,
    listConfigFiles,
    configBuffer,
    loadConfigFiles,
    setConfigBufferContent,
    saveConfigFiles,
    createFile,
    createDirectory,
    createDirectoryAt,
    createFileAt,
    uploadFiles,
    renameEntry,
    deleteEntry,
    moveEntryTo,
    downloadUrlFor,
    checkMoveInclude,
    applyIncludeUpdate,
    isPathIncluded,
    isIncludedInPrimaryConfig,
    addIncludeFor,
    removeIncludeFor,
    clearFeedback,
  }
})
