import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { normalizeCamera, type Camera } from '@/features/camera/camera'

/**
 * A streamer that connects to nothing and reports nothing, which is exactly the
 * case these tests are about: a camera whose host does not answer produces no
 * error and no frame, so the shell around it is the only thing that can notice.
 * Every mount is counted, because a retry *is* a remount.
 */
let mounts = 0
const SilentStreamer = defineComponent({
  props: { camera: { type: Object, required: true }, active: { type: Boolean, default: false } },
  setup() {
    mounts += 1
    return () => h('canvas', { class: 'camera-frame' })
  },
})

vi.mock('@/components/camera/streamers/streamer', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/camera/streamers/streamer')>()
  return { ...original, streamerFor: () => SilentStreamer }
})

const { default: CameraTile } = await import('@/components/camera/CameraTile.vue')

function camera(): Camera {
  return normalizeCamera(
    {
      uid: 'chamber',
      name: 'Chamber',
      service: 'mjpegstreamer',
      enabled: true,
      stream_url: '/webcam/?action=stream',
      snapshot_url: '',
    },
    'ws://printer.local:7125/websocket',
  )
}

function mountTile() {
  return mount(CameraTile, {
    props: { camera: camera() },
    global: { plugins: [createPinia(), i18n] },
  })
}

describe('CameraTile', () => {
  beforeEach(() => {
    mounts = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows nothing but the picture while a stream is still connecting', async () => {
    const wrapper = mountTile()
    await nextTick()

    expect(wrapper.find('.camera-tile__notice').exists()).toBe(false)
    expect(wrapper.find('.camera-stage__label-dot--connecting').exists()).toBe(true)
  })

  /*
   * The failure this catches has no error event behind it: a host that is off
   * leaves the request pending, so without a deadline the card shows black with
   * a "connecting" dot for as long as the page is open.
   */
  it('reports a camera that never answers, rather than waiting forever', async () => {
    const wrapper = mountTile()
    await nextTick()

    vi.advanceTimersByTime(10_000)
    await nextTick()

    expect(wrapper.find('.camera-tile__notice').text()).toContain('No picture from this camera')
    expect(wrapper.classes()).toContain('camera-tile--failed')
    expect(wrapper.find('.camera-stage__label-dot--error').exists()).toBe(true)
  })

  /*
   * A camera that comes back has to reappear on its own. Navigating away and
   * back fixed it, which is a remount — so the retry is a remount, and every
   * attempt gets its own deadline. Without the second half the tile timed out
   * once and then sat at "connecting" for the rest of the session.
   */
  it('keeps retrying a dead camera, giving each attempt its own deadline', async () => {
    mountTile()
    await nextTick()
    expect(mounts).toBe(1)

    for (let attempt = 2; attempt <= 4; attempt += 1) {
      vi.advanceTimersByTime(10_000)
      await nextTick()
      vi.advanceTimersByTime(5_000)
      await nextTick()
      expect(mounts, `attempt ${attempt}`).toBe(attempt)
    }
  })

  /*
   * A retry puts the stream back to `connecting`, and clearing the notice there
   * made a dead camera flash the message, go black for the next attempt, and say
   * it again. The reader cannot act on a flicker.
   */
  it('keeps saying the same thing while it retries, rather than flickering', async () => {
    const wrapper = mountTile()
    await nextTick()

    vi.advanceTimersByTime(10_000)
    await nextTick()
    expect(wrapper.find('.camera-tile__notice').exists()).toBe(true)

    // Through the retry, and into the attempt after it.
    vi.advanceTimersByTime(5_000)
    await nextTick()
    expect(wrapper.find('.camera-tile__notice').exists()).toBe(true)

    vi.advanceTimersByTime(3_000)
    await nextTick()
    expect(wrapper.find('.camera-tile__notice').exists()).toBe(true)
  })

  it('stops retrying once the tile is no longer being looked at', async () => {
    const wrapper = mountTile()
    await nextTick()

    vi.advanceTimersByTime(10_000)
    await nextTick()

    await wrapper.setProps({ selected: false })
    const mountsWhenHidden = mounts

    vi.advanceTimersByTime(60_000)
    await nextTick()

    expect(mounts).toBe(mountsWhenHidden)
  })
})
