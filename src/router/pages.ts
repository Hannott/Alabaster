import {
  defineAsyncComponent,
  defineComponent,
  h,
  type AsyncComponentLoader,
  type AsyncComponentOptions,
  type Component,
} from 'vue'

import PagePlaceholder from '@/components/PagePlaceholder.vue'
import type { NavigationDestinationName } from '@/navigation/destinations'

/**
 * Every page, as data: which shell it renders and how its module arrives.
 *
 * The table is keyed by destination name and typed as a complete record, so a
 * destination in the rail without a page here — or a page nothing can reach —
 * fails to compile rather than sending the user to a blank route.
 *
 * `shell` exists so the placeholder below can reserve the same geometry the real
 * page occupies before its module has arrived. A placeholder that guessed would
 * move the page the moment the view mounted, which is the failure the
 * reserved-space rule in `interface-standards.md` exists to prevent.
 */
export type PageShell = 'standard' | 'workspace'

interface PageEntry {
  shell: PageShell
  load: AsyncComponentLoader
}

export const pages: Record<NavigationDestinationName, PageEntry> = {
  farm: { shell: 'workspace', load: () => import('@/views/FarmView.vue') },
  overview: { shell: 'standard', load: () => import('@/views/DashboardView.vue') },
  printFiles: { shell: 'workspace', load: () => import('@/views/PrintFilesView.vue') },
  gcodeViewer: { shell: 'workspace', load: () => import('@/views/GcodeViewerView.vue') },
  history: { shell: 'standard', load: () => import('@/views/HistoryView.vue') },
  timelapse: { shell: 'standard', load: () => import('@/views/TimelapseView.vue') },
  calibration: { shell: 'standard', load: () => import('@/views/CalibrationView.vue') },
  configuration: { shell: 'workspace', load: () => import('@/views/ConfigurationView.vue') },
  machine: { shell: 'standard', load: () => import('@/views/MachineView.vue') },
  console: { shell: 'workspace', load: () => import('@/views/ConsoleView.vue') },
  settings: { shell: 'standard', load: () => import('@/views/SettingsView.vue') },
}

/**
 * The placeholder as a component in its own right, so `defineAsyncComponent`
 * can mount it without being able to pass props. `inheritAttrs: false` because
 * Vue hands the error component an `error` prop, and a functional wrapper would
 * fall it through onto the placeholder's root element as an attribute.
 */
function placeholder(
  shell: PageShell,
  page: NavigationDestinationName,
  state: 'loading' | 'error',
): Component {
  return defineComponent({
    name: state === 'error' ? 'PageLoadError' : 'PageLoading',
    inheritAttrs: false,
    setup: () => () => h(PagePlaceholder, { shell, page, state }),
  })
}

/**
 * How long a page may take to arrive before its shell stands in for it. Matches
 * `--motion-duration-fast`: a warm module resolves inside one frame and the
 * reader sees the real page with no intermediate state, while a wait long enough
 * to notice gets an answer instead of a dead click. ADR 0004 holds why a reveal
 * has to be earned by a wait rather than shown on principle.
 */
export const pagePlaceholderDelayMs = 120

/**
 * How many times a page's module is re-requested before the reader is told.
 * A single dropped request over Wi-Fi is common and recoverable; a fourth
 * failure means the asset is genuinely gone, which a retry cannot fix.
 */
const pageLoadAttempts = 3

/**
 * A page as the router should see it: a resolved component, never a loader.
 *
 * This is what makes a navigation instant. Vue Router awaits a route component
 * declared as `() => import(...)` before it commits the navigation, so on a cold
 * module the click did nothing at all — no heading, no shell, no sign the
 * interface had heard it — for as long as the printer's network took. Handing the
 * router an async component instead moves that wait inside the page, where the
 * shell is already on screen and the destination's own geometry is reserved.
 */
export function pageComponent(name: NavigationDestinationName): Component {
  return defineAsyncComponent(pageAsyncOptions(name))
}

/**
 * Separate from `pageComponent` so a test can put a slow or failing loader behind
 * the real waiting behavior, which is the part that has to hold: a page's own
 * module is warm in every test environment, and asserting on that proves nothing
 * about what the reader sees when it is not.
 */
export function pageAsyncOptions(name: NavigationDestinationName): AsyncComponentOptions {
  const { shell, load } = pages[name]

  return {
    loader: load,
    loadingComponent: placeholder(shell, name, 'loading'),
    errorComponent: placeholder(shell, name, 'error'),
    delay: pagePlaceholderDelayMs,
    onError(_error, retry, fail, attempts) {
      if (attempts <= pageLoadAttempts) retry()
      else fail()
    },
  }
}
