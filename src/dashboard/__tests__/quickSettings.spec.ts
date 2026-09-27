import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { computed, defineComponent, h, provide, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import HostedDashboardModule from '@/components/dashboard/HostedDashboardModule.vue'
import {
  dashboardModuleContextKey,
  useDashboardModule,
  type DashboardModuleContext,
} from '@/dashboard/context'
import { i18n } from '@/i18n'
import { useQuickSettings, type QuickSettingsController } from '@/dashboard/quickSettings'

function context(pinAllQuickSettings?: boolean): DashboardModuleContext {
  const closed = computed(() => false)
  return {
    instanceId: 'movement',
    moduleId: 'movement',
    config: computed(() => ({ quickSettings: [] })),
    updateConfig: () => {},
    isSettingsOpen: closed,
    openSettings: () => {},
    closeSettings: () => {},
    isSurfaceOpen: closed,
    openSurface: () => {},
    closeSurface: () => {},
    ...(pinAllQuickSettings === undefined ? {} : { pinAllQuickSettings }),
  }
}

/** Mounts `useQuickSettings` in quick mode under a module context. */
function quickUnder(provided: DashboardModuleContext): QuickSettingsController {
  let controller: QuickSettingsController | undefined
  const Child = defineComponent({
    setup() {
      controller = useQuickSettings(
        provided.config,
        provided.updateConfig,
        ['showParking'],
        () => 'quick',
      )
      return () => null
    },
  })
  mount(
    defineComponent({
      setup() {
        provide(dashboardModuleContextKey, provided)
        return () => h(Child)
      },
    }),
  )
  if (!controller) throw new Error('useQuickSettings did not run')
  return controller
}

describe('useQuickSettings', () => {
  it('shows only the promoted rows in the quick layer', () => {
    const config = computed(() => ({ quickSettings: ['showParking'] }))
    const quick = useQuickSettings(
      config,
      () => {},
      [],
      () => 'quick',
    )

    expect(quick.visible('showParking')).toBe(true)
    expect(quick.visible('showZOffset')).toBe(false)
  })

  it('shows every row while pinAll is set, without writing it to the stored set', () => {
    const stored = ref<Record<string, unknown>>({ quickSettings: [] })
    const updateConfig = vi.fn((patch: Record<string, unknown>) => {
      stored.value = { ...stored.value, ...patch }
    })
    const quick = useQuickSettings(
      computed(() => stored.value),
      updateConfig,
      ['showParking'],
      () => 'quick',
      true,
    )

    expect(quick.visible('showParking')).toBe(true)
    expect(quick.visible('showZOffset')).toBe(true)
    expect(quick.isQuick('showZOffset')).toBe(true)
    expect(updateConfig).not.toHaveBeenCalled()
    expect(stored.value.quickSettings).toEqual([])
  })

  it('pins every row under a context that asks for it, as a hosted module does', () => {
    expect(quickUnder(context(true)).visible('showZOffset')).toBe(true)
    expect(quickUnder(context()).visible('showZOffset')).toBe(false)
  })

  it('pins every row for any card hosted outside the dashboard', () => {
    let controller: QuickSettingsController | undefined
    const Fields = defineComponent({
      setup() {
        const { config, updateConfig } = useDashboardModule('extruder')
        controller = useQuickSettings(config, updateConfig, [], () => 'quick')
        return () => null
      },
    })
    mount(HostedDashboardModule, {
      props: { moduleId: 'extruder' },
      slots: { default: () => h(Fields) },
      global: { plugins: [createPinia(), i18n] },
    })

    expect(controller?.visible('anySetting')).toBe(true)
  })
})
