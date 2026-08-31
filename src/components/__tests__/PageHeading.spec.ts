import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('PageHeading', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the inline action and no floating trigger while headers show', async () => {
    const { default: PageHeading } = await import('@/components/PageHeading.vue')
    const onClick = vi.fn()
    const wrapper = mount(PageHeading, {
      props: {
        title: 'Dashboard',
        action: { label: 'Refresh', icon: 'refresh', onClick },
      },
      attachTo: document.body,
    })

    expect(wrapper.get('h1').text()).toBe('Dashboard')
    expect(wrapper.find('.page-heading--collapsed').exists()).toBe(false)
    expect(wrapper.find('.page-heading-fab').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(1)

    wrapper.unmount()
  })

  it('collapses the row and reveals a floating trigger once headers are set to hide', async () => {
    const { usePageHeaders } = await import('@/composables/usePageHeaders')
    usePageHeaders().setPageHeaderVisibility('hide')

    const { default: PageHeading } = await import('@/components/PageHeading.vue')
    const onClick = vi.fn()
    const wrapper = mount(PageHeading, {
      props: {
        title: 'Dashboard',
        action: { label: 'Refresh', icon: 'refresh', onClick },
      },
      attachTo: document.body,
    })

    expect(wrapper.find('.page-heading--collapsed').exists()).toBe(true)
    expect(wrapper.find('.page-heading > .button').exists()).toBe(false)

    const trigger = wrapper.get('.page-heading-fab button')
    await trigger.trigger('click')

    const action = wrapper.get('.header-menu__panel button')
    await action.trigger('click')

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.header-menu__panel').exists()).toBe(false)

    wrapper.unmount()
  })

  it('renders no floating trigger when the route has no action to reveal', async () => {
    const { usePageHeaders } = await import('@/composables/usePageHeaders')
    usePageHeaders().setPageHeaderVisibility('hide')

    const { default: PageHeading } = await import('@/components/PageHeading.vue')
    const wrapper = mount(PageHeading, {
      props: { title: 'Dashboard' },
      attachTo: document.body,
    })

    expect(wrapper.find('.page-heading-fab').exists()).toBe(false)

    wrapper.unmount()
  })
})
