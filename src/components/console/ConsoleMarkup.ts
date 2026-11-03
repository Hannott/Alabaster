import { defineComponent, h, type PropType, type VNodeChild } from 'vue'

import type { ConsoleMarkupNode } from '@/services/console/markup'

/**
 * Renders a parsed response line. A render function rather than a template
 * with `v-html` on purpose: every attribute the printer's output can reach is
 * set here by name, with the values `markup.ts` already admitted, so there is
 * no HTML string between the printer and the DOM for a crafted line to escape
 * through. Links always open in a new tab and never hand the opener to it;
 * a macro cannot ask for anything else.
 */
export default defineComponent({
  name: 'ConsoleMarkup',
  props: {
    nodes: { type: Array as PropType<readonly ConsoleMarkupNode[]>, required: true },
    /** Read aloud for an image the macro gave no `alt`, so it is never silent. */
    imageFallbackAlt: { type: String, required: true },
  },
  emits: { imageLoad: () => true },
  setup(props, { emit }) {
    function render(nodes: readonly ConsoleMarkupNode[]): VNodeChild[] {
      return nodes.map((node) => {
        switch (node.type) {
          case 'text':
            return node.text
          case 'break':
            return h('br')
          case 'inline':
            return h(node.tag, render(node.children))
          case 'link':
            return h(
              'a',
              {
                class: 'gcode-console__link',
                href: node.href,
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              render(node.children),
            )
          case 'image':
            return h('img', {
              class: 'gcode-console__image',
              src: node.src,
              alt: node.alt || props.imageFallbackAlt,
              loading: 'lazy',
              decoding: 'async',
              onLoad: () => emit('imageLoad'),
            })
        }
      })
    }
    return () => render(props.nodes)
  },
})
