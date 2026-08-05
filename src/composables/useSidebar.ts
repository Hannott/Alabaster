import { readonly, ref } from 'vue'

const sidebarStorageKey = 'alabaster.sidebar.collapsed'

function getInitialState(): boolean {
  return localStorage.getItem(sidebarStorageKey) === 'true'
}

const isSidebarCollapsed = ref(getInitialState())

function setSidebarCollapsed(isCollapsed: boolean): void {
  isSidebarCollapsed.value = isCollapsed
  localStorage.setItem(sidebarStorageKey, String(isCollapsed))
}

export function useSidebar() {
  return {
    isSidebarCollapsed: readonly(isSidebarCollapsed),
    setSidebarCollapsed,
    toggleSidebar: () => setSidebarCollapsed(!isSidebarCollapsed.value),
  }
}
