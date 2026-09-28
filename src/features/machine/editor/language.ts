/**
 * Klipper's configuration format as a CodeMirror language.
 *
 * `syntax.ts` is already a streaming tokenizer — one line coloured against the
 * state the lines above it left behind — which is exactly the shape
 * CodeMirror's `StreamParser` asks for, so this adapter carries no colouring
 * rules of its own. Everything about *what* a token is stays in `syntax.ts`,
 * where it is pure and testable; this file only says how a token reaches the
 * screen.
 *
 * The colours themselves stay in `components.css` under the same
 * `machine-syntax--*` classes the old highlight layer used, rather than moving
 * into a CodeMirror theme object. A theme object would have to name colours in
 * JavaScript, which puts them outside the `--syntax-*` roles a theme pack
 * implements and outside the contrast spec that checks them.
 */

import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import type { StreamParser } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { Tag } from '@lezer/highlight'

import {
  initialSyntaxState,
  MACHINE_SYNTAX_KINDS,
  tokenizeMachineLine,
  type MachineSyntaxKind,
  type MachineSyntaxState,
  type MachineSyntaxToken,
} from '@/features/machine/syntax'

/**
 * The line tokenizer's output, held while CodeMirror walks the line asking for
 * one token at a time. `syntax.ts` colours a whole line at once — a value's
 * meaning depends on the key that opened it, which a character-at-a-time
 * scanner cannot see — so the line is tokenized when the stream reaches its
 * start and handed out piece by piece from here.
 */
interface MachineStreamState {
  syntax: MachineSyntaxState
  tokens: MachineSyntaxToken[]
  index: number
}

const machineTags = Object.fromEntries(
  MACHINE_SYNTAX_KINDS.map((kind) => [kind, Tag.define()]),
) as Record<MachineSyntaxKind, Tag>

const parser: StreamParser<MachineStreamState> = {
  name: 'klipper-config',
  startState: () => ({ syntax: initialSyntaxState(), tokens: [], index: 0 }),
  /*
   * CodeMirror keeps copies of the state at line boundaries so an edit
   * re-parses from the nearest one rather than from the top of the file. The
   * syntax state is mutated in place by the tokenizer, so it has to be copied
   * rather than shared, or a re-parse from an old checkpoint would read a
   * state some later line had already advanced.
   */
  copyState: (state) => ({
    syntax: { ...state.syntax },
    tokens: state.tokens,
    index: state.index,
  }),
  token(stream, state) {
    if (stream.sol()) {
      state.tokens = tokenizeMachineLine(stream.string, state.syntax)
      state.index = 0
    }
    const token = state.tokens[state.index]
    if (!token || token.text.length === 0) {
      stream.skipToEnd()
      return null
    }
    state.index += 1
    stream.pos = Math.min(stream.string.length, stream.pos + token.text.length)
    return token.kind === 'plain' ? null : token.kind
  },
  /*
   * An empty line is never handed to `token`, and it is not nothing: a blank
   * line inside a `gcode:` block keeps that block open, the way configparser
   * reads it. Advancing the state here is what keeps a macro body coloured as
   * a macro body across the blank lines inside it.
   */
  blankLine(state) {
    tokenizeMachineLine('', state.syntax)
  },
  tokenTable: machineTags,
}

export const machineConfigLanguage = StreamLanguage.define(parser)

const machineHighlightStyle = HighlightStyle.define(
  MACHINE_SYNTAX_KINDS.filter((kind) => kind !== 'plain').map((kind) => ({
    tag: machineTags[kind],
    class: `machine-syntax--${kind}`,
  })),
)

/** The language and its colouring, for a file `isConfigSyntaxFile` accepts. */
export const machineConfigSyntax: Extension = [
  machineConfigLanguage,
  syntaxHighlighting(machineHighlightStyle),
]
