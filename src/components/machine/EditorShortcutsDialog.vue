<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'

/*
 * The third content-preview instance of `dialog-system.md`'s Shape 3
 * (`ImageLightbox`'s pattern): a reference to read, with nothing to decide, so
 * `[x]`, `Escape`, and a click on the backdrop all close it.
 *
 * It exists because the editor's line commands were keyboard-only and nothing
 * in the interface named them — a command nobody can find is built for whoever
 * already knew it was there. See docs/design/configuration-editor.md's "Line
 * commands".
 *
 * The rows are data rather than markup so a command added to the editor is one
 * entry here plus its two locale keys, and never a second block of hand-written
 * table cells that drifts from the handler.
 */
const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)

const groups: ReadonlyArray<{ id: string; items: readonly string[] }> = [
  {
    id: 'editing',
    items: ['comment', 'move', 'duplicate', 'indent', 'outdent', 'format', 'continue'],
  },
  { id: 'navigation', items: ['historyBack', 'historyForward', 'openInclude', 'exitFullscreen'] },
  { id: 'file', items: ['save', 'saveRestart'] },
]

function shortcut(item: string, part: 'keys' | 'label'): string {
  return t(`configuration.shortcuts.items.${item}.${part}`)
}

watch(
  () => props.open,
  (isOpen) => {
    const element = dialog.value
    if (!element) return
    if (isOpen && !element.open) element.showModal()
    if (!isOpen && element.open) element.close()
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})

/**
 * The header and the body tile the dialog's box edge to edge, so a click's
 * target can equal the `<dialog>` element itself only when it lands on the true
 * backdrop — the same trick `ImageLightbox.vue` uses.
 */
function handleDialogClick(event: MouseEvent): void {
  if (event.target === dialog.value) emit('close')
}
</script>

<template>
  <dialog
    ref="dialog"
    class="editor-shortcuts-dialog"
    aria-labelledby="editor-shortcuts-title"
    @cancel.prevent="emit('close')"
    @click="handleDialogClick"
  >
    <header class="editor-shortcuts-dialog__header">
      <AppIcon name="help" class="size-5 text-action" aria-hidden="true" />
      <h2 id="editor-shortcuts-title" class="editor-shortcuts-dialog__title truncate">
        {{ t('configuration.shortcuts.title') }}
      </h2>
      <AppButton
        icon-only
        icon="close"
        :aria-label="t('configuration.shortcuts.close')"
        @click="emit('close')"
      />
    </header>

    <div class="editor-shortcuts-dialog__body">
      <section v-for="group in groups" :key="group.id" class="editor-shortcuts__group">
        <h3 class="text-label-caps text-muted">
          {{ t(`configuration.shortcuts.groups.${group.id}`) }}
        </h3>
        <dl class="editor-shortcuts__list">
          <template v-for="item in group.items" :key="item">
            <dt>
              <kbd class="editor-shortcuts__keys">{{ shortcut(item, 'keys') }}</kbd>
            </dt>
            <dd class="text-sm leading-6 text-muted">{{ shortcut(item, 'label') }}</dd>
          </template>
        </dl>
      </section>
    </div>
  </dialog>
</template>
