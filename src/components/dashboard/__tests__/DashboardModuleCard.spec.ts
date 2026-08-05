import { mount } from '@vue/test-utils'
import { computed, defineComponent, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import DashboardModuleCard from '@/components/dashboard/DashboardModuleCard.vue'
import { useDashboardModuleHeaderAction } from '@/dashboard/context'
import { i18n } from '@/i18n'

function mountCard(props: Partial<InstanceType<typeof DashboardModuleCard>['$props']> = {}) {
  return mount(DashboardModuleCard, {
    props: {
      instanceId: 'macros',
      title: 'Macros',
      defaultTitle: 'Macros',
      icon: 'function',
      editing: false,
      isFirst: true,
      isLast: false,
      canMoveToPreviousColumn: false,
      canMoveToNextColumn: true,
      collapsed: false,
      hasSettings: true,
      settingsOpen: false,
      docked: false,
      canRename: true,
      canDuplicate: true,
      canRemove: false,
      dragging: false,
      ...props,
    },
    slots: { default: '<p>module body</p>' },
    global: { plugins: [i18n] },
  })
}

describe('DashboardModuleCard', () => {
  it('keeps settings and collapse available while resting on the card', async () => {
    const wrapper = mountCard()
    const controls = wrapper.findAll('.dashboard-module__quick-controls button')

    expect(controls).toHaveLength(2)
    expect(controls[0]?.attributes('title')).toBe('Macros settings — Ctrl+click for full settings')
    expect(controls[1]?.attributes('title')).toBe('Collapse Macros')

    await controls[0]?.trigger('click')
    await controls[1]?.trigger('click')

    expect(wrapper.emitted('toggleSettings')).toEqual([['macros']])
    expect(wrapper.emitted('toggleCollapse')).toEqual([['macros']])
  })

  it('sends a Ctrl- or Cmd-clicked gear straight to the full settings surface', async () => {
    const wrapper = mountCard()
    const gear = wrapper.get('[aria-label="Macros settings"]')

    await gear.trigger('click', { ctrlKey: true })
    await gear.trigger('click', { metaKey: true })

    expect(wrapper.emitted('openSurface')).toEqual([['macros'], ['macros']])
    expect(wrapper.emitted('toggleSettings')).toBeUndefined()
  })

  it('lets the mounted module add one quiet action beside settings and collapse', async () => {
    const disabled = ref(true)
    const onClick = vi.fn()
    const ModuleWithAction = defineComponent({
      setup() {
        useDashboardModuleHeaderAction(
          computed(() => ({
            icon: 'trash',
            label: 'Clear things',
            disabled: disabled.value,
            onClick,
          })),
        )
        return () => null
      },
    })

    const Host = defineComponent({
      components: { DashboardModuleCard, ModuleWithAction },
      template: `
        <DashboardModuleCard
          instance-id="macros"
          title="Macros"
          default-title="Macros"
          icon="function"
          :editing="false"
          :is-first="true"
          :is-last="false"
          :can-move-to-previous-column="false"
          :can-move-to-next-column="true"
          :collapsed="false"
          :has-settings="true"
          :settings-open="false"
          :docked="false"
          :can-rename="true"
          :can-duplicate="true"
          :can-remove="false"
          :dragging="false"
        >
          <ModuleWithAction />
        </DashboardModuleCard>
      `,
    })

    const wrapper = mount(Host, { global: { plugins: [i18n] } })
    // The child registers its action as part of its own mount, which the card
    // (already rendered by then) only picks up on the next reactive flush.
    await wrapper.vm.$nextTick()

    const controls = wrapper.findAll('.dashboard-module__quick-controls button')
    expect(controls).toHaveLength(3)
    expect(controls[0]?.attributes('title')).toBe('Clear things')
    expect(controls[0]?.attributes('disabled')).toBeDefined()

    disabled.value = false
    await wrapper.vm.$nextTick()
    expect(
      wrapper.findAll('.dashboard-module__quick-controls button')[0]?.attributes('disabled'),
    ).toBeUndefined()

    await wrapper.findAll('.dashboard-module__quick-controls button')[0]?.trigger('click')
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('withdraws the settings gear while the card is docked in the surface', () => {
    const wrapper = mountCard({ docked: true })
    const controls = wrapper.findAll('.dashboard-module__quick-controls button')

    // The surface repeats these controls; leaving the gear would make the same
    // module configurable in two places at once.
    expect(controls).toHaveLength(1)
    expect(controls[0]?.attributes('title')).toBe('Collapse Macros')
  })

  it('hides the body while collapsed and offers to expand it again', () => {
    const wrapper = mountCard({ collapsed: true })

    expect(wrapper.text()).not.toContain('module body')
    expect(wrapper.classes()).toContain('dashboard-module--collapsed')
    const controls = wrapper.findAll('.dashboard-module__quick-controls button')
    expect(controls.at(0)?.attributes('title')).toBe('Expand Macros')
  })

  it('withdraws the settings gear while collapsed, since the module it configures is unmounted', () => {
    const wrapper = mountCard({ collapsed: true })
    const controls = wrapper.findAll('.dashboard-module__quick-controls button')

    // Collapsing unmounts the module, which is what the inline settings layer
    // lives inside — a gear that opened it here would open nothing.
    expect(controls).toHaveLength(1)
    expect(controls[0]?.attributes('title')).toBe('Expand Macros')
  })

  it('exposes layout editing controls only while editing', async () => {
    const resting = mountCard()
    expect(resting.find('.dashboard-module__edit-controls').exists()).toBe(false)

    const editing = mountCard({ editing: true })
    expect(editing.find('.dashboard-module__quick-controls').exists()).toBe(false)

    const duplicate = editing.get('[title="Add another Macros card"]')
    await duplicate.trigger('click')
    expect(editing.emitted('duplicate')).toEqual([['macros']])
    expect(editing.find('[title="Remove this Macros card"]').exists()).toBe(false)
  })

  it('moves the card between columns and disables the control at each edge', async () => {
    const wrapper = mountCard({ editing: true })
    const previous = wrapper.get('[title="Move Macros to the previous column"]')
    const next = wrapper.get('[title="Move Macros to the next column"]')

    expect(previous.attributes('disabled')).toBeDefined()
    expect(next.attributes('disabled')).toBeUndefined()

    await next.trigger('click')
    expect(wrapper.emitted('moveColumn')).toEqual([['macros', 1]])
  })

  it('starts a drag from the handle, and only while editing', async () => {
    const resting = mountCard()
    expect(resting.find('.dashboard-module__drag-handle').exists()).toBe(false)

    const wrapper = mountCard({ editing: true })
    await wrapper.get('.dashboard-module__drag-handle').trigger('pointerdown')

    const started = wrapper.emitted('dragStart')
    expect(started).toHaveLength(1)
    expect(started?.[0]?.[1]).toBe('macros')
  })

  it('does not turn a press on the card or its rename field into a drag', async () => {
    const wrapper = mountCard({ editing: true })

    // Pointer capture over the whole article would take the press that puts a
    // caret in the title, leaving a card whose name cannot be edited.
    await wrapper.trigger('pointerdown')
    await wrapper.get('.dashboard-module__rename').trigger('pointerdown')
    await wrapper.get('[title="Move Macros to the next column"]').trigger('pointerdown')

    expect(wrapper.emitted('dragStart')).toBeUndefined()
  })

  it('marks the carried card so the column shows a prospective layout', () => {
    expect(mountCard({ editing: true }).attributes('data-dragging')).toBeUndefined()
    expect(mountCard({ editing: true, dragging: true }).attributes('data-dragging')).toBe('true')
  })

  it('renames a multi-instance card and leaves the default name as a placeholder', async () => {
    const wrapper = mountCard({ editing: true, title: 'Macros', defaultTitle: 'Macros' })
    const input = wrapper.get('.dashboard-module__rename')

    expect((input.element as HTMLInputElement).value).toBe('')
    expect(input.attributes('placeholder')).toBe('Macros')

    await input.setValue('Calibration')
    expect(wrapper.emitted('rename')).toEqual([['macros', 'Calibration']])
  })

  it('does not offer renaming for single-instance modules', () => {
    const wrapper = mountCard({ editing: true, canRename: false })
    expect(wrapper.find('.dashboard-module__rename').exists()).toBe(false)
    expect(wrapper.get('h2').text()).toBe('Macros')
  })

  it('keeps the module summary visible only while the card is collapsed', () => {
    // Expanded: the module's own body carries the value, so the header stays clean.
    const expanded = mountCard({ collapsed: false, summary: '42%' })
    expect(expanded.find('.dashboard-module__summary').exists()).toBe(false)
    expect(expanded.text()).toContain('module body')

    const collapsed = mountCard({ collapsed: true, summary: '42%' })
    expect(collapsed.get('.dashboard-module__summary').text()).toBe('42%')
    expect(collapsed.text()).not.toContain('module body')
  })

  it('shows no placeholder when a collapsed module has nothing to summarize', () => {
    expect(
      mountCard({ collapsed: true, summary: null }).find('.dashboard-module__summary').exists(),
    ).toBe(false)
    expect(mountCard({ collapsed: true }).find('.dashboard-module__summary').exists()).toBe(false)
  })
})
