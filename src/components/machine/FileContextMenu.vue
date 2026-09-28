<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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
  panel.querySelector<HTMLElement>('button:not(:disabled), a[href]')?.focus()
}

watch(() => [props.x, props.y], clampIntoViewport, { immediate: true })

const style = computed(() => ({
  insetInlineStart: `${position.value.x}px`,
  insetBlockStart: `${position.value.y}px`,
}))

/*
 * It behaves like the operating system's own context menu: a press anywhere
 * else closes it and still reaches whatever is under the pointer, and any
 * scroll, resize, or loss of window focus closes it, since the row or text it
 * was opened about has moved out from under it. A full-viewport backdrop used
 * to take the dismissing press instead, which swallowed the click the reader
 * meant for the page and froze every scroll area until the menu was dismissed.
 *
 * Listening in the capture phase is what lets the press close the menu before
 * a right-click elsewhere opens the next one, and nothing here prevents it.
 */
function isInside(event: Event): boolean {
  return event.target instanceof Node && (root.value?.contains(event.target) ?? false)
}

function closeFromOutside(event: Event): void {
  if (!isInside(event)) emit('close')
}

function close(): void {
  emit('close')
}

const outsideEvents = ['pointerdown', 'contextmenu', 'wheel', 'scroll'] as const

onMounted(() => {
  for (const type of outsideEvents) {
    document.addEventListener(type, closeFromOutside, { capture: true, passive: true })
  }
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
})

onBeforeUnmount(() => {
  for (const type of outsideEvents) {
    document.removeEventListener(type, closeFromOutside, { capture: true })
  }
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
})

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
    <div
      ref="root"
      class="header-menu__panel file-context-menu"
      :style="style"
      role="menu"
      :aria-label="label"
      @contextmenu.prevent
      @keydown="onKeydown"
    >
      <slot />
    </div>
  </Teleport>
</template>
