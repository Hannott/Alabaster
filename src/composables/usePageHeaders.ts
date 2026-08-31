import { readonly, ref } from 'vue'

/**
 * Whether a routed view's `PageHeading` shows its title row at all. `hide`
 * collapses the row to nothing, so the page's own content sits right under
 * the application header — see `PageHeading.vue` and interface-standards.md's
 * "Page heading contract" for what replaces the row's action button once its
 * space is gone.
 *
 * A device ergonomic like `useSidebar`'s collapsed flag, not a portable
 * preference like `useTextWeight`: how much of the screen a title row is
 * worth to spend is a question of the screen in front of the reader, not of
 * the reader themselves, so it stays out of `settings/bundle.ts` the same way
 * the sidebar's own collapsed state does.
 */
export type PageHeaderVisibility = 'show' | 'hide'

const pageHeaderVisibilityStorageKey = 'alabaster.pageHeaders'

export function isPageHeaderVisibility(value: string): value is PageHeaderVisibility {
  return value === 'show' || value === 'hide'
}

function getInitialPageHeaderVisibility(): PageHeaderVisibility {
  const saved = localStorage.getItem(pageHeaderVisibilityStorageKey)
  return saved !== null && isPageHeaderVisibility(saved) ? saved : 'show'
}

const mode = ref<PageHeaderVisibility>(getInitialPageHeaderVisibility())

function setPageHeaderVisibility(next: PageHeaderVisibility): void {
  mode.value = next
  localStorage.setItem(pageHeaderVisibilityStorageKey, next)
}

export function usePageHeaders() {
  return {
    mode: readonly(mode),
    setPageHeaderVisibility,
  }
}
