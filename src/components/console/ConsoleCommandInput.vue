<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import type { MacroParameter } from '@/dashboard/macroParams'
import {
  atParamBoundary,
  commandNameFromLine,
  completeCommand,
  unfilledMacroParams,
} from '@/services/console/transcript'

/**
 * The console's prompt, shared by the card and the page. It owns its draft and
 * nothing else: sending, echoing and remembering all belong to the store, so
 * what the user typed reaches the transcript on the same tick as the keystroke
 * rather than after a round-trip.
 *
 * A textarea rather than an input because Klipper accepts a multi-line script
 * and pasting a short macro is a real console job; a single-line field would
 * silently flatten it. Enter sends, Shift+Enter adds a line, and the field grows
 * only as far as `maximumRows` so a long paste cannot push the transcript away.
 */
const props = withDefaults(
  defineProps<{
    /** Newest last, as the store keeps it. Walked with the arrow keys. */
    history?: readonly string[]
    /** Every command the machine knows, for Tab completion. */
    commands?: readonly string[]
    /**
     * Looks up what a macro can be called with, by name. A plain function
     * rather than a precomputed table: the only macro whose parameters are
     * ever needed is the one on the current line, and parsing every macro in
     * `configfile.settings` on each keystroke would work through names that
     * are never typed.
     */
    getMacroParams?: (macroName: string) => readonly MacroParameter[]
    disabled?: boolean
    /**
     * A command sent from here is still in flight. The field stays editable —
     * composing the next line while the printer works is the point of a console
     * — but sending is held until the answer arrives, because the store refuses
     * a second dispatch and refusing it after the echo would put a command in
     * the transcript that never ran.
     */
    pending?: boolean
  }>(),
  {
    history: () => [],
    commands: () => [],
    getMacroParams: () => [],
    disabled: false,
    pending: false,
  },
)

const emit = defineEmits<{ send: [command: string] }>()

const { t } = useI18n({ useScope: 'global' })
const field = ref<HTMLTextAreaElement | null>(null)
const draft = ref('')
/**
 * How far back through the history the arrow keys have walked. Null means "at the
 * prompt", which is what makes ↓ able to return to the draft rather than to the
 * newest history entry.
 */
const historyOffset = ref<number | null>(null)
/**
 * The candidates a Tab press could not narrow to one. Shown above the prompt
 * rather than appended to the transcript: a completion is a question the user
 * asked the input, not something the printer said, and the log stays a record of
 * the machine.
 */
const completions = ref<string[]>([])
/**
 * Whether the caret sits at the very end of the draft. The ghost preview can
 * only ever be drawn there — see `console-prompt__ghost`'s doc comment — so a
 * click or an arrow key that moves the caret elsewhere has to hide it even
 * though the text itself has not changed. Not derived from `draft` and the
 * DOM together in a computed: `selectionStart` is not a reactive source, so
 * nothing would tell Vue to re-read it. Synced on the events that can move the
 * caret without changing the text; the accept action below covers the ones
 * that do.
 */
const caretAtEnd = ref(true)
/**
 * Which unfilled parameter Tab has cycled to, as an offset into
 * `unfilledParams` rather than a name — a name would go stale the instant a
 * parameter is filled and drops out of that list. Reset whenever the draft
 * changes: typing invalidates whatever was being browsed, and the set of
 * parameters left to fill may itself have just changed.
 */
const paramCycleOffset = ref(0)

const lastLine = computed(() => {
  const lines = draft.value.split('\n')
  return lines[lines.length - 1] ?? ''
})
const activeMacroParams = computed(() => {
  const macroName = commandNameFromLine(lastLine.value)
  return macroName ? props.getMacroParams(macroName) : []
})
const unfilledParams = computed(() => unfilledMacroParams(lastLine.value, activeMacroParams.value))
/**
 * The parameter the ghost text offers right now, or null when there is
 * nothing to offer — no macro on this line, nothing left to fill, the caret
 * mid-word rather than at a boundary, or not at the end of the draft at all.
 * Both `onTab` and the template read this one computed rather than
 * re-deriving it, so the key that accepts a suggestion and the text that
 * shows it can never disagree about what is being offered.
 */
const suggestedParam = computed<MacroParameter | null>(() => {
  if (!caretAtEnd.value || unfilledParams.value.length === 0) return null
  if (!atParamBoundary(lastLine.value)) return null
  const index = paramCycleOffset.value % unfilledParams.value.length
  return unfilledParams.value[index] ?? null
})

watch(draft, () => {
  paramCycleOffset.value = 0
})

function syncCaretState(): void {
  const element = field.value
  if (!element) return
  caretAtEnd.value =
    element.selectionStart === draft.value.length && element.selectionEnd === draft.value.length
}

function acceptSuggestion(): void {
  const param = suggestedParam.value
  if (!param) return
  draft.value = `${draft.value}${param.name}=`
  void nextTick(() => {
    const position = draft.value.length
    field.value?.setSelectionRange(position, position)
    caretAtEnd.value = true
  })
}

/**
 * Steps the shown suggestion forward or backward, wrapping around. A no-op
 * with at most one candidate — there is nowhere else to cycle to — so Tab
 * with a single unfilled parameter still counts as "handled" rather than
 * falling through to command completion below it.
 */
function cycleSuggestion(direction: 1 | -1): void {
  const count = unfilledParams.value.length
  if (count < 2) return
  paramCycleOffset.value = (paramCycleOffset.value + direction + count) % count
}

/**
 * Right Arrow completes the parameter currently on offer. Safe to claim
 * unconditionally whenever a suggestion is showing: `suggestedParam` already
 * requires the caret to be at the very end of the draft, which is exactly
 * where a native Right Arrow press would do nothing anyway.
 */
function onArrowRight(event: KeyboardEvent): void {
  if (!suggestedParam.value) return
  event.preventDefault()
  acceptSuggestion()
}

const maximumRows = 5
const rows = computed(() => Math.min(draft.value.split('\n').length, maximumRows))
/**
 * `pending` belongs here rather than only on the submit button's `disabled`:
 * Enter is the way this field is actually used, and a guard that only the button
 * carries is a guard the keyboard walks straight past — which is how a command
 * reached `sendConsoleCommand` mid-flight and got echoed without being sent.
 */
const canSend = computed(() => draft.value.trim() !== '' && !props.disabled && !props.pending)

function focus(): void {
  field.value?.focus()
}

/**
 * Puts text in the prompt with the caret at its end, so what was filled can be
 * extended rather than overwritten by the next keystroke.
 *
 * Deliberately does not touch `historyOffset`: the history walk calls this for
 * every step, and resetting the offset here would send each ArrowUp back to the
 * newest entry instead of moving further back.
 */
async function setDraft(command: string): Promise<void> {
  draft.value = command
  completions.value = []
  await nextTick()
  focus()
  field.value?.setSelectionRange(command.length, command.length)
  caretAtEnd.value = true
}

/**
 * Fills the prompt from outside the history — a command clicked in the
 * transcript, or a chosen completion. That ends whatever walk was in progress,
 * so the next ArrowUp starts again from the newest command rather than from
 * wherever the last walk happened to stop.
 */
async function fill(command: string): Promise<void> {
  historyOffset.value = null
  await setDraft(command)
}

function send(): void {
  if (!canSend.value) return
  emit('send', draft.value)
  draft.value = ''
  historyOffset.value = null
  completions.value = []
}

function onEnter(event: KeyboardEvent): void {
  // Shift+Enter is a newline, which is the only way to build a multi-line script
  // in a field whose Enter has to mean "send".
  if (event.shiftKey) return
  event.preventDefault()
  send()
}

/*
 * The arrow keys only walk the history from the edges of the draft. With a
 * multi-line script in the field, ↑ on line two has to move the caret — hijacking
 * it there would make the field impossible to edit.
 */
function isOnFirstLine(): boolean {
  const element = field.value
  if (!element) return true
  return !element.value.slice(0, element.selectionStart).includes('\n')
}

function isOnLastLine(): boolean {
  const element = field.value
  if (!element) return true
  return !element.value.slice(element.selectionStart).includes('\n')
}

function onArrowUp(event: KeyboardEvent): void {
  if (props.history.length === 0 || !isOnFirstLine()) return
  event.preventDefault()
  const next = historyOffset.value === null ? props.history.length - 1 : historyOffset.value - 1
  if (next < 0) return
  historyOffset.value = next
  void setDraft(props.history[next] ?? '')
}

function onArrowDown(event: KeyboardEvent): void {
  if (historyOffset.value === null || !isOnLastLine()) return
  event.preventDefault()
  const next = historyOffset.value + 1
  if (next >= props.history.length) {
    // Walking off the newest entry returns to an empty prompt rather than
    // sticking on the last command, which is what makes the walk escapable.
    historyOffset.value = null
    draft.value = ''
    return
  }
  historyOffset.value = next
  void setDraft(props.history[next] ?? '')
}

function onTab(event: KeyboardEvent): void {
  // A parameter suggestion, when one is showing, takes Tab and Shift+Tab
  // before command-name completion gets a look at either: Tab steps to the
  // next candidate, Shift+Tab to the previous, and Right Arrow is what
  // actually fills one in. Claimed unconditionally rather than only once
  // `completeCommand` would otherwise trim the trailing space this feature
  // depends on, off a fragment like "RUN_PA_TEST " that already names a real
  // command — the same reasoning, applied before that edge case can occur.
  if (suggestedParam.value) {
    event.preventDefault()
    cycleSuggestion(event.shiftKey ? -1 : 1)
    return
  }
  // Nothing to complete means Tab keeps its job of leaving the field, which is
  // the only way out for a keyboard user.
  if (draft.value.trim() === '' || props.commands.length === 0) return
  event.preventDefault()
  const element = field.value
  const caret = element?.selectionStart ?? draft.value.length
  const lineStart = draft.value.lastIndexOf('\n', caret - 1) + 1
  const fragment = draft.value.slice(lineStart, caret)
  const { value, matches } = completeCommand(fragment, props.commands)
  completions.value = matches.length > 1 ? matches : []
  if (value === fragment) return
  const completed = draft.value.slice(0, lineStart) + value + draft.value.slice(caret)
  draft.value = completed
  void nextTick(() => {
    const position = lineStart + value.length
    field.value?.setSelectionRange(position, position)
  })
}

defineExpose({ fill, focus })
</script>

<template>
  <div class="console-prompt">
    <!--
      The candidate list is ephemeral and never scrolls the page: it replaces
      itself on the next Tab and disappears on send, so it cannot accumulate
      above the prompt.
    -->
    <ul v-if="completions.length" class="console-prompt__completions">
      <li v-for="candidate in completions" :key="candidate">
        <AppButton variant="quiet" size="xs" :label="candidate" @click="fill(candidate)" />
      </li>
    </ul>
    <!--
      The row count reaches CSS as a custom property because two controls have
      to agree on one height: the field's own box, and the square send button
      beside it. See `--console-prompt-size` in main.css for why one expression
      states both rather than the button matching a height the browser worked
      out for the textarea.
    -->
    <form
      class="console-prompt__form"
      :style="{ '--console-prompt-rows': rows }"
      @submit.prevent="send"
    >
      <label class="sr-only" for="console-command">{{ t('console.commandLabel') }}</label>
      <span class="console-prompt__marker" aria-hidden="true">&gt;</span>
      <div class="console-prompt__field-wrap">
        <!--
          Sits on top of the field rather than behind it: the invisible span
          matching what's already typed has to occupy identical layout space so
          the suggestion lands exactly where the caret is, and `color:
          transparent` rather than `visibility: hidden` means it paints nothing
          over the field's own text instead of reserving an opaque box. Only
          ever correct while the caret is at the very end of the draft — see
          `suggestedParam` — which is the one position this technique can place
          text without measuring the caret in pixels.
        -->
        <div v-if="suggestedParam" class="console-prompt__ghost" aria-hidden="true">
          <span class="console-prompt__ghost-typed">{{ draft }}</span
          ><span class="console-prompt__ghost-suggestion">{{ suggestedParam.name }}=</span>
        </div>
        <textarea
          id="console-command"
          ref="field"
          v-model="draft"
          class="field field--sm console-prompt__field"
          :rows="rows"
          :placeholder="t('console.placeholder')"
          :disabled="disabled"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          @keydown.enter="onEnter"
          @keydown.up="onArrowUp"
          @keydown.down="onArrowDown"
          @keydown.right="onArrowRight"
          @keydown.tab="onTab"
          @input="syncCaretState"
          @click="syncCaretState"
          @keyup="syncCaretState"
        ></textarea>
      </div>
      <p class="sr-only" aria-live="polite">
        {{ suggestedParam ? t('console.paramSuggested', { name: suggestedParam.name }) : '' }}
      </p>
      <!--
        The shared pending treatment, not a bare disabled button: with the
        transport's deadline waived for a typed line, a mesh calibration or a
        heat-up sent from here holds the prompt for as long as the printer takes,
        and a control that is merely greyed out for a minute reads as broken. The
        label and icon do not change, per button-system.md's one state model.
      -->
      <AppButton
        variant="primary"
        size="sm"
        icon-only
        :pending="pending"
        class="console-prompt__send"
        type="submit"
        :disabled="!canSend"
        :aria-busy="pending || undefined"
        :aria-label="t('console.send')"
        :title="t('console.send')"
      >
        <AppIcon name="send" class="size-5" aria-hidden="true" />
      </AppButton>
    </form>
  </div>
</template>
