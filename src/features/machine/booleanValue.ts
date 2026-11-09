/**
 * Which lines hold a boolean the editor can offer to flip: a column-zero
 * `key: value` whose whole value is one of Python's or Jinja's spellings of a
 * boolean, optionally followed by an inline comment.
 *
 * The colouring already marks such a word as a `boolean`, but it marks the
 * `true` inside a macro's Jinja the same way, and that one is code rather than
 * an option's value. A continuation line is indented, so requiring the key at
 * column zero is what keeps every template body out.
 */

/** configparser takes `#` or `;` as an inline comment only after whitespace. */
const BOOLEAN_OPTION_LINE =
  /^([A-Za-z_][\w.-]*)(\s*[:=]\s*)(True|False|true|false)(?:\s+[#;].*)?\s*$/

export interface BooleanOption {
  option: string
  value: string
  /** Character columns of the value on its line, end exclusive. */
  start: number
  end: number
}

export function booleanOptionIn(line: string): BooleanOption | null {
  const match = BOOLEAN_OPTION_LINE.exec(line)
  if (!match) return null
  const [, option = '', separator = '', value = ''] = match
  const start = option.length + separator.length
  return { option, value, start, end: start + value.length }
}

/** Both values in the file's own spelling, `True` first. */
export function booleanChoices(value: string): [string, string] {
  return value === value.toLowerCase() ? ['true', 'false'] : ['True', 'False']
}

/** The other value, in the same spelling. */
export function flippedBoolean(value: string): string {
  const [yes, no] = booleanChoices(value)
  return value === yes ? no : yes
}
