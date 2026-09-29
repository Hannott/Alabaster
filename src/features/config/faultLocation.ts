/**
 * The config line a Klipper start-up error is about.
 *
 * Klipper names the section, and for an option error the option, in quotes —
 * `Section 'x' is not a valid config section`, `Option 'o' in section 'x' must
 * be specified`, `Choice 'c' for option 'o' in section 'x' is not a valid
 * choice` — but never the file or line. Finding it means reading the
 * configuration the way Klipper does, which `optionLocator` already does.
 *
 * Kept free of Vue and the stores so the message grammar is testable on its own.
 */

import { optionKey, sectionKey, type ConfigIndex } from '@/features/config/optionLocator'

export interface FaultReference {
  section: string
  option: string | null
  /** Columns of the section name inside the message, quotes excluded. */
  start: number
  end: number
}

const SECTION_REFERENCE = /\bsection '([^'\n]+)'/i
const OPTION_REFERENCE = /\boption '([^'\n]+)'/i

export function faultReference(message: string): FaultReference | null {
  const section = SECTION_REFERENCE.exec(message)
  if (!section?.[1]) return null
  const start = section.index + section[0].indexOf("'") + 1
  return {
    section: section[1],
    option: OPTION_REFERENCE.exec(message)?.[1] ?? null,
    start,
    end: start + section[1].length,
  }
}

/**
 * The option's effective line when Klipper names one that is written down,
 * otherwise the section's first header — where a reader would add a missing
 * option or remove a section Klipper does not recognise.
 */
export function locateFault(
  index: ConfigIndex,
  reference: FaultReference,
): { path: string; line: number } | null {
  if (reference.option) {
    const option = index.options.get(optionKey(reference.section, reference.option))?.at(-1)
    if (option) return { path: option.path, line: option.line }
  }
  const section = index.sections.get(sectionKey(reference.section))?.[0]
  return section ? { path: section.path, line: section.line } : null
}
