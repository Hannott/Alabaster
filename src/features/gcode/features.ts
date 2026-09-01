import { GcodeFeature } from '@/features/gcode/types'

/**
 * Maps slicer `;TYPE:` comments onto the viewer's feature categories.
 *
 * Every slicer names these differently and none of them documents the list as
 * an interface, so this is a lookup table rather than a clever parser. Two
 * rules keep it honest:
 *
 * - **Match on the whole normalized label, not a substring.** "Solid infill"
 *   and "Internal infill" differ by one word and belong in different
 *   categories; a substring match on "infill" would silently merge them.
 * - **Unknown labels become `Other`.** The established Klipper web interface's
 *   viewer defaults to feature coloring and renders an entire OrcaSlicer print
 *   in one flat color because its table has no entry for it — a mode that
 *   silently means nothing is worse than an obvious grey.
 */

const featureByLabel = new Map<string, GcodeFeature>([
  // PrusaSlicer and SuperSlicer.
  ['external perimeter', GcodeFeature.PerimeterOuter],
  ['perimeter', GcodeFeature.PerimeterInner],
  ['overhang perimeter', GcodeFeature.Bridge],
  ['internal infill', GcodeFeature.Infill],
  ['solid infill', GcodeFeature.InfillSolid],
  ['top solid infill', GcodeFeature.InfillSolid],
  ['bridge infill', GcodeFeature.Bridge],
  ['internal bridge infill', GcodeFeature.Bridge],
  ['thin wall', GcodeFeature.PerimeterInner],
  ['gap fill', GcodeFeature.InfillSolid],
  ['skirt', GcodeFeature.Skirt],
  ['skirt/brim', GcodeFeature.Skirt],
  ['brim', GcodeFeature.Skirt],
  ['support material', GcodeFeature.Support],
  ['support material interface', GcodeFeature.Support],
  ['wipe tower', GcodeFeature.Other],
  ['custom', GcodeFeature.Other],

  // OrcaSlicer and Bambu Studio.
  ['outer wall', GcodeFeature.PerimeterOuter],
  ['inner wall', GcodeFeature.PerimeterInner],
  ['overhang wall', GcodeFeature.Bridge],
  ['sparse infill', GcodeFeature.Infill],
  ['internal solid infill', GcodeFeature.InfillSolid],
  ['top surface', GcodeFeature.InfillSolid],
  ['bottom surface', GcodeFeature.InfillSolid],
  ['bridge', GcodeFeature.Bridge],
  ['internal bridge', GcodeFeature.Bridge],
  ['support', GcodeFeature.Support],
  ['support interface', GcodeFeature.Support],
  ['support transition', GcodeFeature.Support],
  ['prime tower', GcodeFeature.Other],

  // Cura.
  ['wall-outer', GcodeFeature.PerimeterOuter],
  ['wall-inner', GcodeFeature.PerimeterInner],
  ['fill', GcodeFeature.Infill],
  ['skin', GcodeFeature.InfillSolid],
  ['support-interface', GcodeFeature.Support],
  ['prime-tower', GcodeFeature.Other],

  // ideaMaker.
  ['inner-wall', GcodeFeature.PerimeterInner],
  ['outer-wall', GcodeFeature.PerimeterOuter],
  ['solid-fill', GcodeFeature.InfillSolid],
  ['sparse-fill', GcodeFeature.Infill],
  ['raft', GcodeFeature.Skirt],
])

/**
 * Reads a `;TYPE:` comment out of a raw G-code line. Returns null when the
 * line carries no type comment at all, so the caller can leave the current
 * feature in force — slicers state a type once and then emit many moves.
 */
export function gcodeFeatureFromComment(line: string): GcodeFeature | null {
  const match = /;\s*(?:TYPE|FEATURE)\s*:\s*(.+?)\s*$/i.exec(line)
  if (!match?.[1]) return null
  const label = match[1].trim().toLowerCase()
  return featureByLabel.get(label) ?? GcodeFeature.Other
}
