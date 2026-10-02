import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'

/**
 * The current time, as a ref that moves. For text that is a distance from
 * now — "today 10:25", "2 days ago", "due" — which a `Date.now()` read once
 * at mount froze for as long as the page stayed open: a sitting that ran into
 * the next day still read "today", and a run that aged past its threshold
 * never turned due until the page was reloaded.
 *
 * One shared ref and one interval for every reader, started on the first and
 * stopped with the last; a per-component timer would wake each list row on
 * its own schedule for the same minute. Minute resolution is as fine as any of
 * that text is.
 */
const now = ref(Date.now())
let readers = 0
let timer: ReturnType<typeof setInterval> | null = null

const tickMs = 30_000

export function useNow(): Readonly<Ref<number>> {
  readers += 1
  now.value = Date.now()
  timer ??= setInterval(() => {
    now.value = Date.now()
  }, tickMs)
  if (getCurrentScope()) {
    onScopeDispose(() => {
      readers -= 1
      if (readers === 0 && timer !== null) {
        clearInterval(timer)
        timer = null
      }
    })
  }
  return now
}
