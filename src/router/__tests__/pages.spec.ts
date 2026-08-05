import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mount } from '@vue/test-utils'
import { defineAsyncComponent, defineComponent, h, nextTick, type AsyncComponentLoader } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { navigationDestinations } from '@/navigation/destinations'
import { router } from '@/router'
import { pageAsyncOptions, pagePlaceholderDelayMs, pages } from '@/router/pages'

const sourceRoot = join(process.cwd(), 'src')

function source(path: string): string {
  return readFileSync(join(sourceRoot, path), 'utf8')
}

/** Every table entry, read from the source so the declared view path is visible. */
function tableEntries(): Array<{ name: string; shell: string; view: string }> {
  const table = source('router/pages.ts')
  const body = table.slice(
    table.indexOf('export const pages'),
    table.indexOf('function placeholder'),
  )
  const entries = [
    ...body.matchAll(
      /(\w+): \{ shell: '(standard|workspace)', load: \(\) => import\('@\/(.+?)'\)/g,
    ),
  ]

  return entries.map(([, name, shell, view]) => ({
    name: name as string,
    shell: shell as string,
    view: view as string,
  }))
}

/**
 * The page under a host element rather than as the root of the wrapper: while its
 * module is in flight an async component renders a comment node, which a wrapper
 * rooted on it cannot be queried through.
 */
function mountPage(overrides: { loader: AsyncComponentLoader }) {
  const page = defineAsyncComponent({ ...pageAsyncOptions('history'), ...overrides })
  return mount(defineComponent({ render: () => h('div', { class: 'route-stage' }, [h(page)]) }), {
    global: { plugins: [i18n] },
  })
}

describe('page table', () => {
  it('gives every navigable destination a page, and every page a destination', () => {
    const destinations = navigationDestinations.map((entry) => entry.name).sort()
    expect(Object.keys(pages).sort()).toEqual(destinations)
  })

  /**
   * The defect this guards: the placeholder holds the destination's geometry
   * while its module is in flight, and it takes the shell from this table rather
   * than from the view. A table saying `standard` for a page that renders
   * `workspace-page` reserves a scrolling column where a full-height workspace is
   * about to appear, so the page jumps at the moment it arrives — which is the
   * one thing reserving space exists to prevent.
   */
  it('declares each page the shell its view actually renders', () => {
    const entries = tableEntries()
    expect(entries).toHaveLength(navigationDestinations.length)

    for (const entry of entries) {
      expect(source(entry.view), `${entry.name} declares ${entry.shell}`).toContain(
        `class="${entry.shell}-page`,
      )
    }
  })

  /**
   * The defect this guards, and the reason the router no longer holds
   * `() => import(...)` itself: Vue Router awaits a route component that is a
   * function before it commits the navigation. With one, a click on a destination
   * whose module was not in the browser yet left the previous page on screen with
   * no acknowledgement at all until the network answered. An async component
   * commits immediately and does its waiting inside the page.
   */
  it('hands the router resolved components, never loaders it would await', () => {
    const routed = router.getRoutes().filter((route) => route.components?.default !== undefined)
    expect(routed).toHaveLength(navigationDestinations.length)

    for (const route of routed) {
      expect(typeof route.components?.default, `${String(route.name)} is not a loader`).toBe(
        'object',
      )
    }
  })

  /**
   * The whole point of the mechanism, in the case it exists for: a page whose
   * module has not arrived. Nothing may be blank, nothing may be borrowed from the
   * page that has not loaded, and the shell may not appear for a wait too short to
   * have been noticed — a placeholder flashed over a fast load reports a delay that
   * did not happen (ADR 0004).
   */
  it('stands the destination’s shell in for a page that has to be waited for', async () => {
    vi.useFakeTimers()
    try {
      let resolvePage: ((component: unknown) => void) | undefined
      const wrapper = mountPage({
        loader: () => new Promise((resolve) => (resolvePage = resolve)),
      })

      expect(wrapper.find('.page-placeholder').exists()).toBe(false)

      vi.advanceTimersByTime(pagePlaceholderDelayMs)
      await nextTick()

      const placeholder = wrapper.get('.page-placeholder')
      expect(placeholder.classes()).toContain('standard-page')
      expect(placeholder.get('[role="status"]').text()).toBe('Loading History')

      resolvePage?.(
        defineComponent({ render: () => h('section', { class: 'standard-page' }, 'x') }),
      )
      await vi.waitFor(() => expect(wrapper.find('.page-placeholder').exists()).toBe(false))
      expect(wrapper.text()).toBe('x')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows nothing at all for a page that arrives before the wait is noticeable', async () => {
    const wrapper = mountPage({
      loader: () => Promise.resolve(defineComponent({ render: () => h('section', {}, 'arrived') })),
    })

    await vi.waitFor(() => expect(wrapper.text()).toBe('arrived'))
    expect(wrapper.find('.page-placeholder').exists()).toBe(false)
  })

  /**
   * A dropped request is retried before the reader is told anything, because on a
   * printer's own network one failed asset request is ordinary. Only a page that
   * cannot be fetched at all becomes an error, and that error keeps the shell so
   * the failure is reported inside the page rather than as a blank route.
   */
  it('retries a dropped page before reporting it, then keeps the shell', async () => {
    let attempts = 0
    const wrapper = mountPage({
      loader: () => {
        attempts += 1
        return Promise.reject(new Error('offline'))
      },
    })

    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true))
    expect(attempts).toBeGreaterThan(1)
    expect(wrapper.get('.page-placeholder').classes()).toContain('standard-page')
    expect(wrapper.get('[role="alert"]').text()).toContain('History could not be loaded')
  })

  /**
   * The defect this guards: a navigation surface added without the intent hooks.
   * The idle warm-up covers the common case, but a reader who reaches for a link
   * within the first seconds — or on a machine busy enough that idle time never
   * arrives — is exactly the person who would wait, and hovering or tabbing to a
   * link is the clearest statement of where they are going.
   */
  it('warms a destination from every navigation surface that links to one', () => {
    const shell = source('App.vue')
    const links = [...shell.matchAll(/:to="\{ name: item\.name \}"/g)]
    const pointer = [...shell.matchAll(/@pointerenter="pagePrefetch\.prefetch\(item\.name\)"/g)]
    const keyboard = [...shell.matchAll(/@focus="pagePrefetch\.prefetch\(item\.name\)"/g)]

    expect(links.length).toBeGreaterThan(0)
    expect(pointer).toHaveLength(links.length)
    expect(keyboard).toHaveLength(links.length)
  })

  it('gives every page a placeholder that can name it in every locale', () => {
    const locales = ['en', 'nb'] as const

    for (const locale of locales) {
      const messages = JSON.parse(source(`locales/${locale}.json`)) as {
        navigation: Record<string, unknown> & {
          pageFailed: Record<string, string>
        }
      }

      expect(messages.navigation.loadingPage, `${locale} names the wait`).toContain('{page}')
      expect(messages.navigation.pageFailed.title).toContain('{page}')
      expect(messages.navigation.pageFailed.description).toBeTruthy()
      expect(messages.navigation.pageFailed.action).toBeTruthy()

      for (const destination of navigationDestinations) {
        const [group, key] = destination.labelKey.split('.') as [string, string]
        expect(
          (messages as unknown as Record<string, Record<string, string>>)[group]?.[key],
          `${locale} is missing ${destination.labelKey}`,
        ).toBeTruthy()
      }
    }
  })
})
