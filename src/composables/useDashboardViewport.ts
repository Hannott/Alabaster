import { onBeforeUnmount, onMounted, ref } from 'vue'

import type { DashboardViewport } from '@/dashboard/layout'

export function dashboardViewportForWidth(width: number): DashboardViewport {
  if (width >= 1024) return 'desktop'
  if (width >= 640) return 'tablet'
  return 'mobile'
}

export function useDashboardViewport() {
  const viewport = ref<DashboardViewport>(dashboardViewportForWidth(window.innerWidth))

  function update(): void {
    viewport.value = dashboardViewportForWidth(window.innerWidth)
  }

  onMounted(() => window.addEventListener('resize', update, { passive: true }))
  onBeforeUnmount(() => window.removeEventListener('resize', update))

  return { viewport }
}
