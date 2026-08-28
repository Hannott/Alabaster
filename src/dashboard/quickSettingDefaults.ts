/**
 * Which of each module's settings a never-customized card shows in its own
 * gear-opened quick layer — see "Promoting any setting into the quick layer" in
 * `docs/design/settings-surface.md`.
 *
 * They live here rather than beside the components that render them for two
 * reasons. The registry needs them without importing a component, which would
 * close an import cycle; and every list has to answer the same question the
 * same way, which is far easier to check with the eight of them in one column
 * than spread across eight files that each look reasonable alone.
 *
 * **The default is what the card showed before promotion existed.** A dashboard
 * carried over from an earlier build has no `quickSettings` key of its own, so
 * it reads these — and a user must not find that their card quietly lost the
 * settings it had. That is the whole rule for choosing a default; which
 * settings may be promoted *at all* is a separate judgement, made in the fields
 * component that renders the row, and recorded there.
 */

/** Print: the three blocks of the card a user turns off when they want them gone. */
export const printDefaultQuickKeys = ['showThumbnail', 'showFilament', 'showDrift'] as const

/** Temperatures: the chart is the card's optional half, and the rest of its shape follows from it. */
export const temperaturesDefaultQuickKeys = ['showChart'] as const

/** Movement: the two blocks the card draws at all. */
export const movementDefaultQuickKeys = ['showParking', 'showZOffset'] as const

/**
 * Machine: its one lock, off by default like the setting itself — there is no
 * "what the card showed before" migration constraint here, since the card
 * never had this setting until it existed.
 */
export const machineDefaultQuickKeys = ['lockDuringPrint'] as const

/** Controls: two sections a printer may have several of and its owner may never use. */
export const controlsDefaultQuickKeys = ['showOutputPins', 'showMonitoredFans'] as const

/** Macros: the one setting the card had, since its configuration is otherwise a picker. */
export const macrosDefaultQuickKeys = ['hideMissing'] as const

/**
 * Extruder: the optional sections. What the buttons command stays in the pane.
 * `showRetraction` and `showExtrusionFactor` join them because each is the
 * same kind of switch — a block of the card on or off — and adding one costs
 * a never-customized card nothing, where removing one would have cost it a
 * setting it already had.
 */
export const extruderDefaultQuickKeys = [
  'showManualExtrusion',
  'showLoadMacros',
  'showRetraction',
  'showPressureAdvance',
  'showExtrusionFactor',
] as const

/**
 * Bed mesh: what the height map draws. `layers` covers the mesh/probed/level
 * set as one key because they render as one row — a `check-set` behind a single
 * descriptive word, which cannot be promoted a third of the way.
 */
export const bedMeshDefaultQuickKeys = ['layers', 'wireframe', 'scaleToMesh', 'showProbes'] as const

/** Console: the filter that makes the transcript readable, and the two row shapes. */
export const consoleDefaultQuickKeys = [
  'hideTemperatureReports',
  'showTimestamps',
  'compact',
] as const

/**
 * Spool: its one setting, shown by default. Unlike Movement's confirmations or
 * Print's reset-on-finish choices, this is a safety behaviour worth surfacing
 * on the card itself rather than leaving it two clicks deep in the surface —
 * there is no "what the card showed before" here, since the module never had
 * this setting until it existed, so the default is a judgement rather than a
 * migration constraint.
 */
export const spoolDefaultQuickKeys = ['autoPauseOnEmpty'] as const

/**
 * Camera: the arrangement, and only that. It is the one setting on this card
 * that is a live judgement rather than a preference — whether several streams
 * are worth running at once depends on what the printer is doing right now, and
 * on a Pi already busy slicing the answer changes within a session. Fit,
 * columns and the two overlays are settled once and left alone, so they stay in
 * the pane where they can be promoted by anyone who disagrees.
 *
 * The card had no settings at all before they existed, so there is no "what the
 * card showed before" constraint here — this is a judgement, not a migration.
 */
export const cameraDefaultQuickKeys = ['arrangement'] as const
