import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { findRuns, runKey, runRows } from '@/features/machine/klippyLog'
import {
  appendLogBytes,
  emptyLogWindow,
  prependLogBytes,
  type LogWindow,
} from '@/features/machine/logWindow'
import { fetchMoonrakerFileRange } from '@/services/moonraker/files'
import type { MoonrakerFileRoot } from '@/services/moonraker/types'
import { useMoonrakerStore } from '@/stores/moonraker'

/** How much of the file one request reads. */
export const KLIPPY_LOG_CHUNK = 1 << 20
/*
 * Moonraker sends no notification when a log grows, so the end of the file is
 * read again on a timer — the explicit polling AGENTS.md asks for where no
 * notification exists. A log a reader is waiting on is worth a request every
 * few seconds; one in a hidden tab is not.
 */
export const KLIPPY_LOG_POLL_MS = 5000
/** Idle polls between checks that the file was not replaced by a rollover. */
const ROLLOVER_CHECK_EVERY = 6

export interface KlippyLogSource {
  root: MoonrakerFileRoot
  path: string
  /** The size the listing reported, used only to choose where the first read starts. */
  size: number
}

/**
 * A log file read from its end, then back toward its start a chunk at a time,
 * and followed as it grows — so the newest run is on screen after one request
 * however large the file, and the run list fills in behind it.
 */
export function useKlippyLog(source: () => KlippyLogSource | null) {
  const moonraker = useMoonrakerStore()
  const window = shallowRef<LogWindow | null>(null)
  const isLoading = ref(false)
  const failed = ref(false)
  let generation = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let polling = false
  let idlePolls = 0
  let loadedKey: string | null = null

  const fromFileStart = computed(() => window.value?.start === 0)

  function stop(): void {
    generation += 1
    if (timer) clearInterval(timer)
    timer = null
  }

  async function readRange(current: KlippyLogSource, start: number, end?: number) {
    return fetchMoonrakerFileRange(current.root, current.path, moonraker.endpoint, start, end)
  }

  /*
   * Reloading the same file — after a reconnect, or a rollover — keeps the rows
   * already on screen until the fresh read replaces them, rather than blanking
   * the view for the length of a request.
   */
  async function load(current: KlippyLogSource): Promise<void> {
    stop()
    const token = generation
    const key = `${current.root}/${current.path}`
    if (key !== loadedKey) window.value = null
    loadedKey = key
    failed.value = false
    isLoading.value = true
    try {
      let from = Math.max(0, current.size - KLIPPY_LOG_CHUNK)
      let bytes = await readRange(current, from)
      // The file shrank since it was listed: a rollover replaced it.
      if (bytes === null && from > 0) {
        from = 0
        bytes = await readRange(current, 0)
      }
      if (token !== generation) return
      window.value = appendLogBytes(emptyLogWindow(from), bytes ?? new Uint8Array(0))
    } catch {
      if (token === generation) failed.value = true
      return
    } finally {
      if (token === generation) isLoading.value = false
    }
    timer = setInterval(() => void poll(current, token), KLIPPY_LOG_POLL_MS)
    await readBackward(current, token)
  }

  /** Walks back to the start of the file, so every run in it can be listed. */
  async function readBackward(current: KlippyLogSource, token: number): Promise<void> {
    while (token === generation && window.value && window.value.start > 0) {
      const end = window.value.start
      const start = Math.max(0, end - KLIPPY_LOG_CHUNK)
      let bytes: Uint8Array | null
      try {
        bytes = await readRange(current, start, end)
      } catch {
        return
      }
      if (token !== generation || !window.value || window.value.start !== end) return
      if (!bytes || bytes.length !== end - start) return
      window.value = prependLogBytes(window.value, bytes)
    }
  }

  async function poll(current: KlippyLogSource, token: number): Promise<void> {
    if (polling || document.visibilityState !== 'visible' || !window.value) return
    polling = true
    try {
      const end = window.value.end
      const bytes = await readRange(current, end)
      if (token !== generation || !window.value) return
      if (bytes && bytes.length > 0) {
        idlePolls = 0
        window.value = appendLogBytes(window.value, bytes)
        return
      }
      idlePolls += 1
      if (idlePolls % ROLLOVER_CHECK_EVERY !== 0 || end === 0) return
      // The last byte already read is gone only when the file was replaced.
      const last = await readRange(current, end - 1)
      if (token === generation && last === null) void load(current)
    } catch {
      // A missed poll is retried by the next one; the rows already shown stay.
    } finally {
      polling = false
    }
  }

  watch(
    () => {
      const current = source()
      return current ? `${current.root}/${current.path}` : null
    },
    (key) => {
      const current = source()
      // A source that goes away while the printer is unreachable stops the reads
      // but keeps the rows, so the view dims in place instead of emptying.
      if (key && current) void load(current)
      else stop()
    },
    { immediate: true },
  )

  onScopeDispose(stop)

  function reload(): void {
    const current = source()
    if (current) void load(current)
  }

  return { window, isLoading, failed, fromFileStart, reload }
}

/**
 * The log split into runs, the run on screen, and its rows. The newest run is
 * followed until the reader picks another, so a restart while the view is open
 * brings the new run up the way the tail of a log would.
 */
export function useKlippyLogRuns(source: () => KlippyLogSource | null) {
  const reader = useKlippyLog(source)
  const lines = computed(() => reader.window.value?.lines ?? [])
  const runs = computed(() => findRuns(lines.value, reader.fromFileStart.value))
  /** Null follows the newest run. */
  const selectedKey = ref<string | null>(null)
  const selectedRun = computed(() => {
    const key = selectedKey.value
    const chosen =
      key === null ? undefined : runs.value.find((run) => runKey(lines.value, run) === key)
    return chosen ?? runs.value.at(-1) ?? null
  })
  const result = computed(() =>
    selectedRun.value ? runRows(lines.value, selectedRun.value) : null,
  )

  watch(
    () => source()?.path,
    (path, previous) => {
      if (path && path !== previous) selectedKey.value = null
    },
  )

  function selectRun(key: string): void {
    const newest = runs.value.at(-1)
    selectedKey.value = newest && runKey(lines.value, newest) === key ? null : key
  }

  return { ...reader, lines, runs, selectedRun, result, selectRun }
}
