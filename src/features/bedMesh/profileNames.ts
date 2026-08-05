/**
 * Bed mesh profile names are how `BED_MESH_PROFILE SAVE`/`LOAD`/`REMOVE` and
 * `BED_MESH_CALIBRATE PROFILE=` address a saved mesh on Klipper's side, so two
 * profiles can never share a name — the second `SAVE` silently replaces the
 * first, and nothing on Alabaster's side keeps a copy of what was lost.
 *
 * Both the dashboard settings pane and the Calibration page save a mesh under
 * a name, so the two functions below are the one place that risk is reasoned
 * about, rather than each dialog inventing its own notion of "taken".
 */

export type ProfileNameIssue = 'empty' | 'nonAscii' | 'taken'

/**
 * `except` is the one existing name allowed to be typed back unchanged — the
 * profile a rename is renaming, or the profile an intentional re-save means to
 * replace. Every other match is a different profile about to be overwritten.
 */
export function profileNameIssue(
  value: string,
  existingNames: readonly string[],
  except?: string,
): ProfileNameIssue | undefined {
  const name = value.trim()
  if (name === '') return 'empty'
  // Klipper writes the name into printer.cfg, where a non-ASCII character
  // comes back mangled rather than failing outright.
  if (name !== name.replace(/[^\x20-\x7E]/g, '')) return 'nonAscii'
  if (existingNames.some((existing) => existing === name && existing !== except)) return 'taken'
  return undefined
}

/**
 * `base`, or the first `base2`, `base3`, ... not already in `existingNames` —
 * so a save dialog can default to a name that will not silently replace
 * another profile. Klipper names every anonymous calibration "default", which
 * makes that name the single most likely collision, not an edge case.
 */
export function nextAvailableProfileName(base: string, existingNames: readonly string[]): string {
  if (!existingNames.includes(base)) return base
  let suffix = 2
  while (existingNames.includes(`${base}${suffix}`)) suffix += 1
  return `${base}${suffix}`
}
