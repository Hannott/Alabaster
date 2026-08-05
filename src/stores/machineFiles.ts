import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

import { classifyFileKind, isLargeFile, type MachineFileKind } from '@/features/machine/fileKind'
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
}

export interface OpenMachineFile extends MachineFileEntry {
  kind: 'file'
  path: string
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

/** The config Klipper actually loads, and so the only file whose includes matter. */
export const PRIMARY_CONFIG = 'printer.cfg'

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
   */
  const fileBuffers = ref(new Map<string, { content: string; saved: string }>())
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
  const recentFilesByPath = new Map<string, OpenMachineFile>()
  const recentFiles = ref<OpenMachineFile[]>([])
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
      const saved = fileBuffers.value.get(file.path)?.saved ?? ''
      fileBuffers.value.set(file.path, { content, saved })
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
      const content = fileBuffers.value.get(file.path)?.content ?? ''
      fileBuffers.value.set(file.path, { content, saved })
    },
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
    const moved: Array<[string, { content: string; saved: string }]> = []
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

  function refreshRecentFiles(): void {
    recentFiles.value = [...recentFilesByPath.values()]
      .sort((left, right) => right.modified - left.modified)
      .slice(0, 3)
  }

  function rememberFiles(files: readonly OpenMachineFile[]): void {
    for (const file of files) recentFilesByPath.set(file.path, file)
    refreshRecentFiles()
  }

  function rememberDirectoryFiles(path: string, files: readonly OpenMachineFile[]): void {
    const currentPaths = new Set(files.map((file) => file.path))
    for (const key of recentFilesByPath.keys()) {
      const separator = key.lastIndexOf('/')
      const directory = separator < 0 ? '' : key.slice(0, separator)
      if (directory === path && !currentPaths.has(key)) recentFilesByPath.delete(key)
    }
    rememberFiles(files)
  }

  /*
   * Commits a fetched directory listing for `path` in one synchronous pass —
   * entries, disk usage, permissions — so a render never catches it half
   * applied. Callers control what else changes in that same pass: a same-folder
   * refresh leaves currentPath alone, a navigation sets it right before this
   * runs, so the old folder never mixes with the new one across a frame.
   */
  function applyDirectoryResult(path: string, result: MoonrakerDirectoryResult): void {
    entries.value = directoryEntries(result)
    rememberDirectoryFiles(
      path,
      entries.value.flatMap((entry) =>
        entry.kind === 'file'
          ? [{ ...entry, kind: 'file' as const, path: joinPath(path, entry.name) }]
          : [],
      ),
    )
    diskUsage.value = result.disk_usage
    rootPermissions.value = result.root_info?.permissions ?? rootPermissions.value
    permissionsByPath.set('', rootPermissions.value)
    for (const directory of result.dirs) {
      permissionsByPath.set(joinPath(path, directory.dirname), directory.permissions)
    }
    currentDirectoryPermissions.value = permissionsByPath.get(path) ?? rootPermissions.value
  }

  async function refreshDirectory(): Promise<boolean> {
    if (!availability.isMoonrakerConnected) return false
    const generation = ++directoryGeneration
    isDirectoryLoading.value = true
    lastError.value = null
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
    currentRoot.value = root
    closeFile()
    viewerContent.value = ''
    htmlContent.value = ''
    currentPath.value = ''
    entries.value = []
    // The search index and the per-path permissions both describe the root that
    // was being browsed, so carrying either across would answer questions about
    // one root with facts about the other.
    searchFiles.value = []
    searchFilesLoaded.value = false
    clearContentSearch()
    permissionsByPath.clear()
    recentFilesByPath.clear()
    recentFiles.value = []
    return refreshDirectory()
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

  async function openFile(entry: MachineFileEntry): Promise<boolean> {
    if (entry.kind !== 'file' || !validMoonrakerFilename(entry.name)) return false
    const generation = ++fileGeneration
    const path = joinPath(currentPath.value, entry.name)

    const kind = classifyFileKind(entry.name)
    if (kind === 'image') {
      currentFile.value = { ...entry, kind: 'file', path }
      imageCacheBust.value += 1
      lastError.value = null
      isEditorLoading.value = false
      return true
    }

    // A dirty buffer already holds the edit that matters; reopening it must
    // never refetch over it. A clean buffer is just a cache of what disk held
    // last time, so it still refreshes below in case something else changed
    // the file while it was closed. A read-only root has no buffers to consult.
    const existing = isRootEditable.value ? fileBuffers.value.get(path) : undefined
    if (existing && existing.content !== existing.saved) {
      currentFile.value = { ...entry, kind: 'file', path }
      lastError.value = null
      isEditorLoading.value = false
      return true
    }

    isEditorLoading.value = true
    lastError.value = null
    try {
      const content = await fetchMoonrakerTextFile(currentRoot.value, path, moonraker.endpoint)
      if (generation !== fileGeneration) return false
      currentFile.value = { ...entry, kind: 'file', path }
      if (kind === 'html') htmlContent.value = content
      else if (isRootEditable.value) fileBuffers.value.set(path, { content, saved: content })
      else viewerContent.value = content
      return true
    } catch {
      if (generation === fileGeneration) lastError.value = 'file'
      return false
    } finally {
      if (generation === fileGeneration) isEditorLoading.value = false
    }
  }

  async function openRecentFile(file: OpenMachineFile): Promise<boolean> {
    const segments = file.path.split('/')
    const filename = segments.pop()
    if (!filename || !validMoonrakerFilename(filename)) return false
    const directory = segments.join('/')
    if (directory !== currentPath.value) await navigate(directory)
    return openFile({ ...file, kind: 'file', name: filename })
  }

  function closeFile(): void {
    fileGeneration += 1
    currentFile.value = null
    isEditorLoading.value = false
    clearFeedback()
  }

  /** Drops the in-memory edit at `path`, restoring it to its last-saved content. */
  function discardChangesAt(path: string): void {
    const buffer = fileBuffers.value.get(path)
    if (!buffer) return
    fileBuffers.value.set(path, { content: buffer.saved, saved: buffer.saved })
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
    const segments = path.split('/')
    const filename = segments.pop()
    if (!filename) throw new Error(`Invalid path: ${path}`)
    await uploadMoonrakerFile(
      currentRoot.value,
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
      fileBuffers.value.set(file.path, { content, saved: content })
      currentFile.value = { ...file, modified: Date.now() / 1000, size: new Blob([content]).size }
      rememberFiles([currentFile.value])
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
          fileBuffers.value.set(path, { content: buffer.content, saved: buffer.content })
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

  /** Absolute path of an entry within the browsed root, from the shown directory. */
  function entryPath(entry: MachineFileEntry): string {
    return joinPath(currentPath.value, entry.name)
  }

  function downloadUrlFor(entry: MachineFileEntry): string | null {
    if (entry.kind !== 'file') return null
    return moonrakerFileUrl(currentRoot.value, entryPath(entry), moonraker.endpoint)
  }

  /*
   * Keeps the open editor consistent with a path that just changed underneath
   * it. Renaming or moving the file being edited must not leave the editor
   * pointed at a path the printer no longer has.
   */
  function repointOpenFile(previousPath: string, next: OpenMachineFile | null): void {
    recentFilesByPath.delete(previousPath)
    if (currentFile.value?.path !== previousPath) {
      refreshRecentFiles()
      return
    }
    if (next === null) {
      closeFile()
      return
    }
    currentFile.value = next
    rememberFiles([next])
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
    const nextPath = joinPath(currentPath.value, filename)
    isMutating.value = true
    clearFeedback()
    try {
      await moonraker.rpcCall('server.files.move', {
        source: joinPath(currentRoot.value, previousPath),
        dest: joinPath(currentRoot.value, nextPath),
      })
      repointBuffers(previousPath, nextPath)
      repointOpenFile(
        previousPath,
        entry.kind === 'file' ? { ...entry, kind: 'file', name: filename, path: nextPath } : null,
      )
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
      repointOpenFile(
        previousPath,
        entry.kind === 'file' ? { ...entry, kind: 'file', path: nextPath } : null,
      )
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
    currentRoot.value = 'config'
    viewerContent.value = ''
    currentPath.value = ''
    entries.value = []
    searchFiles.value = []
    searchFilesLoaded.value = false
    permissionsByPath.clear()
    recentFilesByPath.clear()
    recentFiles.value = []
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
          if (currentFile.value && !isDirty.value) void openFile(currentFile.value)
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
    recentFiles,
    currentFileKind,
    currentImageUrl,
    currentHtmlDocument,
    start,
    stop,
    refreshDirectory,
    navigate,
    enterDirectory,
    openFile,
    openRecentFile,
    closeFile,
    saveFile,
    saveAllFiles,
    discardCurrentFileChanges,
    discardAllChanges,
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
