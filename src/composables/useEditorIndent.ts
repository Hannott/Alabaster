import { readonly, ref } from 'vue'

import { defaultIndentWidth, isIndentWidth, type IndentWidth } from '@/features/machine/indent'

/**
 * How wide one level of indentation is in the configuration editor, in spaces.
 *
 * A typing preference rather than a view filter, which is why it lives in
 * Settings and travels in `SettingsBundle` (ADR 0008) while the explorer's
 * file-visibility toggles stay browser-local. See
 * docs/design/configuration-editor.md for why the editor writes spaces at all.
 *
 * The same value drives `tab-size` through `--code-tab-size`, so a file that
 * already contains literal tabs paints at the width the reader chose instead of
 * forming a second grid beside the spaces they type into it.
 */
const indentWidthStorageKey = 'alabaster.machine.indentWidth'

function getInitialIndentWidth(): IndentWidth {
  const saved = Number(localStorage.getItem(indentWidthStorageKey))
  return isIndentWidth(saved) ? saved : defaultIndentWidth
}

const indentWidth = ref<IndentWidth>(getInitialIndentWidth())

function applyIndentWidth(next: IndentWidth): void {
  document.documentElement.style.setProperty('--code-tab-size', String(next))
}

function setIndentWidth(next: IndentWidth): void {
  indentWidth.value = next
  localStorage.setItem(indentWidthStorageKey, String(next))
  applyIndentWidth(next)
}

applyIndentWidth(indentWidth.value)

export function useEditorIndent() {
  return {
    indentWidth: readonly(indentWidth),
    setIndentWidth,
  }
}
