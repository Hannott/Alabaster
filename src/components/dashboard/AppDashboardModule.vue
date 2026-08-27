<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import ModuleSettingsPanel from '@/components/dashboard/ModuleSettingsPanel.vue'

/**
 * The shell every dashboard module's card body is built from: the settings
 * disclosure, then everything else. One place decides how those two pieces
 * are spaced, so a module never has to reason about margin or gap semantics
 * to avoid the failure this component exists to prevent.
 *
 * `ModuleSettingsPanel` sits directly on this component's own root, outside
 * the inner content wrapper, rather than as one of its gapped siblings. That
 * placement is load-bearing, not stylistic: `.module-settings` (main.css)
 * already carries its own `margin-block-end`, which lives inside
 * `DisclosureReveal`'s clipping box and so collapses smoothly as the panel's
 * own height animates to zero on close. A `gap`/`space-y-*` utility that also
 * spans the boundary right after the panel adds a *second*, independent
 * margin — tied to whether the panel currently exists as a DOM sibling, not
 * to its animated height — and that second margin does not shrink with the
 * transition. It only disappears in one un-animated step, the instant Vue
 * removes the fully-collapsed panel from the DOM (`ModuleSettingsPanel` is
 * `v-if`-gated), which lands right after the close animation already looked
 * finished. `ExtruderModule`, `SpoolModule`, `ControlsModule`, and
 * `BedMeshModule` all shipped that extra margin once, each by hand, and each
 * showed the same tail-end stutter — see ADR 0004's disclosure exception for
 * the full account. Every row after the panel is a stable, always-mounted
 * sibling, so `space-y-4` among *them* is safe, because none of them
 * disappear out from under the rule the way the panel does.
 *
 * `space-y-4` on the content wrapper is a default, not a mandate. Tailwind v4
 * compiles it to a `:where(...)` rule, which has zero specificity, so any
 * module's own class rule setting a margin on one of its rows wins without a
 * specificity fight — `movement-position` (0.5rem) and `movement-axis-row`
 * (0.75rem) keep their deliberately tighter grouping under it. That is what
 * makes one blanket spacing rule safe to apply to eleven cards that were each
 * hand-spaced before.
 *
 * The shell is interchangeable: its root carries nothing module-specific, so
 * any module's content can be dropped into it unchanged. A module that needs
 * a class on a box of its own — a container-query context for rows that
 * answer their own width, a flex column for a full-bleed body — renders that
 * box itself, inside the slot, and owns its own interior spacing there.
 * `PrintModule`'s `print-card` is the reference instance; `Temperatures` and
 * `Movement` follow it for their own `@container` contexts. Passing a class
 * to this component instead lands it on the shared root, which is how the
 * shell stops being generic — `interactionConsistency.spec.ts` fails that.
 * Such a wrapper is unpadded, so its content box matches what the padded
 * shell root's was and any `@container` breakpoint tuned against the old
 * markup still resolves against the same width.
 *
 * The root carries `data-module-body` so a host outside the dashboard can
 * cancel that padding without naming the utility class that applies it. A
 * module hosted directly in a `page-card` — the Calibration page's stages —
 * sits inside padding the card already supplies, and two nested paddings read
 * as a card inside a card. The attribute is the hook for that, deliberately
 * module-agnostic: it says "this is a module body", which is true of every
 * module and specific to none, so it does not reintroduce the per-module
 * coupling this shell's root exists to keep out.
 *
 * `inset` is the one shape that opts out of both the padding and the
 * automatic spacing: `Print` and `Console` carry their own padding per
 * section and, in Console's case, want *no* gap at all between two sections
 * that read as one surface (its transcript and prompt). Forcing `space-y-4`
 * on their default slot would be exactly the "second, independent margin"
 * failure described above, one layer further out. `inset` renders
 * `ModuleSettingsPanel` with `module-settings--inset` (main.css) for its own
 * margin instead of a `p-4` wrapper, and passes the default slot through
 * unwrapped, so those two modules keep full control of their own layout.
 */
defineProps<{
  open: boolean
  inset?: boolean
}>()

const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <div data-module-body :class="inset ? undefined : 'p-4'">
    <ModuleSettingsPanel
      :open="open"
      :title="t('dashboard.surface.quickLayerTitle')"
      :class="inset ? 'module-settings--inset' : undefined"
    >
      <slot name="quick-settings"></slot>
    </ModuleSettingsPanel>
    <template v-if="inset">
      <slot></slot>
    </template>
    <div v-else class="space-y-4">
      <slot></slot>
    </div>
  </div>
</template>
