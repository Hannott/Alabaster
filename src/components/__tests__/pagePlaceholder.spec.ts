import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PagePlaceholder from '@/components/PagePlaceholder.vue'
import { i18n } from '@/i18n'

function render(props: { shell: 'standard' | 'workspace'; page: 'history'; state?: 'error' }) {
  return mount(PagePlaceholder, { props, global: { plugins: [i18n] } })
}

describe('PagePlaceholder', () => {
  /**
   * It stands in for a page, so it has to be the page's own box: the shell class
   * carries the padding, the scrolling, and the height the arriving view will use.
   * A placeholder in a different box moves the page when the view lands.
   */
  it('holds the arriving page’s shell', () => {
    expect(render({ shell: 'standard', page: 'history' }).classes()).toContain('standard-page')
    expect(render({ shell: 'workspace', page: 'history' }).classes()).toContain('workspace-page')
  })

  it('reserves the heading and a card on a standard page, and one panel on a workspace', () => {
    const standard = render({ shell: 'standard', page: 'history' })
    expect(standard.find('.page-heading').exists()).toBe(true)
    expect(standard.findAll('.page-placeholder__bar')).toHaveLength(1)
    expect(standard.find('.page-column .page-card').exists()).toBe(true)
    expect(standard.find('.page-placeholder__workspace').exists()).toBe(false)

    const workspace = render({ shell: 'workspace', page: 'history' })
    expect(workspace.find('.page-placeholder__workspace').exists()).toBe(true)
    expect(workspace.find('.page-heading').exists()).toBe(false)
  })

  /**
   * The reserved bars say nothing, so the wait is announced instead of being left
   * to be inferred from an empty page. Naming the destination is the one thing
   * this component knows for certain — it deliberately does not guess the heading
   * the arriving page will write.
   */
  it('announces which page is on its way, and shows no borrowed copy', () => {
    const wrapper = render({ shell: 'standard', page: 'history' })
    const status = wrapper.get('[role="status"]')

    expect(wrapper.attributes('aria-busy')).toBe('true')
    expect(status.classes()).toContain('sr-only')
    expect(status.text()).toBe('Loading History')
    expect(wrapper.get('.page-heading').attributes('aria-hidden')).toBe('true')
  })

  it('offers a way out when the page cannot be fetched at all', () => {
    const wrapper = render({ shell: 'standard', page: 'history', state: 'error' })

    expect(wrapper.attributes('aria-busy')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('History could not be loaded')
    expect(wrapper.get('button').text()).toBe('Reload Alabaster')
    expect(wrapper.find('.page-placeholder__track').exists()).toBe(false)
  })
})
