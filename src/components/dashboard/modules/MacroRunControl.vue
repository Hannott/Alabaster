<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import MacroParamsPanel from '@/components/dashboard/modules/MacroParamsPanel.vue'
import type { MacroParameter } from '@/dashboard/macroParams'

/**
 * One macro on the card. A parameterless macro is the plain one-tap button it
 * has always been; a macro whose body reads parameters becomes a split
 * control — the main segment still runs it bare, so the macro's own defaults
 * apply and nothing gets slower, and the caret opens the parameter panel.
 * The caret is what says a form exists before anything is pressed: a run and
 * an ask must not be the same-looking tap.
 */
const props = defineProps<{
  label: string
  isMissing: boolean
  isRunning: boolean
  params: readonly MacroParameter[]
  /** A CSS color reference (`var(--color-data-*)`), or null for no accent. */
  colorVariable: string | null
  /** True while this card is docked to its own settings surface. The run
   * segment and Send are withheld so reordering or recoloring macros there
   * can never fire one by accident; the caret stays open so a parameter can
   * still be reviewed. */
  disabled?: boolean
}>()

const emit = defineEmits<{ run: [params?: Record<string, string>] }>()

const { t } = useI18n({ useScope: 'global' })
/** An `AppButton` instance; `caretEl` is the element the panel is measured from. */
const caret = ref<InstanceType<typeof AppButton> | null>(null)
const caretEl = computed(() => caret.value?.el ?? null)
const panel = ref<{ x: number; y: number; target: HTMLElement } | null>(null)

// A missing macro's parameters describe a body the printer no longer has, so
// the caret goes with the run.
const hasParams = computed(() => props.params.length > 0 && !props.isMissing)

const runTitle = computed(() =>
  props.isMissing
    ? t('dashboard.macros.missing', { macro: props.label })
    : t('dashboard.macros.run', { macro: props.label }),
)

const hasAccent = computed(() => Boolean(props.colorVariable) && !props.isMissing)
// Set once on the wrapper so both the run segment and the caret can border
// themselves from it — a custom property inherits, so neither child needs
// its own copy of the same style binding.
const accentStyle = computed(() =>
  hasAccent.value ? { '--macro-accent-color': props.colorVariable as string } : undefined,
)

function openPanel(): void {
  const rect = caretEl.value?.getBoundingClientRect()
  if (!rect) return
  // The settings surface is a native `<dialog>`, which paints in the browser's
  // top layer ahead of any body-teleported sibling regardless of z-index —
  // teleporting into that dialog when the card is docked inside one is what
  // keeps the panel above it instead of hidden behind its backdrop.
  const target = caretEl.value?.closest<HTMLElement>('dialog[open]') ?? document.body
  panel.value = { x: rect.left, y: rect.bottom + 4, target }
}

function closePanel(): void {
  panel.value = null
  caret.value?.focus()
}

function send(values: Record<string, string>): void {
  closePanel()
  emit('run', values)
}
</script>

<template>
  <div class="macro-control" :style="accentStyle">
    <AppButton
      mono
      class="macro-control__run"
      :class="{
        'macro-control__run--split': hasParams,
        'macro-control__run--missing': isMissing,
        'macro-control__run--accent': hasAccent,
      }"
      :pending="isRunning"
      :aria-busy="isRunning || undefined"
      :disabled="isMissing || disabled"
      :title="runTitle"
      :aria-label="runTitle"
      @click="emit('run')"
    >
      <AppIcon v-if="isMissing" name="emergency" class="size-5 shrink-0" aria-hidden="true" />
      <span v-else-if="hasAccent" class="macro-control__accent-dot" aria-hidden="true"></span>
      <span class="truncate">{{ label }}</span>
    </AppButton>
    <AppButton
      v-if="hasParams"
      ref="caret"
      class="macro-control__params"
      :class="{ 'macro-control__params--accent': hasAccent }"
      icon="down"
      :pending="isRunning"
      aria-haspopup="dialog"
      :aria-expanded="panel !== null"
      :title="t('dashboard.macros.openParams', { macro: label })"
      :aria-label="t('dashboard.macros.openParams', { macro: label })"
      @click="panel ? closePanel() : openPanel()"
    />
    <MacroParamsPanel
      v-if="panel"
      :x="panel.x"
      :y="panel.y"
      :label="label"
      :params="params"
      :disabled="disabled"
      :to="panel.target"
      @send="send"
      @close="closePanel"
    />
  </div>
</template>
