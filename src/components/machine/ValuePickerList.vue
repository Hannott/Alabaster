<script setup lang="ts">
/**
 * The list a value picker's chevron opens: AppSelect's own panel and options,
 * hung straight off the box drawn around the value, at its width, so box and
 * list read as one combobox. Placed the way `AppSelect.positionPanel` places
 * its panel — the trigger's left edge, at least its width, kept on screen —
 * with the drawn box as the trigger and no gap.
 *
 * It closes the way the editor's context menu does: on a press anywhere else,
 * on scroll, resize, or loss of window focus, and on Escape.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  box: { left: number; right: number; bottom: number }
  choices: readonly string[]
  current: string
  label: string
}>()

const emit = defineEmits<{ choose: [value: string]; close: [] }>()

const panel = ref<HTMLElement | null>(null)
const activeIndex = ref(Math.max(0, props.choices.indexOf(props.current)))
const position = ref({ left: props.box.left, top: props.box.bottom })
const viewportMargin = 8

const style = computed(() => ({
  left: `${position.value.left}px`,
  top: `${position.value.top}px`,
  minWidth: `${props.box.right - props.box.left}px`,
}))

async function place(): Promise<void> {
  await nextTick()
  const rect = panel.value?.getBoundingClientRect()
  if (!rect) return
  position.value = {
    left: Math.max(
      viewportMargin,
      Math.min(props.box.left, window.innerWidth - rect.width - viewportMargin),
    ),
    top: Math.max(
      viewportMargin,
      Math.min(props.box.bottom, window.innerHeight - rect.height - viewportMargin),
    ),
  }
  panel.value?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + step + props.choices.length) % props.choices.length
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const choice = props.choices[activeIndex.value]
    if (choice !== undefined) emit('choose', choice)
  } else if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  }
}

function closeFromOutside(event: Event): void {
  if (!(event.target instanceof Node) || !panel.value?.contains(event.target)) emit('close')
}

function close(): void {
  emit('close')
}

const outsideEvents = ['pointerdown', 'wheel', 'scroll'] as const

onMounted(() => {
  void place()
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
</script>

<template>
  <Teleport to="body">
    <ul
      ref="panel"
      class="app-select__panel machine-value-picker__panel"
      role="listbox"
      :aria-label="label"
      :aria-activedescendant="`machine-value-picker-${activeIndex}`"
      :style="style"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <li class="app-select__run" role="presentation">
        <ul role="presentation" class="app-select__run-list">
          <li
            v-for="(choice, index) in choices"
            :id="`machine-value-picker-${index}`"
            :key="choice"
            role="option"
            class="app-select__option"
            :class="{ 'app-select__option--active': index === activeIndex }"
            :aria-selected="choice === current"
            @click="emit('choose', choice)"
            @mouseenter="activeIndex = index"
          >
            {{ choice }}
          </li>
        </ul>
      </li>
    </ul>
  </Teleport>
</template>
