<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import type { MacroParameter } from '@/dashboard/macroParams'

/**
 * The small form behind a parameterized macro's caret: one field per
 * parameter, the macro's own literal default as the placeholder, and Send.
 * An empty field omits its parameter so the macro's `|default(...)` applies —
 * the panel never invents a value.
 *
 * It is anchored chrome, not a modal: it reuses the header menu's panel the
 * way Configuration's context menu does, teleported to the body so the card's
 * own `overflow: hidden` cannot clip it, and clamped into the viewport after
 * mount because its size depends on its parameter names.
 *
 * `document.body` is wrong while the card is docked to its settings surface:
 * that surface is a native `<dialog>`, which paints in the browser's top
 * layer regardless of any z-index a body-teleported sibling carries, so the
 * panel rendered behind the surface's own backdrop. `MacroRunControl` resolves
 * the caret's closest open `<dialog>` at open time and passes it here instead
 * — the caret is still mounted in its real position (inside the dock once
 * docked), so its ancestry answers the question correctly without this
 * component needing to know it is inside one.
 */
const props = defineProps<{
  /** Viewport coordinates of the caret's bottom-start corner. */
  x: number
  y: number
  label: string
  params: readonly MacroParameter[]
  /** True while the card is docked to its settings surface — the fields stay
   * usable so a value can be reviewed, but Send is withheld so opening the
   * panel from settings mode can never fire the macro. */
  disabled?: boolean
  /** Teleport target — the caret's closest open `<dialog>`, or `document.body`. */
  to: string | HTMLElement
}>()

const emit = defineEmits<{ send: [values: Record<string, string>]; close: [] }>()

const { t } = useI18n({ useScope: 'global' })
const uid = useId()
const root = ref<HTMLElement | null>(null)
const position = ref({ x: props.x, y: props.y })

// Seeded once and never resynced: a default belongs in the placeholder, so a
// blank submit visibly sends nothing for that parameter rather than silently
// restating the default as a literal.
const drafts = ref<Record<string, string>>(
  Object.fromEntries(props.params.map((param) => [param.name, ''])),
)

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
  panel.querySelector<HTMLElement>('input')?.focus()
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
  <Teleport :to="to">
    <div class="macro-params__backdrop" @pointerdown="emit('close')" @contextmenu.prevent>
      <form
        ref="root"
        class="header-menu__panel macro-params"
        :style="style"
        role="dialog"
        :aria-label="t('dashboard.macros.paramsFor', { macro: props.label })"
        @pointerdown.stop
        @keydown="onKeydown"
        @submit.prevent="disabled ? undefined : emit('send', { ...drafts })"
      >
        <div v-for="param in props.params" :key="param.name" class="macro-params__field">
          <label :for="`${uid}-${param.name}`">{{ param.name }}</label>
          <input
            :id="`${uid}-${param.name}`"
            v-model="drafts[param.name]"
            class="field field--value"
            type="text"
            :placeholder="param.defaultValue ?? undefined"
            enterkeyhint="send"
          />
        </div>
        <AppButton
          variant="primary"
          block
          :label="t('dashboard.macros.send')"
          type="submit"
          :disabled="disabled"
        />
      </form>
    </div>
  </Teleport>
</template>
