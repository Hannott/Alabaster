<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  label: string
  align?: 'start' | 'end'
  badge?: boolean
  /** Extra class for the panel, so a menu with its own sizing needs isn't stuck with the default width band. */
  panelClass?: string
  /**
   * Which side of the trigger the panel opens on. The header opens downward;
   * the mobile navigation sits at the bottom of the viewport and has to open
   * upward, or its panel would be off-screen.
   */
  placement?: 'below' | 'above'
  /**
   * Button classes for the trigger, for a menu whose trigger has to match the
   * controls beside it rather than the header's icon buttons. Still a documented
   * `button-system.md` variant — this chooses among them, it does not add one.
   */
  triggerClass?: string
}>()

defineSlots<{
  trigger(props: { open: boolean }): unknown
  default(props: { close: () => void }): unknown
}>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle(): void {
  open.value = !open.value
}

function close(): void {
  open.value = false
}

function onDocumentClick(event: MouseEvent): void {
  if (!root.value?.contains(event.target as Node)) close()
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onDocumentKeydown)
  } else {
    document.removeEventListener('click', onDocumentClick)
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div ref="root" class="header-menu">
    <button
      type="button"
      :class="[props.triggerClass ?? 'button button--xs', { 'button--badged': props.badge }]"
      :aria-label="props.label"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="toggle"
    >
      <slot name="trigger" :open="open" />
    </button>
    <div
      v-if="open"
      class="header-menu__panel"
      :class="[
        `header-menu__panel--${props.align ?? 'end'}`,
        `header-menu__panel--${props.placement ?? 'below'}`,
        props.panelClass,
      ]"
      role="menu"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
