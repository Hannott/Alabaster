<script setup lang="ts">
/**
 * A styled stand-in for `<select>`.
 *
 * A native `<select>` cannot be fully themed: the closed control takes
 * `background`/`color`, but most browsers render the open option list with
 * their own colours, and a page that sets `color` on the control without also
 * setting it on `<option>` gets light text on the browser's own light popup —
 * unreadable in a dark theme. Firefox goes the other way and mostly ignores
 * author styling on the popup outright. Either way there is no cross-browser
 * way to make the open list match the rest of the interface.
 *
 * This is the headless-primitive exception `AGENTS.md` allows: the native
 * element cannot be themed, and real listbox keyboard behaviour (arrow keys,
 * Home/End, typeahead) is implemented rather than assumed.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'

/** How far below the trigger the panel opens, and the clamp margin from every viewport edge. */
const panelGapPx = 6
const viewportMarginPx = 8

export interface AppSelectOption {
  value: string
  label: string
  /**
   * Optional family heading. Consecutive options sharing one are drawn under a
   * single heading, and options with none stand on their own — a list long
   * enough to need families almost always has a few entries that belong to no
   * family, and forcing those under an "Other" heading is worse than leaving
   * them unheaded.
   */
  group?: string | undefined
}

const props = defineProps<{
  options: readonly AppSelectOption[]
  /** The control's accessible name. There is no visible label inside it. */
  label: string
  disabled?: boolean
}>()

/**
 * The selected value. `defineModel` rather than a hand-rolled `modelValue`
 * prop with an `update:modelValue` emit — one declaration carries both, and
 * this component is the canonical example to copy when a component needs a
 * v-model.
 */
const model = defineModel<string>({ required: true })

const root = ref<HTMLElement | null>(null)
/**
 * The trigger is an `AppButton`, so the ref holds a component instance rather
 * than the element. `triggerEl` below is the element the panel is measured and
 * teleported from; `focus()` comes off the instance, which exposes it.
 */
const trigger = ref<InstanceType<typeof AppButton> | null>(null)
const triggerEl = computed(() => trigger.value?.el ?? null)
const panel = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)
const optionRefs = ref<HTMLElement[]>([])

/**
 * Where the panel is teleported to, resolved fresh each time it opens: the
 * card grid's `overflow: hidden` would otherwise clip it at the card edge —
 * the same failure `interface-standards.md`'s "One popover look" names for
 * the header-menu family — and a native `<dialog>` paints in the browser's
 * top layer ahead of anything teleported to `document.body`, so a select
 * opened from inside a docked settings surface has to land inside that
 * dialog instead, the same resolution `MacroRunControl` does for its caret.
 */
const teleportTarget = ref<HTMLElement>(document.body)
const panelStyle = ref({ left: '0px', top: '0px', minWidth: '0px' })

const selectedIndex = computed(() =>
  Math.max(
    0,
    props.options.findIndex((option) => option.value === model.value),
  ),
)
const selectedLabel = computed(
  () => props.options.find((option) => option.value === model.value)?.label ?? '',
)

/**
 * The options in runs of a shared family, each entry keeping the index it has
 * in the flat list. Grouping is presentation only: arrow keys, Home/End, and
 * the active-option ref list all still walk the flat `options` array, so a
 * heading can never be landed on and can never shift what a key press selects.
 */
const optionRuns = computed(() => {
  const runs: Array<{
    group?: string | undefined
    items: Array<{ option: AppSelectOption; index: number }>
  }> = []
  props.options.forEach((option, index) => {
    const last = runs[runs.length - 1]
    if (last && last.group === option.group) last.items.push({ option, index })
    else runs.push({ group: option.group, items: [{ option, index }] })
  })
  return runs
})

function toggle(): void {
  if (props.disabled) return
  open.value = !open.value
}

function close(): void {
  open.value = false
}

/**
 * Closes and hands focus back to the trigger. Used for Escape and for making a
 * choice, where the panel is gone and something must hold focus. Tab and a
 * click outside are left to plain `close()`: focus is already moving
 * somewhere else there, and pulling it back to the trigger would fight that.
 */
function closeAndReturnFocus(): void {
  close()
  trigger.value?.focus()
}

function choose(value: string): void {
  model.value = value
  closeAndReturnFocus()
}

/**
 * The panel is teleported out of `root`, so a click landing on it — a group
 * heading, the scrollbar gutter, anywhere that is not an option's own
 * `@click` — is no longer contained by `root` and must be checked against the
 * panel separately or every such click would close the list out from under it.
 */
function onDocumentClick(event: MouseEvent): void {
  const target = event.target as Node
  if (!root.value?.contains(target) && !panel.value?.contains(target)) close()
}

/**
 * Placed from the trigger's own `getBoundingClientRect()` rather than CSS
 * inset, since the panel no longer shares a containing block with `.app-select`
 * once teleported. Recomputed on open and on every resize/scroll while open,
 * since a dashboard grid reflow (a column count breakpoint, a window resize)
 * moves the trigger without the panel's own geometry knowing to follow.
 */
function positionPanel(): void {
  const triggerRect = triggerEl.value?.getBoundingClientRect()
  const panelRect = panel.value?.getBoundingClientRect()
  if (!triggerRect || !panelRect) return
  const left = Math.max(
    viewportMarginPx,
    Math.min(
      triggerRect.right - panelRect.width,
      window.innerWidth - panelRect.width - viewportMarginPx,
    ),
  )
  const top = Math.max(
    viewportMarginPx,
    Math.min(
      triggerRect.bottom + panelGapPx,
      window.innerHeight - panelRect.height - viewportMarginPx,
    ),
  )
  panelStyle.value = { left: `${left}px`, top: `${top}px`, minWidth: `${triggerRect.width}px` }
}

function moveActive(delta: number): void {
  const count = props.options.length
  if (count === 0) return
  activeIndex.value = (activeIndex.value + delta + count) % count
  optionRefs.value[activeIndex.value]?.scrollIntoView?.({ block: 'nearest' })
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (props.disabled) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
    event.preventDefault()
    open.value = true
  }
}

function onListKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveActive(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveActive(-1)
      break
    case 'Home':
      event.preventDefault()
      activeIndex.value = 0
      break
    case 'End':
      event.preventDefault()
      activeIndex.value = props.options.length - 1
      break
    case 'Enter':
    case ' ': {
      event.preventDefault()
      const option = props.options[activeIndex.value]
      if (option) choose(option.value)
      break
    }
    case 'Escape':
      event.preventDefault()
      closeAndReturnFocus()
      break
    case 'Tab':
      close()
      break
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    activeIndex.value = selectedIndex.value
    teleportTarget.value = triggerEl.value?.closest<HTMLElement>('dialog[open]') ?? document.body
    document.addEventListener('click', onDocumentClick)
    window.addEventListener('resize', positionPanel)
    // Scroll events do not bubble, so this has to listen during capture to
    // hear one from any scrollable ancestor between the trigger and the window.
    window.addEventListener('scroll', positionPanel, true)
    void nextTick(() => {
      positionPanel()
      panel.value?.focus()
      optionRefs.value[activeIndex.value]?.scrollIntoView?.({ block: 'nearest' })
    })
  } else {
    document.removeEventListener('click', onDocumentClick)
    window.removeEventListener('resize', positionPanel)
    window.removeEventListener('scroll', positionPanel, true)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('resize', positionPanel)
  window.removeEventListener('scroll', positionPanel, true)
})
</script>

<template>
  <div ref="root" class="app-select">
    <AppButton
      ref="trigger"
      size="sm"
      class="app-select__trigger"
      :disabled="disabled"
      :aria-label="label"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="truncate">{{ selectedLabel }}</span>
      <AppIcon name="down" class="size-4 shrink-0" aria-hidden="true" />
    </AppButton>
    <Teleport v-if="open" :to="teleportTarget">
      <ul
        ref="panel"
        class="app-select__panel"
        role="listbox"
        :aria-label="label"
        :style="panelStyle"
        tabindex="-1"
        @keydown="onListKeydown"
      >
        <li
          v-for="run in optionRuns"
          :key="run.group ?? run.items[0]?.option.value"
          :role="run.group ? 'group' : 'presentation'"
          :aria-label="run.group"
          class="app-select__run"
        >
          <span v-if="run.group" class="app-select__group" aria-hidden="true">{{ run.group }}</span>
          <ul role="presentation" class="app-select__run-list">
            <li
              v-for="entry in run.items"
              :key="entry.option.value"
              :ref="
                (el) => {
                  if (el) optionRefs[entry.index] = el as HTMLElement
                }
              "
              role="option"
              class="app-select__option"
              :class="{ 'app-select__option--active': entry.index === activeIndex }"
              :aria-selected="entry.option.value === model"
              @click="choose(entry.option.value)"
              @mouseenter="activeIndex = entry.index"
            >
              {{ entry.option.label }}
            </li>
          </ul>
        </li>
      </ul>
    </Teleport>
  </div>
</template>
