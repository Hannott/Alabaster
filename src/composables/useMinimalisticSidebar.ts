import { readonly, ref } from 'vue'

/**
 * Whether the desktop sidebar hides the Alabaster mark and application name.
 * A device ergonomic like `useSidebar`'s own collapsed flag and
 * `usePageHeaders`' visibility pick: how much chrome the sidebar is worth
 * spending is a question of the screen in front of the reader, so it stays
 * out of `settings/bundle.ts` the same way both of those do.
 */
const minimalisticSidebarStorageKey = 'alabaster.sidebar.minimalistic'

function getInitialState(): boolean {
  return localStorage.getItem(minimalisticSidebarStorageKey) === 'true'
}

const isMinimalisticSidebar = ref(getInitialState())

function setMinimalisticSidebar(next: boolean): void {
  isMinimalisticSidebar.value = next
  localStorage.setItem(minimalisticSidebarStorageKey, String(next))
}

export function useMinimalisticSidebar() {
  return {
    isMinimalisticSidebar: readonly(isMinimalisticSidebar),
    setMinimalisticSidebar,
  }
}
