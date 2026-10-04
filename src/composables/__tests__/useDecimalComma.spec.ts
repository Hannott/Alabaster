import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { isNumberField, useDecimalComma, withDecimalPoint } from '@/composables/useDecimalComma'

function render(markup: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = markup
  document.body.append(host)
  return host
}

const Host = defineComponent({
  setup() {
    useDecimalComma()
    return () => h('input', { type: 'number', class: 'target' })
  },
})

describe('decimal comma', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('targets only number fields that can be edited', () => {
    const host = render(`
      <input type="number" class="editable" />
      <input type="number" class="readonly" readonly />
      <input type="number" class="disabled" disabled />
      <input type="text" class="text" />
    `)

    expect(isNumberField(host.querySelector('.editable'))).toBe(true)
    for (const selector of ['.readonly', '.disabled', '.text']) {
      expect(isNumberField(host.querySelector(selector)), selector).toBe(false)
    }
  })

  it('turns every comma in a pasted value into a period', () => {
    expect(withDecimalPoint('0,45')).toBe('0.45')
    expect(withDecimalPoint('12.5')).toBe('12.5')
  })

  it('inserts a period where a comma was typed into a number field', () => {
    // jsdom has no editing commands, so the insert is observed rather than run.
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    const wrapper = mount(Host, { attachTo: document.body })

    const comma = new KeyboardEvent('keydown', { key: ',', bubbles: true, cancelable: true })
    wrapper.get('input').element.dispatchEvent(comma)

    expect(comma.defaultPrevented).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('insertText', false, '.')

    // A shortcut that happens to use the comma key is not a typed comma.
    const shortcut = new KeyboardEvent('keydown', {
      key: ',',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    wrapper.get('input').element.dispatchEvent(shortcut)
    expect(shortcut.defaultPrevented).toBe(false)

    wrapper.unmount()
  })
})
