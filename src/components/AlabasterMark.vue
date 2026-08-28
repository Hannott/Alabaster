<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

export type AlabasterMarkVariant = 'auto' | 'on-dark' | 'on-light'

const props = withDefaults(
  defineProps<{
    label?: string
    variant?: AlabasterMarkVariant
  }>(),
  { variant: 'auto' },
)

const { t } = useI18n({ useScope: 'global' })

const isPlaying = ref(false)
// The mark itself already carries `label` as its accessible name wherever a
// caller supplies one (the header uses it to announce the app name); the
// fallback only covers the sidebar's decorative instance, which had no name
// to lose because nothing pointed at it before it became clickable.
const triggerLabel = computed(() => props.label ?? t('app.playAnimation'))

function play(): void {
  if (isPlaying.value) return
  isPlaying.value = true
}

function onAnimationEnd(): void {
  isPlaying.value = false
}
</script>

<template>
  <button
    type="button"
    class="brand-trigger alabaster-mark-trigger"
    :aria-label="triggerLabel"
    @click="play"
  >
    <svg
      class="alabaster-mark"
      :class="[`alabaster-mark--${variant}`, { 'alabaster-mark--playing': isPlaying }]"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
      @animationend="onAnimationEnd"
    >
      <path
        class="alabaster-mark__shape alabaster-mark__structure alabaster-mark__apex"
        d="M25 5h14l9 23h-9l-7-15-7 15h-9Z"
      />
      <path
        class="alabaster-mark__shape alabaster-mark__primary alabaster-mark__leg-l"
        d="M16 28h9L13 59H4Z"
      />
      <path
        class="alabaster-mark__shape alabaster-mark__structure alabaster-mark__leg-r"
        d="M39 28h9l12 31h-9Z"
      />
      <path
        class="alabaster-mark__shape alabaster-mark__primary alabaster-mark__bed"
        d="M13 52h38l4 7H9Z"
      />

      <path
        class="alabaster-mark__shape alabaster-mark__gantry alabaster-mark__rail-l"
        d="M9 25h16v6H9Z"
      />
      <path
        class="alabaster-mark__shape alabaster-mark__gantry alabaster-mark__rail-r"
        d="M39 25h16v6H39Z"
      />
      <g class="alabaster-mark__toolhead">
        <rect
          class="alabaster-mark__shape alabaster-mark__gantry"
          x="26"
          y="21"
          width="12"
          height="14"
          rx="1"
        />
        <path class="alabaster-mark__shape alabaster-mark__primary" d="M28 36h8v7h-8Z" />
        <path class="alabaster-mark__shape alabaster-mark__primary" d="m28 43 4 6 4-6Z" />
      </g>
      <path
        class="alabaster-mark__shape alabaster-mark__accent alabaster-mark__part"
        d="M24 56h16v3H24Z"
      />
    </svg>
  </button>
</template>

<style scoped>
.alabaster-mark-trigger {
  /*
   * No `display` here on purpose: both call sites are flex items (blockified
   * regardless of their own `display`), and App.vue's header instance relies
   * on its `mobile-brand` class winning `display: none` at desktop widths.
   * A scoped `display: block` here compiles to `[data-v-xxxx]`, out-specifying
   * that plain class and leaving an invisible, still-clickable button sitting
   * in the header past the width where it's supposed to disappear.
   */
  flex: 0 0 auto;
  padding: 0;
  margin: 0;
  border: 0;
  background: none;
}

.alabaster-mark {
  --alabaster-mark-structure: var(--color-brand-ink);
  --alabaster-mark-primary: var(--color-brand-blue);
  --alabaster-mark-gantry: var(--color-brand-sky);
  --alabaster-mark-accent: var(--color-brand-yellow);

  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.alabaster-mark--on-dark {
  --alabaster-mark-structure: var(--color-brand-paper);
  --alabaster-mark-primary: var(--color-brand-sky);
}

:global(:root[data-theme='dark'] .alabaster-mark--auto) {
  --alabaster-mark-structure: var(--color-brand-paper);
  --alabaster-mark-primary: var(--color-brand-sky);
}

.alabaster-mark--on-light {
  --alabaster-mark-structure: var(--color-brand-ink);
  --alabaster-mark-primary: var(--color-brand-blue);
}

.alabaster-mark__shape {
  transition: fill var(--motion-duration-standard) var(--motion-ease-standard);
}

.alabaster-mark__structure {
  fill: var(--alabaster-mark-structure);
}

.alabaster-mark__primary {
  fill: var(--alabaster-mark-primary);
}

.alabaster-mark__gantry {
  fill: var(--alabaster-mark-gantry);
}

.alabaster-mark__accent {
  fill: var(--alabaster-mark-accent);
}

/*
 * The print-pass animation: a single 3s, click-triggered play once, governed
 * by the brand-mark exception in ADR 0004. The frame members morph their `d`
 * because no transform turns the triangular apex into the printer's square
 * top beam; the gantry, toolhead, and printed line move on transforms only.
 * Every keyframe list holds its 0% and 100% value equal to the path's own
 * un-animated `d`/transform, so removing `--playing` at `animationend` snaps
 * back to a frame indistinguishable from the one the click started from.
 */
.alabaster-mark--playing .alabaster-mark__rail-l,
.alabaster-mark--playing .alabaster-mark__rail-r,
.alabaster-mark--playing .alabaster-mark__toolhead,
.alabaster-mark--playing .alabaster-mark__part {
  transform-box: fill-box;
}

.alabaster-mark--playing .alabaster-mark__apex {
  animation: alabasterOpenApex 3s;
}
@keyframes alabasterOpenApex {
  0%,
  6% {
    d: path('M25 5h14l9 23h-9l-7-15-7 15h-9Z');
    animation-timing-function: cubic-bezier(0.3, 0.7, 0.3, 1);
  }
  30%,
  72% {
    d: path('M4 6h56l0 8h0l-28 0l-28 0h0Z');
    animation-timing-function: cubic-bezier(0.5, 0, 0.2, 1);
  }
  94%,
  100% {
    d: path('M25 5h14l9 23h-9l-7-15-7 15h-9Z');
  }
}

.alabaster-mark--playing .alabaster-mark__leg-l {
  animation: alabasterOpenLegL 3s;
}
@keyframes alabasterOpenLegL {
  0%,
  6% {
    d: path('M16 28h9L13 59H4Z');
    animation-timing-function: cubic-bezier(0.3, 0.7, 0.3, 1);
  }
  30%,
  72% {
    d: path('M4 14h8L12 52H4Z');
    animation-timing-function: cubic-bezier(0.5, 0, 0.2, 1);
  }
  94%,
  100% {
    d: path('M16 28h9L13 59H4Z');
  }
}

.alabaster-mark--playing .alabaster-mark__leg-r {
  animation: alabasterOpenLegR 3s;
}
@keyframes alabasterOpenLegR {
  0%,
  6% {
    d: path('M39 28h9l12 31h-9Z');
    animation-timing-function: cubic-bezier(0.3, 0.7, 0.3, 1);
  }
  30%,
  72% {
    d: path('M52 14h8l0 38h-8Z');
    animation-timing-function: cubic-bezier(0.5, 0, 0.2, 1);
  }
  94%,
  100% {
    d: path('M39 28h9l12 31h-9Z');
  }
}

.alabaster-mark--playing .alabaster-mark__bed {
  animation: alabasterOpenBed 3s;
}
@keyframes alabasterOpenBed {
  0%,
  6% {
    d: path('M13 52h38l4 7H9Z');
    animation-timing-function: cubic-bezier(0.3, 0.7, 0.3, 1);
  }
  30%,
  72% {
    d: path('M4 52h56l0 7H4Z');
    animation-timing-function: cubic-bezier(0.5, 0, 0.2, 1);
  }
  94%,
  100% {
    d: path('M13 52h38l4 7H9Z');
  }
}

/*
 * The mark leaves a 14-unit gap between the two gantry stubs and parks the
 * 12-unit carriage in it, so the beam only ever looks continuous because the
 * carriage is standing there. The moment the head leaves centre the gap is
 * exposed, so the inner edges meet at the centre line early — by 15%, while
 * the carriage is still covering them — and part again only at 83%, once the
 * head is on its way back. The outer edges keep the frame's own schedule.
 */
.alabaster-mark--playing .alabaster-mark__rail-l {
  transform-origin: left;
  animation: alabasterOpenRailL 3s;
}
@keyframes alabasterOpenRailL {
  0%,
  6% {
    transform: translateX(0) scaleX(1);
    animation-timing-function: cubic-bezier(0.3, 0.7, 0.3, 1);
  }
  15% {
    transform: translateX(0) scaleX(1.4375);
    animation-timing-function: cubic-bezier(0.4, 0, 0.3, 1);
  }
  30%,
  72% {
    transform: translateX(3px) scaleX(1.3125);
    animation-timing-function: cubic-bezier(0.5, 0, 0.3, 1);
  }
  83% {
    transform: translateX(0) scaleX(1.4375);
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }
  94%,
  100% {
    transform: translateX(0) scaleX(1);
  }
}

.alabaster-mark--playing .alabaster-mark__rail-r {
  transform-origin: left;
  animation: alabasterOpenRailR 3s;
}
@keyframes alabasterOpenRailR {
  0%,
  6% {
    transform: translateX(0) scaleX(1);
    animation-timing-function: cubic-bezier(0.3, 0.7, 0.3, 1);
  }
  15% {
    transform: translateX(-7px) scaleX(1.4375);
    animation-timing-function: cubic-bezier(0.4, 0, 0.3, 1);
  }
  30%,
  72% {
    transform: translateX(-8px) scaleX(1.3125);
    animation-timing-function: cubic-bezier(0.5, 0, 0.3, 1);
  }
  83% {
    transform: translateX(-7px) scaleX(1.4375);
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }
  94%,
  100% {
    transform: translateX(0) scaleX(1);
  }
}

.alabaster-mark--playing .alabaster-mark__toolhead {
  animation: alabasterPassHead 3s;
}
@keyframes alabasterPassHead {
  0%,
  6% {
    transform: translateX(0);
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }
  30% {
    transform: translateX(-14px);
    animation-timing-function: linear;
  }
  72% {
    transform: translateX(14px);
    animation-timing-function: cubic-bezier(0.5, 0, 0.2, 1);
  }
  90%,
  100% {
    transform: translateX(0);
  }
}

/*
 * The printed line drops out of frame, is re-seeded at zero width under the
 * parked nozzle while it is off-screen, then grows behind the head at the
 * head's own speed and settles back into the mark on the close.
 */
.alabaster-mark--playing .alabaster-mark__part {
  transform-origin: left;
  animation: alabasterPassPart 3s;
}
@keyframes alabasterPassPart {
  0%,
  6% {
    transform: translate(0, 0) scaleX(1);
    animation-timing-function: cubic-bezier(0.5, 0, 0.9, 0.4);
  }
  20% {
    transform: translate(0, 14px) scaleX(1);
  }
  20.01%,
  30% {
    transform: translate(-6px, -7px) scaleX(0);
    animation-timing-function: linear;
  }
  72% {
    transform: translate(-6px, -7px) scaleX(1.75);
    animation-timing-function: cubic-bezier(0.5, 0, 0.2, 1);
  }
  94%,
  100% {
    transform: translate(0, 0) scaleX(1);
  }
}
</style>
