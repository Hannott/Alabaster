/**
 * Turns a config- or macro-derived `snake_case` identifier into a readable
 * label: underscores become spaces and every word is capitalized. Never a
 * rename — `nonlinear_offset` becomes "Nonlinear Offset", not "Curve
 * strength" — so a reader can still find the identifier in their own
 * `printer.cfg` or macro definition. `formatMacroLabel`
 * (`src/stores/macros.ts`) and `formatPressureAdvanceLabel`
 * (`src/components/dashboard/modules/pressureAdvanceSettings.ts`) both
 * delegate here rather than each capitalizing their own way, which is what
 * previously left macro names in Klipper's own shouting `ALL_CAPS` while
 * pressure-advance keys were only sentence-cased.
 */
export function titleCaseIdentifier(name: string): string {
  return name
    .split('_')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ')
}
