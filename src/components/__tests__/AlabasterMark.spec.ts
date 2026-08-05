import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AlabasterMark from '@/components/AlabasterMark.vue'
import { i18n } from '@/i18n'

describe('AlabasterMark', () => {
  it('is a clickable trigger with a decorative mark and follows the active theme', () => {
    const wrapper = mount(AlabasterMark, { global: { plugins: [i18n] } })

    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.attributes('aria-label')).toBe('Play the Alabaster logo animation')

    const svg = wrapper.find('svg')
    expect(svg.classes()).toContain('alabaster-mark--auto')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('role')).toBeUndefined()
  })

  it('supports an explicit surface variant and prefers a caller-supplied label', () => {
    const wrapper = mount(AlabasterMark, {
      props: { label: 'Alabaster', variant: 'on-dark' },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('svg').classes()).toContain('alabaster-mark--on-dark')
    expect(wrapper.attributes('aria-label')).toBe('Alabaster')
  })

  it('plays the animation once per click and resets when it ends', async () => {
    const wrapper = mount(AlabasterMark, { global: { plugins: [i18n] } })
    const svg = wrapper.find('svg')

    expect(svg.classes()).not.toContain('alabaster-mark--playing')

    await wrapper.trigger('click')
    expect(svg.classes()).toContain('alabaster-mark--playing')

    // A second click mid-flight must not restart or double up the animation.
    await wrapper.trigger('click')
    expect(svg.classes()).toContain('alabaster-mark--playing')

    await svg.trigger('animationend')
    expect(svg.classes()).not.toContain('alabaster-mark--playing')

    await wrapper.trigger('click')
    expect(svg.classes()).toContain('alabaster-mark--playing')
  })

  it('scopes automatic dark mode to the mark instead of the root element', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'components', 'AlabasterMark.vue'),
      'utf8',
    )

    expect(source).toContain(":global(:root[data-theme='dark'] .alabaster-mark--auto)")
  })
})
