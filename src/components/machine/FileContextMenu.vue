<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{
  /** Viewport coordinates of the pointer that opened the menu. */
  x: number
  y: number
  label: string
}>()

const emit = defineEmits<{ close: [] }>()

const root = ref<HTMLElement | null>(null)
const position = ref({ x: props.x, y: props.y })

/*
 * A context menu opens at the pointer, which may be close enough to the viewport
 * edge that the panel would overflow it. Measuring after mount and clamping is
 * the only way to know: the panel's size depends on its localized labels.
 */
async function clampIntoViewport(): Promise<void> {
  await nextTick()
  const panel = root.value
  if (!panel) return
  const { width, height } = panel.getBoundingClientRect()
  const margin = 8
  position.value = {
    x: Math.max(margin, Math.min(props.x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(props.y, window.innerHeight - height - margin)),
  }
  // Focus moves into the menu so Escape and Tab behave, and so a keyboard user
  // who opened it with the context-menu key is not left behind on the row.
  panel.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
}

watch(() => [props.x, props.y], clampIntoViewport, { immediate: true })

const style = computed(() => ({
  insetInlineStart: `${position.value.x}px`,
  insetBlockStart: `${position.value.y}px`,
}))

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}
</script>

<template>
  <!--
    Teleported to the body so the panel is never clipped by the explorer's own
    scroll containers, and rendered above the workspace.
  -->
  <Teleport to="body">
    <div class="file-context-menu__backdrop" @pointerdown="emit('close')" @contextmenu.prevent>
      <div
        ref="root"
        class="header-menu__panel file-context-menu"
        :style="style"
        role="menu"
        :aria-label="label"
        @pointerdown.stop
        @keydown="onKeydown"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
