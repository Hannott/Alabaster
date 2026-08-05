import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ConsoleCommandInput from '@/components/console/ConsoleCommandInput.vue'
import { i18n } from '@/i18n'

const commands = ['BED_MESH_CALIBRATE', 'SET_FAN_SPEED', 'SET_GCODE_OFFSET', 'G28']

function mountInput(history: string[] = []) {
  const wrapper = mount(ConsoleCommandInput, {
    props: { history, commands },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  return { wrapper, field: wrapper.get('textarea') }
}

describe('ConsoleCommandInput', () => {
  it('sends on Enter and clears the prompt, so the next command starts empty', async () => {
    const { wrapper, field } = mountInput()
    await field.setValue('G28')
    await field.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('send')).toEqual([['G28']])
    expect((field.element as HTMLTextAreaElement).value).toBe('')
  })

  it('adds a line on Shift+Enter instead of sending', async () => {
    // The only way to build a multi-line script in a field whose Enter sends.
    const { wrapper, field } = mountInput()
    await field.setValue('G90')
    await field.trigger('keydown', { key: 'Enter', shiftKey: true })

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('refuses to send blank input', async () => {
    const { wrapper, field } = mountInput()
    await field.setValue('   ')
    await field.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('walks the history backwards and returns to an empty prompt going forward', async () => {
    const { field } = mountInput(['G28', 'M105', 'M114'])
    const element = field.element as HTMLTextAreaElement

    await field.trigger('keydown', { key: 'ArrowUp' })
    expect(element.value).toBe('M114')
    await field.trigger('keydown', { key: 'ArrowUp' })
    expect(element.value).toBe('M105')
    await field.trigger('keydown', { key: 'ArrowUp' })
    expect(element.value).toBe('G28')
    // Walking past the oldest entry stays put rather than clearing the field.
    await field.trigger('keydown', { key: 'ArrowUp' })
    expect(element.value).toBe('G28')

    await field.trigger('keydown', { key: 'ArrowDown' })
    expect(element.value).toBe('M105')
    await field.trigger('keydown', { key: 'ArrowDown' })
    expect(element.value).toBe('M114')
    // Off the newest entry is an empty prompt, which is what makes the walk
    // escapable without deleting the text by hand.
    await field.trigger('keydown', { key: 'ArrowDown' })
    expect(element.value).toBe('')
  })

  it('leaves the caret alone when the arrow keys are editing a multi-line script', async () => {
    // Hijacking ArrowUp on line two would make a pasted script impossible to edit.
    const { field } = mountInput(['G28'])
    const element = field.element as HTMLTextAreaElement
    await field.setValue('G90\nG1 X10')
    element.setSelectionRange(element.value.length, element.value.length)

    await field.trigger('keydown', { key: 'ArrowUp' })
    expect(element.value).toBe('G90\nG1 X10')
  })

  it('completes a unique command on Tab', async () => {
    const { field } = mountInput()
    const element = field.element as HTMLTextAreaElement
    await field.setValue('bed')
    element.setSelectionRange(3, 3)

    await field.trigger('keydown', { key: 'Tab' })
    expect(element.value).toBe('BED_MESH_CALIBRATE')
  })

  it('offers the candidates it could not narrow, without touching the transcript', async () => {
    const { wrapper, field } = mountInput()
    const element = field.element as HTMLTextAreaElement
    await field.setValue('set')
    element.setSelectionRange(3, 3)

    await field.trigger('keydown', { key: 'Tab' })
    // Filled to the shared prefix, with both options offered as controls. A
    // completion is a question asked of the input, so it never becomes a
    // transcript line pretending the printer said it.
    expect(element.value).toBe('SET_')
    expect(wrapper.findAll('.console-prompt__completions button').map((b) => b.text())).toEqual([
      'SET_FAN_SPEED',
      'SET_GCODE_OFFSET',
    ])

    await wrapper.get('.console-prompt__completions button').trigger('click')
    expect(element.value).toBe('SET_FAN_SPEED')
    expect(wrapper.find('.console-prompt__completions').exists()).toBe(false)
  })

  it('keeps Tab as a way out of the field when there is nothing to complete', async () => {
    // The only escape a keyboard user has; swallowing it would trap them.
    const { field } = mountInput()
    const tab = await field.trigger('keydown', { key: 'Tab' })
    expect(tab).toBeUndefined()
    expect((field.element as HTMLTextAreaElement).value).toBe('')
  })

  it('grows with the script it holds, up to a bound', async () => {
    const { field } = mountInput()
    expect(field.attributes('rows')).toBe('1')
    await field.setValue('G90\nG1 X10\nG1 Y10')
    expect(field.attributes('rows')).toBe('3')
    // A long paste must not push the transcript out of the card.
    await field.setValue(Array.from({ length: 40 }, (_, index) => `G1 X${index}`).join('\n'))
    expect(field.attributes('rows')).toBe('5')
  })

  it('disables both the field and sending while unavailable', () => {
    const wrapper = mount(ConsoleCommandInput, {
      props: { commands, disabled: true },
      global: { plugins: [i18n] },
    })
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('holds Enter, not only the button, while a command is in flight', async () => {
    const wrapper = mount(ConsoleCommandInput, {
      props: { commands, pending: true },
      global: { plugins: [i18n] },
    })
    await wrapper.get('textarea').setValue('M115')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })

    // A guard only the button carried is a guard the keyboard walked past, and
    // the store then echoed a command it went on to refuse.
    expect(wrapper.emitted('send')).toBeUndefined()
    // The field stays editable and keeps the draft: composing the next line
    // while the printer works is the point of a console.
    expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('M115')
  })

  it('says it is busy with the shared pending treatment, not with a bare grey button', async () => {
    const wrapper = mount(ConsoleCommandInput, {
      props: { commands, pending: true },
      global: { plugins: [i18n] },
    })
    await wrapper.get('textarea').setValue('M115')
    const send = wrapper.get('button[type="submit"]')

    expect(send.attributes('data-pending')).toBe('true')
    expect(send.attributes('aria-busy')).toBe('true')
    expect(send.attributes('disabled')).toBeDefined()
    // The label does not change with the state, per the one state model.
    expect(send.attributes('aria-label')).toBe('Send command')
  })

  it('sends again as soon as the printer has answered', async () => {
    const wrapper = mount(ConsoleCommandInput, {
      props: { commands, pending: true },
      global: { plugins: [i18n] },
    })
    await wrapper.get('textarea').setValue('M115')
    await wrapper.setProps({ pending: false })
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('send')).toEqual([['M115']])
  })
})
