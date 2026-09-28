import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAvailabilityStore } from '@/stores/availability'
import { useDocumentationSiteStore } from '@/stores/documentationSite'
import { useMoonrakerStore } from '@/stores/moonraker'
import { usePrintersStore } from '@/stores/printers'

function stubUpdateStatus(klipper: Record<string, unknown> | null): void {
  const moonraker = useMoonrakerStore()
  vi.spyOn(moonraker, 'rpcCall').mockImplementation((method: string) => {
    if (method !== 'machine.update.status') return Promise.resolve({}) as never
    if (!klipper) return Promise.reject(new Error('Method not found')) as never
    return Promise.resolve({ version_info: { klipper } }) as never
  })
}

async function flush(): Promise<void> {
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  setActivePinia(createPinia())
  useAvailabilityStore().moonrakerConnected({ klippy_connected: true, klippy_state: 'ready' })
  useMoonrakerStore().connectionPhase = 'connected'
})

describe('documentationSite store', () => {
  it('follows the firmware the update manager reports', async () => {
    stubUpdateStatus({ owner: 'KalicoCrew', repo_name: 'kalico' })
    const documentationSite = useDocumentationSiteStore()
    documentationSite.start()
    await flush()
    expect(documentationSite.detected).toBe('kalico')
    expect(documentationSite.site).toBe('kalico')
  })

  it('falls back to Klipper where the update manager does not manage it', async () => {
    stubUpdateStatus(null)
    const documentationSite = useDocumentationSiteStore()
    documentationSite.start()
    await flush()
    expect(documentationSite.detected).toBeNull()
    expect(documentationSite.site).toBe('klipper')
  })

  it('lets a stored choice override the detection, per printer', async () => {
    stubUpdateStatus({ owner: 'KalicoCrew', repo_name: 'kalico' })
    const printers = usePrintersStore()
    const first = printers.addPrinter('ws://first.local:7125/websocket')
    const second = printers.addPrinter('ws://second.local:7125/websocket')
    const documentationSite = useDocumentationSiteStore()
    documentationSite.start()
    printers.selectPrinter(first!.id)
    await flush()
    documentationSite.setSite('klipper')
    expect(documentationSite.site).toBe('klipper')

    printers.selectPrinter(second!.id)
    await flush()
    expect(documentationSite.stored).toBeNull()
    printers.selectPrinter(first!.id)
    await flush()
    expect(documentationSite.stored).toBe('klipper')
  })
})
