import { defineComponent, h, type PropType, type VNode } from 'vue'

import type { NoteInline } from '@/features/machine/releaseNotes'

function render(inlines: readonly NoteInline[]): Array<VNode | string> {
  return inlines.map((inline) => {
    switch (inline.kind) {
      case 'text':
        return inline.text
      case 'code':
        return h('code', { class: 'release-notes__code' }, inline.text)
      case 'strong':
        return h('strong', render(inline.children))
      case 'link':
        return h(
          'a',
          { href: inline.href, target: '_blank', rel: 'noopener noreferrer' },
          render(inline.children),
        )
    }
  })
}

/** One line of a release body, rendered as elements rather than as HTML. */
export default defineComponent({
  name: 'ReleaseNoteInlines',
  props: { inlines: { type: Array as PropType<readonly NoteInline[]>, required: true } },
  setup(props) {
    return () => render(props.inlines)
  },
})
