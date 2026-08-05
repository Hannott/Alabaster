import { describe, expect, it } from 'vitest'

import { isValueField } from '@/composables/useSelectValueOnFocus'

function render(markup: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = markup
  document.body.append(host)
  return host
}

describe('select value on focus', () => {
  it('recognizes every field that holds a number rather than words', () => {
    // `AppField` and `AppSlider` each need one entry however many places they
    // appear, which is what replaced the four container-scoped groupings this
    // list used to mirror by hand. `.field--value` stays for the one field
    // that is deliberately neither: the temperature preset editor's cells.
    const host = render(`
      <div class="app-field"><input class="app-field__input" type="number" /></div>
      <input class="field field--value" />
      <div class="app-slider__entry"><input type="number" /></div>
    `)

    for (const input of host.querySelectorAll('input')) {
      expect(isValueField(input)).toBe(true)
    }
  })

  it('leaves search boxes, text prompts, and non-input elements alone', () => {
    const host = render(`
      <input class="field" type="text" />
      <div class="settings-row"><input type="text" /></div>
      <span class="field--value">42</span>
      <span class="app-field__input">42</span>
    `)

    for (const element of [
      host.querySelector('input.field'),
      host.querySelector('.settings-row input'),
      host.querySelector('span.field--value'),
      host.querySelector('span.app-field__input'),
    ]) {
      expect(isValueField(element)).toBe(false)
    }
  })
})
