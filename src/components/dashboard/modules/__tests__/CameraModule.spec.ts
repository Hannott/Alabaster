import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { computed, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import CameraModule from '@/components/dashboard/modules/CameraModule.vue'
import { dashboardModuleContextKey } from '@/dashboard/context'
import { i18n } from '@/i18n'
import type { MoonrakerWebcam } from '@/services/moonraker'
import { useWebcamsStore } from '@/stores/webcams'

function webcam(overrides: Partial<MoonrakerWebcam> & { name: string }): MoonrakerWebcam {
  return {
    uid: overrides.name.toLowerCase(),
    service: 'mjpegstreamer',
    enabled: true,
    stream_url: `/webcam/${overrides.name}?action=stream`,
    snapshot_url: `/webcam/${overrides.name}?action=snapshot`,
    ...overrides,
  }
}

/**
 * `CameraTile` resolves its streamer through `defineAsyncComponent`, and every
 * streamer reaches for an API jsdom does not have — `OffscreenCanvas`,
 * `RTCPeerConnection`, a `<video>` that decodes. The tile is stubbed for that
 * reason: what these tests are about is which cameras the card decides to show
 * and how it arranges them, all of which is settled before a streamer is asked
 * for.
 */
const stubs = {
  CameraTile: {
    props: ['camera', 'selected'],
    template:
      '<div class="tile" :data-camera="camera.name" :data-selected="String(selected)"></div>',
  },
}

function mountModule(cameras: MoonrakerWebcam[], config: Record<string, unknown> = {}) {
  const pinia = createPinia()
  const webcams = useWebcamsStore(pinia)
  webcams.webcams = cameras
  const stored = ref<Record<string, unknown>>(config)

  const wrapper = mount(CameraModule, {
    global: {
      plugins: [pinia, i18n],
      stubs,
      provide: {
        [dashboardModuleContextKey as symbol]: {
          instanceId: 'camera',
          moduleId: 'camera',
          config: computed(() => stored.value),
          updateConfig: (patch: Record<string, unknown>) => {
            stored.value = { ...stored.value, ...patch }
          },
          isSettingsOpen: computed(() => false),
          openSettings: () => undefined,
          closeSettings: () => undefined,
          isSurfaceOpen: computed(() => false),
          openSurface: () => undefined,
          closeSurface: () => undefined,
        },
      },
    },
  })

  return { wrapper, webcams }
}

function cameraNames(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('.tile').map((tile) => tile.attributes('data-camera') ?? '')
}

describe('CameraModule', () => {
  it('follows the first enabled camera until the card is configured', async () => {
    const { wrapper } = mountModule([
      webcam({ name: 'Switched off', enabled: false }),
      webcam({ name: 'Chamber' }),
      webcam({ name: 'Nozzle' }),
    ])
    await nextTick()

    expect(cameraNames(wrapper)).toEqual(['Chamber'])
  })

  it('shows the cameras a card names, in the order it names them', async () => {
    const { wrapper } = mountModule(
      [webcam({ name: 'Chamber' }), webcam({ name: 'Nozzle' }), webcam({ name: 'Spool' })],
      { cameras: ['nozzle', 'chamber'] },
    )
    await nextTick()

    expect(cameraNames(wrapper)).toEqual(['Nozzle', 'Chamber'])
  })

  /**
   * The whole point of the two arrangements: a grid runs every stream, a tab
   * strip runs one. If a hidden tab were still `selected` the arrangement would
   * cost the printer exactly as much as the grid and mean nothing.
   */
  it('keeps only the chosen tab streaming, and switches which one on a press', async () => {
    const { wrapper } = mountModule([webcam({ name: 'Chamber' }), webcam({ name: 'Nozzle' })], {
      cameras: ['chamber', 'nozzle'],
      arrangement: 'tabs',
    })
    await nextTick()

    const tiles = wrapper.findAll('.tile')
    expect(tiles.map((tile) => tile.attributes('data-selected'))).toEqual(['true', 'false'])

    const tabs = wrapper.findAll('.camera-tabs button')
    expect(tabs).toHaveLength(2)
    await tabs[1]?.trigger('click')

    expect(wrapper.findAll('.tile').map((tile) => tile.attributes('data-selected'))).toEqual([
      'false',
      'true',
    ])
  })

  it('runs every stream at once in the grid arrangement', async () => {
    const { wrapper } = mountModule([webcam({ name: 'Chamber' }), webcam({ name: 'Nozzle' })], {
      cameras: ['chamber', 'nozzle'],
    })
    await nextTick()

    expect(wrapper.find('.camera-tabs').exists()).toBe(false)
    expect(cameraNames(wrapper)).toEqual(['Chamber', 'Nozzle'])
  })

  /*
   * Three reasons a card shows nothing, three different things to say. Reporting
   * a switched-off camera as "no camera on this card" sends the reader into the
   * card's own settings to fix something that is not wrong with the card.
   */
  it('says the camera is off, not that the card has none, when it is off', async () => {
    const { wrapper } = mountModule([webcam({ name: 'Chamber', enabled: false })], {
      cameras: ['chamber'],
    })
    await nextTick()

    expect(cameraNames(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('This camera is switched off')
  })

  it('says the card has none when its cameras were removed on purpose', async () => {
    const { wrapper } = mountModule([webcam({ name: 'Chamber' })], { cameras: [] })
    await nextTick()

    expect(cameraNames(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('No camera on this card')
  })

  it('points at the settings section when the printer has no cameras at all', async () => {
    const { wrapper } = mountModule([])
    await nextTick()

    expect(wrapper.text()).toContain('No camera configured')
  })

  it('offers a retry only when the camera list itself failed to load', async () => {
    const { wrapper, webcams } = mountModule([])
    await nextTick()
    expect(wrapper.find('button').exists()).toBe(false)

    webcams.failed = true
    await nextTick()

    expect(wrapper.text()).toContain('Camera stream unavailable')
    expect(wrapper.find('button').exists()).toBe(true)
  })
})
