<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import AppButton, { type AppButtonSize, type AppButtonVariant } from '@/components/AppButton.vue'

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
   * The trigger's shape, for a menu whose trigger has to match the controls
   * beside it rather than the header's default icon button.
   *
   * These were one `triggerClass` string until `AppButton` existed, and the
   * string is what let the mobile navigation trigger ship as
   * `button button--quiet button--block mobile-nav-link` — four tokens, three of
   * them the button system's own, hand-assembled at the call site with nothing
   * checking the combination. The variant and the geometry are props now, and
   * `triggerClass` keeps only what it should ever have carried: the caller's own
   * feature class.
   */
  triggerVariant?: AppButtonVariant | undefined
  triggerSize?: AppButtonSize | undefined
  triggerBlock?: boolean | undefined
  /**
   * Explicit rather than derived: the trigger's content arrives through a slot,
   * so `AppButton` cannot tell an icon from a label the way it can at an
   * ordinary call site.
   */
  triggerIconOnly?: boolean | undefined
  /** Feature classes only — `header-icon`, `mobile-nav-link`. Never a `button--*` token. */
  triggerClass?: string | undefined
}>()

defineSlots<{
  trigger(props: { open: boolean }): unknown
  default(props: { close: () => void }): unknown
}>()

/** Fires only on the closed-to-open edge, for a caller that treats opening as "read" — the header notifications menu marking its contents seen. */
const emit = defineEmits<{ open: [] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle(): void {
  open.value = !open.value
  if (open.value) emit('open')
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

/*
 * The click listener is capture-phase, not bubble. This watcher flushes at the
 * microtask checkpoint *between* listeners of the very click that opened the
 * menu — a checkpoint only real, browser-dispatched events have, which is why
 * no scripted click (tests included) reproduces what it guards against. By
 * that point the same flush may also have re-rendered the trigger's slot:
 * opening the notifications bell marks its warnings read, which swaps the
 * bell glyph and detaches the SVG node the click landed on, so a
 * bubble-phase listener would run for the opening click itself, find
 * `root.contains(event.target)` false, and close the menu in the same
 * dispatch that opened it. In the capture phase the document's stop is
 * already behind the event before any handler can open a menu, so the
 * mid-dispatch attach stays inert for the current click — and later clicks
 * are heard before an inner handler can detach their target (snoozing a
 * warning unmounts its row mid-dispatch the same way).
 */
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('click', onDocumentClick, true)
    document.addEventListener('keydown', onDocumentKeydown)
  } else {
    document.removeEventListener('click', onDocumentClick, true)
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick, true)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div ref="root" class="header-menu">
    <AppButton
      :class="props.triggerClass"
      :variant="props.triggerVariant"
      :size="props.triggerSize ?? 'xs'"
      :block="props.triggerBlock"
      :icon-only="props.triggerIconOnly"
      :badged="props.badge"
      :aria-label="props.label"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="toggle"
    >
      <slot name="trigger" :open="open" />
    </AppButton>
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
