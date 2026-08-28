import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppStatusField from '@/components/AppStatusField.vue'

describe('AppStatusField', () => {
  it('renders the text as its own label, defaulting to a neutral tone at md', () => {
    const wrapper = mount(AppStatusField, { props: { text: 'Up to date' } })

    expect(wrapper.text()).toBe('Up to date')
    expect(wrapper.attributes('data-tone')).toBe('neutral')
    // `md` is the shared default and carries no size modifier of its own.
    expect(wrapper.classes()).toEqual(['status-field'])
  })

  it('carries the requested tone as data-tone, never as the only signal of state', () => {
    const wrapper = mount(AppStatusField, { props: { text: 'Needs attention', tone: 'caution' } })

    expect(wrapper.attributes('data-tone')).toBe('caution')
    // The colour is never the only thing that changed -- the text still says so.
    expect(wrapper.text()).toBe('Needs attention')
  })

  it('adds a size modifier only below md, matching the button system scale', () => {
    const sm = mount(AppStatusField, { props: { text: 'Active', size: 'sm' } })
    const xs = mount(AppStatusField, { props: { text: 'Active', size: 'xs' } })

    expect(sm.classes()).toContain('status-field--sm')
    expect(xs.classes()).toContain('status-field--xs')
  })

  it('forwards a caller class alongside its own, for existing call-site selectors', () => {
    const wrapper = mount(AppStatusField, {
      props: { text: 'Up to date' },
      attrs: { class: 'machine-update-status' },
    })

    expect(wrapper.classes()).toEqual(expect.arrayContaining(['status-field', 'machine-update-status']))
  })
})
