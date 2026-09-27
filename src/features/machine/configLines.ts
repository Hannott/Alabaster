/*
 * What a line of a Klipper config is, as its parser reads it — the one
 * definition both the reindent command and the syntax colouring use, so the
 * editor can never colour a line as part of a macro that Shift+Alt+F would
 * then treat as a key of its own.
 */

export const COMMENT_LINE = /^[#;]/
export const KEY_LINE = /^[^\s#;[][^:=]*[:=]/
/*
 * Deliberately stricter than "starts with a bracket": a continuation line may
 * begin with one — a bracketed value, a Jinja expression — and promoting that to
 * column zero would tear a line out of the macro it belongs to. A Klipper
 * section is a bracketed identifier alone on its line, optionally with a
 * trailing comment, so that is what this asks for.
 */
export const SECTION_LINE = /^\[[A-Za-z_][\w. -]*\]\s*(?:[#;].*)?$/

/**
 * Whether `line` continues the value of the key above it. Only an indented
 * line can, and only while a value is open — outside one, nothing in this
 * format is indented, so an indented `[section]` or `key: value` there is a
 * misindented top-level line rather than a continuation.
 */
export function isContinuationLine(line: string, insideValue: boolean): boolean {
  const indented = line[0] === ' ' || line[0] === '\t'
  return indented && insideValue && !SECTION_LINE.test(line.trim())
}

/** Whether a top-level, non-comment line starts a value later lines may continue. */
export function opensValue(trimmed: string): boolean {
  return !SECTION_LINE.test(trimmed) && KEY_LINE.test(trimmed)
}
