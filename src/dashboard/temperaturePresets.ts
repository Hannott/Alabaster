import { configRecordList } from '@/dashboard/context'

/**
 * One row of the preset editor: what to call it, and what it sets.
 *
 * A null temperature means **leave that heater alone**, not "set it to zero".
 * The distinction is the whole reason the fields are nullable: a filament pulled
 * from the catalogue may carry a hotend temperature and no bed temperature, and
 * a preset that read the missing half as `0` was a button that silently turned
 * the bed off. Zero stays available — it is what typing `0` means — so the two
 * intentions each have their own value rather than sharing one.
 */
export interface TemperaturePreset {
  name: string
  extruder: number | null
  bed: number | null
}

/**
 * The same row while it is being typed, where every field is text — including
 * the half-typed number and the name that is still empty.
 */
export interface TemperaturePresetDraft {
  name: string
  extruder: string
  bed: string
}

/**
 * What a card starts with. Seeded rather than assumed: these were hard-coded
 * constants in the component, which is a guess about someone else's filament on
 * a card whose whole job is this machine's temperatures. A user with a
 * different PETG, or a fourth material, edits the list rather than working
 * around it.
 */
export const defaultTemperaturePresets: readonly TemperaturePreset[] = [
  { name: 'PLA', extruder: 210, bed: 60 },
  { name: 'PETG', extruder: 240, bed: 80 },
  { name: 'ABS', extruder: 250, bed: 100 },
]

/**
 * A stored temperature, or null for "leave this heater alone".
 *
 * Anything that is not a usable number degrades to null rather than to zero,
 * which is the safe direction for a hand-edited profile: a junk value costs the
 * user that half of the preset, where reading it as zero would cool a heater
 * nobody asked to cool. The upper bound is the machine's, so it is applied
 * where the machine is known — see `applyPreset` in `TemperaturesModule.vue`,
 * which clamps to the heater's own `max_temp` for the same reason a typed
 * target is clamped there.
 */
function temperature(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value))
}

/**
 * The card's presets, or the defaults when it has never been given any.
 *
 * A row is dropped when it has no usable name, or when it would set nothing at
 * all — a button that presses to no effect is worse than a missing row. A row
 * that sets one heater and leaves the other is kept, because that is now a
 * thing a preset is allowed to mean.
 */
export function readPresets(config: Record<string, unknown>): TemperaturePreset[] {
  const stored = configRecordList(config, 'presets')
  if (stored.length === 0) return [...defaultTemperaturePresets]

  return stored.flatMap((entry) => {
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const extruder = temperature(entry.extruder)
    const bed = temperature(entry.bed)
    if (name === '' || (extruder === null && bed === null)) return []
    return [{ name, extruder, bed }]
  })
}

/**
 * The stored rows as the editor holds them, including the ones the card cannot
 * use yet.
 *
 * `readPresets` above is the card's view and drops a row it cannot turn into a
 * button — right, because a nameless button is unpressable. Giving the editor
 * that same view is what made Add appear to do nothing: the new row was
 * written, then filtered away before it could be rendered and named. An editor
 * has to be able to hold a row that is not finished, since every row is
 * unfinished for as long as it takes to fill in.
 */
export function readPresetDrafts(config: Record<string, unknown>): TemperaturePresetDraft[] {
  const stored = configRecordList(config, 'presets')
  const rows = stored.length > 0 ? stored : defaultTemperaturePresets
  return rows.map((entry) => ({
    name: typeof entry.name === 'string' ? entry.name : '',
    extruder: draftNumber((entry as Record<string, unknown>).extruder),
    bed: draftNumber((entry as Record<string, unknown>).bed),
  }))
}

function draftNumber(value: unknown): string {
  const parsed = temperature(value)
  return parsed === null ? '' : String(parsed)
}

/**
 * A draft as the card will store it. An empty field is stored as null — the
 * preset leaves that heater as it is — rather than as the zero it used to
 * become, which turned the heater off instead. `Number('')` is `0`, so the
 * blank has to be recognized before the conversion rather than after it.
 */
export function presetFromDraft(draft: TemperaturePresetDraft): TemperaturePreset {
  return {
    name: draft.name.trim(),
    extruder: draftTemperature(draft.extruder),
    bed: draftTemperature(draft.bed),
  }
}

/**
 * `String(...)` before trimming, because a draft field is not always the string
 * the interface says it is: Vue applies its `.number` casting to a `v-model` on
 * a `type="number"` input automatically, so an edited row arrives here holding a
 * number while an untouched one still holds the seeded text. Cleared, the same
 * input yields `''`, which is the case this whole function exists to tell apart
 * from a typed zero.
 */
function draftTemperature(entered: string): number | null {
  const text = String(entered).trim()
  return text === '' ? null : temperature(Number(text))
}
