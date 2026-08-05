import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import HtmlFileViewer from '@/components/machine/HtmlFileViewer.vue'

describe('HtmlFileViewer', () => {
  it('renders the given markup through srcdoc rather than navigating an iframe to a URL', () => {
    const wrapper = mount(HtmlFileViewer, {
      props: { content: '<p>hello</p>', title: 'report.html' },
    })

    const iframe = wrapper.get('iframe')
    expect(iframe.attributes('srcdoc')).toBe('<p>hello</p>')
    expect(iframe.attributes('src')).toBeUndefined()
    expect(iframe.attributes('title')).toBe('report.html')
    expect(iframe.attributes('sandbox')).toBe('allow-scripts')
  })

  it('marks itself pending until the frame reports load, and again on a content change', async () => {
    const wrapper = mount(HtmlFileViewer, {
      props: { content: '<p>hello</p>', title: 'report.html' },
    })

    expect(wrapper.get('.machine-html-viewer').attributes('data-pending')).toBe('true')
    await wrapper.get('iframe').trigger('load')
    expect(wrapper.get('.machine-html-viewer').attributes('data-pending')).toBeUndefined()

    await wrapper.setProps({ content: '<p>other</p>' })
    expect(wrapper.get('.machine-html-viewer').attributes('data-pending')).toBe('true')
  })
})
