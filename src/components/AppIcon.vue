<script setup lang="ts">
export type AppIconName =
  | 'activity'
  | 'add'
  | 'adjust'
  | 'back'
  | 'bell'
  | 'bellAlertTwotone'
  | 'bellNew'
  | 'bellSlash'
  | 'bellTwotone'
  | 'bolt'
  | 'bulb'
  | 'bulbOn'
  | 'camera'
  | 'cameraNoSignal'
  | 'cameraDisabled'
  | 'cameraOff'
  | 'check'
  | 'close'
  | 'collapse'
  | 'console'
  | 'controls'
  | 'copyFile'
  | 'crosshair'
  | 'customize'
  | 'documentation'
  | 'down'
  | 'download'
  | 'drag'
  | 'duplicate'
  | 'edit'
  | 'emergency'
  | 'emergencyStop'
  | 'excludeObject'
  | 'expand'
  | 'fan'
  | 'fileCode'
  | 'fileJpg'
  | 'filePlus'
  | 'filePng'
  | 'filePrinter'
  | 'fileSearch'
  | 'fileText'
  | 'fileUpload'
  | 'folder'
  | 'folderCode'
  | 'folderMoveTo'
  | 'folderPlus'
  | 'folderUp'
  | 'forward'
  | 'fullscreen'
  | 'function'
  | 'gears'
  | 'globe'
  | 'help'
  | 'hide'
  | 'history'
  | 'home'
  | 'info'
  | 'jobs'
  | 'layerNext'
  | 'layers'
  | 'left'
  | 'lock'
  | 'machine'
  | 'macro'
  | 'maintenance'
  | 'mesh'
  | 'minus'
  | 'moon'
  | 'more'
  | 'move'
  | 'nozzle'
  | 'nozzleHeat'
  | 'overview'
  | 'pause'
  | 'pin'
  | 'play'
  | 'popout'
  | 'power'
  | 'print'
  | 'probe'
  | 'processor'
  | 'ram'
  | 'refresh'
  | 'reset'
  | 'rename'
  | 'right'
  | 'save'
  | 'send'
  | 'sensor'
  | 'settings'
  | 'spool'
  | 'sidebarCollapse'
  | 'sidebarExpand'
  | 'snapshot'
  | 'snowflake'
  | 'speed'
  | 'spinner'
  | 'stop'
  | 'sunMoon'
  | 'temperature'
  | 'trash'
  | 'undo'
  | 'unlock'
  | 'up'
  | 'usb'
  | 'user'
  | 'viewer'
  | 'warning'
  | 'warningDiamond'
  | 'workUpdate'
  | 'zoomIn'
  | 'zoomOut'
  | 'skipForward'

defineProps<{ name: AppIconName }>()
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
    :class="name === 'settings' ? 'cog-icon' : name === 'spinner' ? 'spinner-icon' : undefined"
  >
    <g v-if="name === 'overview'">
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </g>
    <path v-else-if="name === 'add'" d="M12 5v14M5 12h14" />
    <path v-else-if="name === 'minus'" d="M5 12h14" />
    <path v-else-if="name === 'back'" d="m15 18-6-6 6-6" />
    <path v-else-if="name === 'forward'" d="m9 18 6-6-6-6" />
    <!--
      line-md's "bell" glyph (MIT licensed): a top hook, the body traced in
      one continuous stroke, then the clapper — drawn in once via SMIL on
      mount, the same one-shot-singleton reasoning `emergencyStop` documents
      above, since this is the one bell in the header and never mounts more
      than once. `bellTwotone` and `bellAlertTwotone` below share this exact
      path data and add only a fill and, for the alert variant, a continuous
      loop plus the exclamation mark line-md draws to its upper right.
    -->
    <g v-else-if="name === 'bell'">
      <path stroke-dasharray="4" d="M12 3v2">
        <animate fill="freeze" attributeName="stroke-dashoffset" dur="0.2s" values="4;0" />
      </path>
      <path
        stroke-dasharray="30"
        stroke-dashoffset="30"
        d="M12 5c-3.31 0 -6 2.69 -6 6l0 6c-1 0 -2 1 -2 2h8M12 5c3.31 0 6 2.69 6 6l0 6c1 0 2 1 2 2h-8"
      >
        <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.2s" dur="0.4s" to="0" />
      </path>
      <path
        stroke-dasharray="10"
        stroke-dashoffset="10"
        d="M10 20c0 1.1 0.9 2 2 2c1.1 0 2 -0.9 2 -2"
      >
        <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.2s" to="0" />
      </path>
    </g>
    <!--
      line-md's "bell-twotone" glyph (MIT licensed) — `bell` above, plus the
      body filling to 30% once the outline finishes drawing: "there is
      something here, already seen." App.vue swaps to this once the reader
      has opened the notifications menu while a server configuration problem
      is still listed.
    -->
    <g v-else-if="name === 'bellTwotone'">
      <path stroke-dasharray="4" d="M12 3v2">
        <animate fill="freeze" attributeName="stroke-dashoffset" dur="0.2s" values="4;0" />
      </path>
      <path
        fill="currentColor"
        fill-opacity="0"
        stroke-dasharray="30"
        stroke-dashoffset="30"
        d="M12 5c-3.31 0 -6 2.69 -6 6l0 6c-1 0 -2 1 -2 2h8M12 5c3.31 0 6 2.69 6 6l0 6c1 0 2 1 2 2h-8"
      >
        <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.2s" dur="0.4s" to="0" />
        <animate fill="freeze" attributeName="fill-opacity" begin="0.9s" dur="0.15s" to="0.3" />
      </path>
      <path
        stroke-dasharray="10"
        stroke-dashoffset="10"
        d="M10 20c0 1.1 0.9 2 2 2c1.1 0 2 -0.9 2 -2"
      >
        <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.2s" to="0" />
      </path>
    </g>
    <!--
      line-md's "bell-alert-loop" glyph (MIT licensed), recoloured rather than
      left monochrome: the bell keeps `bellTwotone`'s fill but is forced to
      the app's own blue accent, and the exclamation mark to its upper right —
      line-md's own glyph for "alert," two short strokes rather than a
      wiggling clapper — is forced to the danger red, so the two things this
      reports (something is here; it needs attention) stay legible without
      reading the label. The bell's gentle rotation and the exclamation's
      pulsing weight both loop indefinitely by design: this is the one glyph
      in the product allowed a continuous animation, because App.vue calls
      `pauseAnimations()` on it the instant reduced motion is requested (SMIL
      sits outside the CSS blanket rule main.css otherwise applies, same as
      `emergencyStop`), and it never appears until there is an unread
      configuration problem for it to say something about.
    -->
    <g v-else-if="name === 'bellAlertTwotone'">
      <path class="text-accent" stroke-dasharray="4" d="M12 3v2">
        <animate fill="freeze" attributeName="stroke-dashoffset" dur="0.2s" values="4;0" />
        <animateTransform
          attributeName="transform"
          type="rotate"
          dur="6s"
          repeatCount="indefinite"
          keyTimes="0;0.05;0.15;0.2;1"
          values="0 12 3;3 12 3;-3 12 3;0 12 3;0 12 3"
        />
      </path>
      <path
        class="text-accent"
        fill="currentColor"
        fill-opacity="0"
        stroke-dasharray="30"
        stroke-dashoffset="30"
        d="M12 5c-3.31 0 -6 2.69 -6 6l0 6c-1 0 -2 1 -2 2h8M12 5c3.31 0 6 2.69 6 6l0 6c1 0 2 1 2 2h-8"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          dur="6s"
          repeatCount="indefinite"
          keyTimes="0;0.05;0.15;0.2;1"
          values="0 12 3;3 12 3;-3 12 3;0 12 3;0 12 3"
        />
        <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.2s" dur="0.4s" to="0" />
        <animate fill="freeze" attributeName="fill-opacity" begin="1.3s" dur="0.15s" to="0.3" />
      </path>
      <path
        class="text-accent"
        stroke-dasharray="10"
        stroke-dashoffset="10"
        d="M10 20c0 1.1 0.9 2 2 2c1.1 0 2 -0.9 2 -2"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          begin="0.2s"
          dur="6s"
          repeatCount="indefinite"
          keyTimes="0;0.05;0.15;0.2;1"
          values="0 12 8;6 12 8;-6 12 8;0 12 8;0 12 8"
        />
        <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.2s" to="0" />
      </path>
      <g class="text-danger-text">
        <path stroke-dasharray="6" stroke-dashoffset="6" d="M22 6v4">
          <animate
            attributeName="stroke-width"
            begin="0.9s"
            dur="3s"
            repeatCount="indefinite"
            keyTimes="0;0.1;0.2;0.3;1"
            values="1.8;2.8;2.8;1.8;1.8"
          />
          <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.9s" dur="0.2s" to="0" />
        </path>
        <path stroke-dasharray="4" stroke-dashoffset="4" d="M22 14v0.01">
          <animate
            attributeName="stroke-width"
            begin="1.1s"
            dur="3s"
            repeatCount="indefinite"
            keyTimes="0;0.1;0.2;0.3;1"
            values="1.8;2.8;2.8;1.8;1.8"
          />
          <animate fill="freeze" attributeName="stroke-dashoffset" begin="1.1s" dur="0.2s" to="0" />
        </path>
      </g>
    </g>
    <!--
      Griddy Icons' "notification-new" glyph (MIT licensed) — `bell` plus a
      dot at the shoulder for "there is something unread". App.vue's header
      trigger swaps to this instead of layering the shared `.button--badged`
      CSS dot on top of a plain `bell`, since the two dots would land in
      almost the same corner and read as one doubled, slightly-off badge.
      Kept as its own family rather than folded into the line-md trio above:
      it reports an unrelated set of conditions (a lost connection, a failed
      command, an announcement) that are not "read" the way a server warning
      is, so it has no twotone or alert sibling to share path data with.
    -->
    <g v-else-if="name === 'bellNew'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="m18.5 12.45l1.5 2.6V19h-4.325c-.35 1.71-1.865 3-3.675 3a3.76 3.76 0 0 1-3.675-3H4v-3.95l1.5-2.6V8.5C5.5 4.915 8.415 2 12 2h.5v1.5H12c-2.755 0-5 2.245-5 5v4.355l-1.5 2.6v2.05h13v-2.05l-1.5-2.6V9.5h1.5zM9.89 19c.31.87 1.135 1.5 2.11 1.5h.005c.975 0 1.8-.63 2.11-1.5zM20 5a3 3 0 1 1-6 0a3 3 0 0 1 6 0"
      />
    </g>
    <!--
      BoxIcons' "bell-off" glyph (MIT licensed, published on the BoxIcons site
      as "bell-slash") — a crossed-out bell, for the per-notice action on a
      server configuration problem that is not an outright dismiss: it opens
      the choice between snoozing until the next reboot and muting the
      warning for good.
    -->
    <g v-else-if="name === 'bellSlash'" fill="currentColor" stroke="none">
      <path
        d="M12 22a2.98 2.98 0 0 0 2.818-2H9.182A2.98 2.98 0 0 0 12 22m9-4v-2a1 1 0 0 0-.293-.707L19 13.586V10c0-3.217-2.185-5.927-5.145-6.742C13.562 2.52 12.846 2 12 2s-1.562.52-1.855 1.258c-1.323.364-2.463 1.128-3.346 2.127L3.707 2.293L2.293 3.707l18 18l1.414-1.414l-1.362-1.362A.99.99 0 0 0 21 18M12 5c2.757 0 5 2.243 5 5v4c0 .266.105.52.293.707L19 16.414V17h-.586L8.207 6.793C9.12 5.705 10.471 5 12 5m-5.293 9.707A1 1 0 0 0 7 14v-2.879L5.068 9.189C5.037 9.457 5 9.724 5 10v3.586l-1.707 1.707A1 1 0 0 0 3 16v2a1 1 0 0 0 1 1h10.879l-2-2H5v-.586z"
      />
    </g>
    <path v-else-if="name === 'check'" d="M5 13l4 4L19 7" />
    <path v-else-if="name === 'close'" d="M6 6l12 12M18 6 6 18" />
    <!--
      Basil's "collapse-solid" glyph (MIT licensed) — pairs with `expand`. The
      source glyph's own corner brackets sit well inside the 24x24 box (about
      half its span), which reads as visibly smaller than every other filled
      icon here at the same container size instead of using it as clearance —
      scaled 1.5x about the icon's own center (rather than from the origin,
      like this file's other rescaled glyphs) to bring it to the ~75% span the
      rest of this set fills, with no coordinate in the licensed path touched.
    -->
    <g
      v-else-if="name === 'collapse'"
      fill="currentColor"
      stroke="none"
      transform="translate(12 12) scale(1.5) translate(-12 -12)"
    >
      <path
        fill-rule="evenodd"
        d="M18.028 9.964a.75.75 0 0 0-.75-.75h-2.492V6.722a.75.75 0 0 0-1.5 0v3.242c0 .415.335.75.75.75h3.242a.75.75 0 0 0 .75-.75m-3.992 8.064a.75.75 0 0 0 .75-.75v-2.493h2.492a.75.75 0 0 0 0-1.5h-3.242a.75.75 0 0 0-.75.75v3.243c0 .414.335.75.75.75m-4.072 0a.75.75 0 0 1-.75-.75v-2.493H6.722a.75.75 0 0 1 0-1.5h3.242a.75.75 0 0 1 .75.75v3.243a.75.75 0 0 1-.75.75M5.972 9.964a.75.75 0 0 1 .75-.75h2.492V6.722a.75.75 0 0 1 1.5 0v3.242a.75.75 0 0 1-.75.75H6.722a.75.75 0 0 1-.75-.75"
        clip-rule="evenodd"
      />
    </g>
    <!-- Hugeicons' "queue-01" glyph (MIT licensed). -->
    <path
      v-else-if="name === 'jobs'"
      d="M21 14c0 1.4 0 2.1-.273 2.635a2.5 2.5 0 0 1-1.092 1.092C19.1 18 18.4 18 17 18H7c-1.4 0-2.1 0-2.635-.273a2.5 2.5 0 0 1-1.093-1.092C3 16.1 3 15.4 3 14m3 0h12M6 10h12M6 6h12"
    />
    <g v-else-if="name === 'console'">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </g>
    <!--
      Material Symbols' "work-update-outline" glyph (Google, Apache 2.0) — a
      briefcase with a clock badge, for the update console dialog's header:
      installing an update is host maintenance work in progress.
    -->
    <path
      v-else-if="name === 'workUpdate'"
      fill="currentColor"
      stroke="none"
      d="M4 19v-.375zV8zm0 2q-.825 0-1.412-.587T2 19V8q0-.825.588-1.412T4 6h4V4q0-.825.588-1.412T10 2h4q.825 0 1.413.588T16 4v2h4q.825 0 1.413.588T22 8v4.275q-.45-.325-.95-.562T20 11.3V8H4v11h7.075q.075.525.225 1.025t.375.975zm6-15h4V4h-4zm4.463 15.538Q13 20.075 13 18t1.463-3.537T18 13t3.538 1.463T23 18t-1.463 3.538T18 23t-3.537-1.463M18 21l3-3l-.7-.7l-1.8 1.8V15h-1v4.1l-1.8-1.8l-.7.7z"
    />
    <!--
      line-md's "cog" glyph (MIT licensed), flattened to its final frame: the
      inner ring, plus the six segments that trace the toothed outline.

      Upstream draws itself in over 1s of SMIL, and `line-md:cog-loop` is the
      same glyph with a 30s `animateTransform` added to each of the six
      segments. Neither survives the copy, for one reason each.

      The draw-in is dropped because ADR 0004 earns a reveal with a wait, and a
      cog arrives with its own frame — the dashboard alone mounts one per card,
      so keeping it would animate a dozen pieces of chrome on every load.
      `emergencyStop` keeps its SMIL only because one control replays it
      deliberately on hover, and it parks on its last frame otherwise.

      The rotation becomes CSS on this `<svg>` (`.cog-icon` in main.css)
      because SMIL cannot be reached from a class and sits outside the
      application-wide `prefers-reduced-motion` rule: a cog looped upstream's
      way would keep turning for someone who asked for no motion, and starting
      it by swapping to a second icon name would remount the SVG and lose the
      glyph mid-toggle. Rotating the whole element rather than the six segments
      is indistinguishable, because the ring left behind is a circle about the
      same centre.
    -->
    <g v-else-if="name === 'settings'">
      <path
        d="M12 9c1.66 0 3 1.34 3 3c0 1.66 -1.34 3 -3 3c-1.66 0 -3 -1.34 -3 -3c0 -1.66 1.34 -3 3 -3Z"
      />
      <path
        d="M15.24 6.37c0.41 0.23 0.8 0.51 1.14 0.83c0 0 2.62 -1.08 2.63 -1.06c0 0 1.56 2.7 1.56 2.7c0.01 0.03 -2.22 1.75 -2.22 1.75c0.1 0.45 0.15 0.93 0.15 1.41"
      />
      <path
        d="M18.5 11.99c0.01 0.47 -0.04 0.95 -0.15 1.4c0 0 2.25 1.73 2.23 1.75c0 0 -1.56 2.7 -1.56 2.7c-0.02 0.02 -2.63 -1.05 -2.63 -1.05c-0.34 0.31 -0.73 0.59 -1.15 0.83"
      />
      <path
        d="M15.26 17.62c-0.4 0.24 -0.84 0.44 -1.29 0.57c0 0 -0.37 2.81 -0.4 2.81c0 0 -3.12 0 -3.12 0c-0.03 -0.01 -0.41 -2.8 -0.41 -2.8c-0.44 -0.14 -0.88 -0.34 -1.3 -0.58"
      />
      <path
        d="M8.76 17.63c-0.41 -0.23 -0.8 -0.51 -1.14 -0.83c0 0 -2.62 1.08 -2.63 1.06c0 0 -1.56 -2.7 -1.56 -2.7c-0.01 -0.03 2.22 -1.75 2.22 -1.75c-0.1 -0.45 -0.15 -0.93 -0.15 -1.41"
      />
      <path
        d="M5.5 12.01c-0.01 -0.47 0.04 -0.95 0.15 -1.4c0 0 -2.25 -1.73 -2.23 -1.75c0 0 1.56 -2.7 1.56 -2.7c0.02 -0.02 2.63 1.05 2.63 1.05c0.34 -0.31 0.73 -0.59 1.15 -0.83"
      />
      <path
        d="M8.74 6.38c0.4 -0.24 0.84 -0.44 1.29 -0.57c0 0 0.37 -2.81 0.4 -2.81c0 0 3.12 0 3.12 0c0.03 0.01 0.41 2.8 0.41 2.8c0.44 0.14 0.88 0.34 1.3 0.58"
      />
    </g>
    <!--
      Lineicons' "gears-3" glyph (Lineicons Free, MIT licensed) — two meshed
      gears, one small and one large. The main sidebar rail uses this in place
      of the single-cog `settings` glyph above, so the destination that opens
      the whole Settings page reads as more than one thing to configure;
      every other settings-toggle control (a module's gear, the console
      panel, the G-code viewer) keeps the plain cog. Deliberately outside the
      `.cog-icon` hook in main.css: that turn-while-active treatment is a
      single cog rotating shut, and it does not read the same way on two
      meshed gears, so this glyph stays a static frame in the rail.
    -->
    <g v-else-if="name === 'gears'" fill="currentColor" stroke="none">
      <path
        d="M4.253 5.397a1.492 1.492 0 0 0 2.23-1.288h1.5a1.492 1.492 0 0 0 2.231 1.288l.75 1.298c.417-.233.916-.387 1.424-.478q-.046-.135-.12-.264l-.759-1.313a1.49 1.49 0 0 0-2.025-.553A1.49 1.49 0 0 0 7.992 2.61H6.476c-.82 0-1.485.66-1.492 1.478a1.49 1.49 0 0 0-2.026.553L2.2 5.953c-.41.71-.17 1.616.534 2.031a1.49 1.49 0 0 0-.534 2.031l.758 1.313c.41.71 1.314.955 2.026.553c.006.618.388 1.147.928 1.368c-.003-.571.14-1.15.447-1.68l.068-.118a1.494 1.494 0 0 0-2.174-.88l-.75-1.299c.985-.576.985-2 0-2.576z"
      />
      <path d="M7.234 9.484a1.5 1.5 0 1 0 0-3a1.5 1.5 0 0 0 0 3" />
      <path
        fill-rule="evenodd"
        d="M11.64 15.11a3.065 3.065 0 1 1 6.13 0a3.065 3.065 0 0 1-6.13 0m3.066-1.564a1.565 1.565 0 1 0 0 3.13a1.565 1.565 0 0 0 0-3.13"
        clip-rule="evenodd"
      />
      <path
        fill-rule="evenodd"
        d="M7.658 17.903a1.833 1.833 0 0 1 .671-2.505a.333.333 0 0 0 0-.576a1.833 1.833 0 0 1-.67-2.504l1.106-1.916a1.833 1.833 0 0 1 2.503-.67a.332.332 0 0 0 .499-.288c0-1.012.82-1.833 1.832-1.833h2.213c1.013 0 1.833.821 1.833 1.833c0 .256.277.416.498.288a1.83 1.83 0 0 1 2.503.67l1.107 1.918a1.83 1.83 0 0 1-.67 2.502a.332.332 0 0 0 0 .576a1.833 1.833 0 0 1 .67 2.503l-1.105 1.916a1.833 1.833 0 0 1-2.504.671a.333.333 0 0 0-.5.288c0 1.013-.82 1.833-1.832 1.833H13.6a1.833 1.833 0 0 1-1.833-1.832a.333.333 0 0 0-.5-.288a1.833 1.833 0 0 1-2.503-.671zm1.421-1.206a.333.333 0 0 0-.122.456l1.106 1.915c.092.16.295.214.455.122c1.221-.705 2.749.176 2.749 1.587c0 .183.149.332.333.332h2.212a.333.333 0 0 0 .333-.333c0-1.41 1.527-2.292 2.749-1.587c.16.092.363.037.455-.122l1.106-1.916a.333.333 0 0 0-.122-.454c-1.221-.705-1.222-2.468 0-3.174a.33.33 0 0 0 .121-.453l-1.107-1.917a.33.33 0 0 0-.454-.122c-1.221.706-2.748-.177-2.748-1.587a.333.333 0 0 0-.333-.333H13.6a.33.33 0 0 0-.332.333c0 1.41-1.527 2.292-2.749 1.586a.333.333 0 0 0-.454.122l-1.106 1.916a.333.333 0 0 0 .122.455c1.222.705 1.22 2.47 0 3.174"
        clip-rule="evenodd"
      />
    </g>
    <g v-else-if="name === 'more'">
      <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </g>
    <!-- Lucide's "logs" glyph (ISC licensed) — a log listing, replacing the old dotted trend line. -->
    <path
      v-else-if="name === 'activity'"
      d="M3 5h1m-1 7h1m-1 7h1M8 5h1m-1 7h1m-1 7h1m4-14h8m-8 7h8m-8 7h8"
    />
    <!--
      Solar's "webcam" glyph (MIT licensed) — a webcam on its stand, which is
      the object this names everywhere it appears: the Camera module, the
      Timelapse destination, and the Cameras category on Settings. It replaced a
      point-and-shoot camera body, which read as "take a photograph" and so
      collided with the still-capture action the `snapshot` glyph below now
      owns.
    -->
    <g v-else-if="name === 'camera'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M12 6.25c2.071 0 3.75 1.679 3.75 3.75c0 2.071-1.679 3.75-3.75 3.75S8.25 12.071 8.25 10c0-2.071 1.679-3.75 3.75-3.75m0 1.5A2.25 2.25 0 0 0 9.75 10A2.25 2.25 0 0 0 12 12.25A2.25 2.25 0 0 0 14.25 10A2.25 2.25 0 0 0 12 7.75"
        clip-rule="evenodd"
      />
      <path d="M12 3.751a.75.75 0 0 1 0 1.5a.75.75 0 0 1 0-1.5" />
      <path
        fill-rule="evenodd"
        d="M11.941 1.25c4.828.039 8.77 3.981 8.809 8.809c.037 4.604-3.489 8.35-8 8.667v2.524h3.25a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1 0-1.5h3.25v-2.546C6.798 18.261 3.287 14.496 3.25 9.942c-.039-4.837 3.854-8.73 8.691-8.692m-.012 1.5c-3.999-.032-7.212 3.181-7.179 7.18c.032 4.008 3.312 7.288 7.32 7.32c3.999.032 7.212-3.181 7.18-7.18c-.033-4.008-3.312-7.287-7.321-7.32"
        clip-rule="evenodd"
      />
    </g>
    <!--
      The same glyph struck through: a camera that is switched off, or a card
      with none selected. Composed rather than taken whole from Solar's own
      `webcam-off`, whose slash is drawn as an outlined band around the stroke —
      several kilobytes of path data to describe a gap this product's icons do
      not use anywhere else.
    -->
    <g v-else-if="name === 'cameraOff'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M12 6.25c2.071 0 3.75 1.679 3.75 3.75c0 2.071-1.679 3.75-3.75 3.75S8.25 12.071 8.25 10c0-2.071 1.679-3.75 3.75-3.75m0 1.5A2.25 2.25 0 0 0 9.75 10A2.25 2.25 0 0 0 12 12.25A2.25 2.25 0 0 0 14.25 10A2.25 2.25 0 0 0 12 7.75"
        clip-rule="evenodd"
      />
      <path d="M12 3.751a.75.75 0 0 1 0 1.5a.75.75 0 0 1 0-1.5" />
      <path
        fill-rule="evenodd"
        d="M11.941 1.25c4.828.039 8.77 3.981 8.809 8.809c.037 4.604-3.489 8.35-8 8.667v2.524h3.25a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1 0-1.5h3.25v-2.546C6.798 18.261 3.287 14.496 3.25 9.942c-.039-4.837 3.854-8.73 8.691-8.692m-.012 1.5c-3.999-.032-7.212 3.181-7.179 7.18c.032 4.008 3.312 7.288 7.32 7.32c3.999.032 7.212-3.181 7.18-7.18c-.033-4.008-3.312-7.287-7.321-7.32"
        clip-rule="evenodd"
      />
      <path d="M21.47 1.47a.75.75 0 0 1 1.06 1.06l-20 20a.75.75 0 0 1-1.06-1.06z" />
    </g>
    <!--
      Solar's "webcam-off-line-duotone" glyph (MIT licensed) — the outline again,
      with the camera body dimmed and the slash solid. It reports the one case
      that is nobody's fault and needs no fixing: a camera on this card that its
      owner switched off. `cameraNoSignal` below is for a camera that is meant to
      be streaming and is not, which is a different thing to say.
    -->
    <g v-else-if="name === 'cameraDisabled'" stroke-width="1.5">
      <path
        d="M14.8715 9.12853C14.4981 7.89669 13.3538 7 12 7C10.3431 7 9 8.34315 9 10C9 11.3538 9.8967 12.4981 11.1285 12.8715"
      />
      <path d="M22 2L2 22" />
      <path d="M12 4.50098H12.0001" />
      <path
        d="M22 2C20.8415 3.15848 19.683 4.31695 18.5246 5.47543C14.8415 9.15847 11.1585 12.8415 7.47544 16.5246C5.65029 18.3497 3.82515 20.1749 2 22"
      />
      <path
        d="M18.5246 5.47544C17.0618 3.3948 14.6512 2.02218 11.9354 2.00027C7.51731 1.96461 3.96461 5.51731 4.00027 9.93545C4.02218 12.6512 5.3948 15.0618 7.47545 16.5246"
        opacity=".5"
      />
      <path
        d="M16 22H8M9.65405 17.6507C10.3959 17.8779 11.1836 18.0002 11.9999 18.0002M11.9999 18.0002C16.4182 18.0002 19.9999 14.4184 19.9999 10.0002C19.9999 9.18388 19.8777 8.39616 19.6505 7.6543M11.9999 18.0002L12 22"
        opacity=".5"
      />
    </g>
    <!--
      Solar's "webcam-off-broken" glyph (MIT licensed). Deliberately the drawn
      outline where `cameraOff` above is solid: this one reports a camera that
      is *meant* to be streaming and is not — a frozen or failed stream — and
      the two states have to be distinguishable at 16px, which two weights of
      the same silhouette manage and two solid glyphs do not.
    -->
    <g v-else-if="name === 'cameraNoSignal'">
      <path d="M12 4.501h.0001" />
      <path d="M16 22H8" />
      <path d="M12 18.003V22" />
      <path d="M14.872 9.129A3 3 0 0 0 12 7a3 3 0 0 0-3 3a3 3 0 0 0 2.129 2.872" />
      <path d="M7.432 16.568A7.98 7.98 0 0 1 4 10c0-1.061.207-2.074.582-3" />
      <path d="M9.654 17.651A8 8 0 0 0 12 18a8 8 0 0 0 8-8c0-.816-.122-1.604-.35-2.346" />
      <path d="M9 2.582A7.98 7.98 0 0 1 12 2a7.98 7.98 0 0 1 6.568 3.432" />
      <path d="M22 2L2 22" />
    </g>
    <!--
      Remix Icon's "camera-ai-line" glyph (Apache-2.0 licensed) — a lens with a
      spark beside it, for capturing the frame that is on screen right now. Used
      by the camera tile's still capture and by the G-code viewer's screenshot,
      which is the same action on a different picture; that button previously
      carried the plain `camera` glyph, which now means the device rather than
      the act of capturing from it.
    -->
    <g v-else-if="name === 'snapshot'" fill="currentColor" stroke="none">
      <path
        d="m20.713 8.128l-.246.566a.506.506 0 0 1-.934 0l-.246-.566a4.36 4.36 0 0 0-2.22-2.25l-.759-.339a.53.53 0 0 1 0-.963l.717-.319a4.37 4.37 0 0 0 2.251-2.326l.253-.611a.506.506 0 0 1 .942 0l.253.61a4.37 4.37 0 0 0 2.25 2.327l.718.32a.53.53 0 0 1 0 .962l-.76.338a4.36 4.36 0 0 0-2.219 2.251M9 3h5v2H9.828l-2 2H4v12h16v-8h2v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4zm3 15a5.5 5.5 0 1 1 0-11a5.5 5.5 0 0 1 0 11m0-2a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7"
      />
    </g>
    <g v-else-if="name === 'controls'">
      <path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h8M16 18h4" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="14" cy="18" r="2" />
    </g>
    <!--
      Basil's "settings-adjust-solid" glyph (MIT licensed) — two slider tracks,
      each carrying its own knob. The Outputs dashboard module's header uses
      this now; its previous header glyph is the three-row `controls` icon
      just above, which moved to the Calibration destination in the sidebar
      rail rather than being redrawn.
    -->
    <g v-else-if="name === 'adjust'" fill="currentColor" stroke="none">
      <path
        d="M13.878 8.75H4a.75.75 0 0 1 0-1.5h9.878a2.251 2.251 0 0 1 4.244 0H20a.75.75 0 0 1 0 1.5h-1.878a2.251 2.251 0 0 1-4.244 0m6.122 8a.75.75 0 0 0 0-1.5h-9.878a2.251 2.251 0 0 0-4.244 0H4a.75.75 0 0 0 0 1.5h1.878a2.25 2.25 0 0 0 4.244 0z"
      />
    </g>
    <!--
      A GPS-style crosshair — a circle, a centre dot, and four ticks standing
      clear of it — for the positioning-mode readout, distinct from `home`
      (the endstop-origin icon already used for the axis pivots) and from
      `pin` (a place saved on the bed plan).
    -->
    <g v-else-if="name === 'crosshair'">
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </g>
    <!-- Material Symbols' "dashboard-customize-outline-rounded" glyph (Google, Apache 2.0). -->
    <path
      v-else-if="name === 'customize'"
      fill="currentColor"
      stroke="none"
      d="M4 11q-.425 0-.712-.288T3 10V4q0-.425.288-.712T4 3h6q.425 0 .713.288T11 4v6q0 .425-.288.713T10 11zm9 0q-.425 0-.712-.288T13 10V4q0-.425.288-.712T14 3h6q.425 0 .713.288T21 4v6q0 .425-.288.713T20 11zM4 21q-.425 0-.712-.288T3 20v-6q0-.425.288-.712T4 13h6q.425 0 .713.288T11 14v6q0 .425-.288.713T10 21zm12 0q-.425 0-.712-.288T16 20v-2h-2.025q-.425 0-.7-.288T13 17t.288-.712T14 16h2v-2.025q0-.425.288-.7T17 13t.713.288T18 14v2h2.025q.425 0 .7.288T21 17t-.288.713T20 18h-2v2.025q0 .425-.288.7T17 21"
    />
    <!-- Elastic UI's "documentation" glyph (Elastic, SIL OFL 1.1). -->
    <g
      v-else-if="name === 'documentation'"
      fill="currentColor"
      stroke="none"
      transform="scale(1.5)"
    >
      <path d="M9 3.5a.5.5 0 1 1-1 0a.5.5 0 0 1 1 0M9 5v3h1v1H8V6H7V5z" />
      <path
        d="M13.855 14.147a1.3 1.3 0 0 1-.158-.246A2 2 0 0 1 13.5 13c0-.414.103-.713.197-.901a1.3 1.3 0 0 1 .158-.246l.003-.005A.5.5 0 0 0 14 11.5V.5a.5.5 0 0 0-.5-.5H3.461l-.083.005a3 3 0 0 0-1.102.298a2.26 2.26 0 0 0-.88.763C1.148 1.44 1 1.913 1 2.5V13c0 .463.117.843.318 1.145c.2.298.462.491.708.615a2.3 2.3 0 0 0 .94.24H3v-1l-.029-.002a1.3 1.3 0 0 1-.498-.133a.8.8 0 0 1-.323-.275C2.07 13.47 2 13.287 2 13s.07-.47.15-.59a.8.8 0 0 1 .324-.275A1.3 1.3 0 0 1 3 12h9.658c-.091.27-.158.605-.158 1s.067.73.158 1H8v1h5.5a.5.5 0 0 0 .359-.848zM2.724 1.197q.14-.068.276-.11C3 2.918 3.001 11 2.999 11h-.033a2 2 0 0 0-.283.03a2.3 2.3 0 0 0-.657.21L2 11.254V2.5c0-.413.102-.689.229-.879c.128-.193.304-.328.495-.424M4 11V1h9v10z"
      />
      <path d="M7 13H4v2.5a.5.5 0 0 0 .854.354l.646-.647l.646.647A.5.5 0 0 0 7 15.5z" />
    </g>
    <!--
      A sliced plate with one object crossed out. The four equal cells make the
      plate's plurality visible at icon size; the X lives inside one cell so
      this cannot be mistaken for deleting the whole file or stopping a print.
    -->
    <g v-else-if="name === 'excludeObject'">
      <rect x="3" y="3" width="7" height="7" rx="1.25" />
      <rect x="14" y="3" width="7" height="7" rx="1.25" />
      <rect x="3" y="14" width="7" height="7" rx="1.25" />
      <rect x="14" y="14" width="7" height="7" rx="1.25" />
      <path d="m15.25 15.25 4.5 4.5M19.75 15.25l-4.5 4.5" />
    </g>
    <path v-else-if="name === 'down'" d="m7 9 5 5 5-5" />
    <g v-else-if="name === 'layers'">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </g>
    <!--
      One layer finishing, then advancing to the boundary below it. Kept as a
      sibling of `layers`: the stacked planes mean "choose a layer", while
      this single plane and arrow mean "after the current layer".
    -->
    <g v-else-if="name === 'layerNext'">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="M12 14v6M9.5 17.5 12 20l2.5-2.5" />
    </g>
    <path v-else-if="name === 'left'" d="m15 7-5 5 5 5" />
    <path v-else-if="name === 'right'" d="m9 7 5 5-5 5" />
    <!-- Griddy Icons' "file-download" glyph (MIT licensed). -->
    <g v-else-if="name === 'download'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M4 2h9.56L20 8.44V22H4zm13.44 6L14 4.56V8zM5.5 3.5v17h13v-11h-4.75c-.69 0-1.25-.56-1.25-1.25V3.5zm7.25 7.5v4.685l1.97-1.97l1.06 1.06l-2.895 2.895a1.25 1.25 0 0 1-.885.365c-.32 0-.64-.12-.885-.365L8.22 14.775l1.06-1.06l1.97 1.97V11z"
      />
    </g>
    <g v-else-if="name === 'drag'">
      <circle cx="8" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="18" r="1" fill="currentColor" stroke="none" />
    </g>
    <!-- Boxicons' "edit" glyph (MIT licensed). -->
    <g v-else-if="name === 'edit'" fill="currentColor" stroke="none">
      <path d="M5 21h14c1.1 0 2-.9 2-2v-7h-2v7H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2" />
      <path
        d="M7 13v3c0 .55.45 1 1 1h3c.27 0 .52-.11.71-.29l9-9a.996.996 0 0 0 0-1.41l-3-3a.996.996 0 0 0-1.41 0l-9.01 8.99A1 1 0 0 0 7 13m10-7.59L18.59 7L17.5 8.09L15.91 6.5zm-8 8l5.5-5.5l1.59 1.59l-5.5 5.5H9z"
      />
    </g>
    <!-- Griddy Icons' "alert-octagon" glyph (MIT licensed). -->
    <g v-else-if="name === 'emergency'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M16.145 22.005L16.14 22H7.86L2 16.14V7.86L7.86 2h8.285l5.86 5.86v8.285zM8.48 20.5h7.035l4.98-4.98V8.48L15.52 3.5H8.48L3.5 8.48v7.04zm4.27-7V8h-1.5v5.5zM13 16a1 1 0 1 1-2 0a1 1 0 0 1 2 0"
      />
    </g>
    <!--
      line-md's "brake-alert" glyph (MIT licensed). Kept as SMIL `<animate>`
      markup rather than flattened to a static path: it draws itself in once on
      mount and freezes there, and the header's emergency stop restarts that
      same timeline on hover/focus rather than looping it — see `.header-estop`
      in main.css and outlier 1 in button-system.md.
    -->
    <g v-else-if="name === 'emergencyStop'">
      <path
        stroke-dasharray="54"
        d="M12 4c4.42 0 8 3.58 8 8c0 4.42 -3.58 8 -8 8c-4.42 0 -8 -3.58 -8 -8c0 -4.42 3.58 -8 8 -8"
      >
        <animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="54;0" />
      </path>
      <g stroke-dasharray="20" stroke-dashoffset="20">
        <path d="M4.22 4.22c-4.29 4.3 -4.29 11.26 0 15.56">
          <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.3s" to="0" />
        </path>
        <path d="M19.78 4.22c4.29 4.3 4.29 11.26 0 15.56">
          <animate fill="freeze" attributeName="stroke-dashoffset" begin="1s" dur="0.3s" to="0" />
        </path>
      </g>
      <path stroke-dasharray="6" stroke-dashoffset="6" d="M12 8v4">
        <animate fill="freeze" attributeName="stroke-dashoffset" begin="1.3s" dur="0.2s" to="0" />
      </path>
      <path stroke-dasharray="4" stroke-dashoffset="4" d="M12 16v0.01">
        <animate fill="freeze" attributeName="stroke-dashoffset" begin="1.5s" dur="0.2s" to="0" />
      </path>
    </g>
    <!--
      Basil's "expand-solid" glyph (MIT licensed) — pairs with `collapse`, and
      shares its scale-about-center fix; see the comment above `collapse`.
    -->
    <g
      v-else-if="name === 'expand'"
      fill="currentColor"
      stroke="none"
      transform="translate(12 12) scale(1.5) translate(-12 -12)"
    >
      <path
        fill-rule="evenodd"
        d="M13.664 6.343c0 .414.336.75.75.75h2.493v2.493a.75.75 0 1 0 1.5 0V6.343a.75.75 0 0 0-.75-.75h-3.243a.75.75 0 0 0-.75.75m3.993 7.321a.75.75 0 0 0-.75.75v2.493h-2.493a.75.75 0 0 0 0 1.5h3.243a.75.75 0 0 0 .75-.75v-3.243a.75.75 0 0 0-.75-.75m-11.314 0a.75.75 0 0 1 .75.75v2.493h2.493a.75.75 0 0 1 0 1.5H6.343a.75.75 0 0 1-.75-.75v-3.243a.75.75 0 0 1 .75-.75m3.993-7.321a.75.75 0 0 1-.75.75H7.093v2.493a.75.75 0 1 1-1.5 0V6.343a.75.75 0 0 1 .75-.75h3.243a.75.75 0 0 1 .75.75"
        clip-rule="evenodd"
      />
    </g>
    <!--
      Content leaving its frame, not a frame growing: `expand` is a closed
      frame with its own corner arrows pushing outward, and this is content
      stepping out of an open one.
    -->
    <g v-else-if="name === 'popout'">
      <path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5" />
      <path d="M14 3h7v7M21 3l-8.6 8.6" />
    </g>
    <!--
      Griddy Icons' "file-code" glyph (MIT licensed), filled rather than
      stroked like the outline it replaces — its rounded fold and bracket
      chevrons don't survive this file's 1.8 stroke at 14-16px. The `< >`
      brackets stay `currentColor`, same as the page and fold: this glyph
      carries no accent of its own. The Configuration file tree recolours the
      brackets alone through `.icon-status-accent`, so a file's wiring into
      `printer.cfg` or an unsaved edit reads on the one detail that already
      means "code" rather than tinting the whole icon — see
      interface-standards.md's Configuration contract.
    -->
    <g v-else-if="name === 'fileCode'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M13.56 2H4v20h16V8.44zM14 4.56L17.44 8H14zM5.5 20.5v-17h7v4.75c0 .69.56 1.25 1.25 1.25h4.75v11z"
      />
      <path
        class="icon-status-accent"
        d="M9.97 11.47l-2.645 2.645a1.26 1.26 0 0 0 0 1.77L9.97 18.53l1.06-1.06L8.56 15l2.47-2.47zM12.97 12.53l1.06-1.06l2.645 2.645c.485.49.485 1.285 0 1.77L14.03 18.53l-1.06-1.06L15.44 15z"
      />
    </g>
    <!--
      Griddy Icons' "file-plus" glyph (MIT licensed) — replaces the compound
      `fileCode` + `add`-badge overlay the new-file toolbar button used to draw
      with two stacked `AppIcon`s.
    -->
    <g v-else-if="name === 'filePlus'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M4 2h9.56L20 8.44V22H4zm13.44 6L14 4.56V8zM5.5 3.5v17h13v-11h-4.75c-.69 0-1.25-.56-1.25-1.25V3.5zm5.75 7.75h1.5V14h2.75v1.5h-2.75v2.75h-1.5V15.5H8.5V14h2.75z"
      />
    </g>
    <!-- Griddy Icons' "jpg-file" glyph (MIT licensed). -->
    <g v-else-if="name === 'fileJpg'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M12.5 3.505h-7V12H4V2h9.56L20 8.44V12h-1.5V9.5h-4.75c-.69 0-1.25-.56-1.25-1.25zM17.44 8L14 4.56V8zM9.5 13.5h3.75c.69 0 1.25.56 1.25 1.25v3c0 .69-.56 1.25-1.25 1.25H11v3H9.5zm1.5 4h2V15h-2zm9.5-1.5v-1.25c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v6c0 .69.56 1.25 1.25 1.25h2.5c.69 0 1.25-.56 1.25-1.25V17.5H18V19h1v1.5h-2V15h2v1zM7 15H4v-1.5h4.5v7.25c0 .69-.56 1.25-1.25 1.25h-2.5c-.69 0-1.25-.56-1.25-1.25V18.5H5v2h2z"
      />
    </g>
    <!-- Griddy Icons' "png-file" glyph (MIT licensed). -->
    <g v-else-if="name === 'filePng'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M12.5 3.505h-7V12H4V2h9.56L20 8.44V12h-1.5V9.5h-4.75c-.69 0-1.25-.56-1.25-1.25zM17.44 8L14 4.56V8zM4 13.5h3.75c.69 0 1.25.56 1.25 1.25v3C9 18.44 8.44 19 7.75 19H5.5v3H4zm1.5 4h2V15h-2zm15-1.5v-1.25c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v6c0 .69.56 1.25 1.25 1.25h2.5c.69 0 1.25-.56 1.25-1.25V17.5H18V19h1v1.5h-2V15h2v1zm-8.97-2.5L13 17.62V13.5h1.5V22h-1.53l-1.47-4.12V22H10v-8.5z"
      />
    </g>
    <!-- Griddy Icons' "file-text" glyph (MIT licensed) — generic and log files. -->
    <g v-else-if="name === 'fileText'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M13.56 2H4v20h16V8.44zM14 4.56L17.44 8H14zM5.5 20.5v-17h7v4.75c0 .69.56 1.25 1.25 1.25h4.75v11zM13 16H7.5v1.5H13zm-5.5-3.5h9V14h-9z"
      />
    </g>
    <!--
      Griddy Icons' "files" glyph (MIT licensed) — no "copy file" action
      exists in Configuration or Print Files yet; this readies the icon for
      when one does, the same way an unassigned entry can sit in a palette
      before anything consumes it.
    -->
    <g v-else-if="name === 'copyFile'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M7 2h7.56L20 7.44V19H7zm10.94 5.5L14.5 4.06V7.5zm-9.44-4v14h10V9h-4.25C13.56 9 13 8.44 13 7.75V3.5zM4 5h1.5v15.5H17V22H4z"
      />
    </g>
    <!--
      Bootstrap Icons' "fan" glyph (MIT licensed), redrawn here rather than
      the previous hand-drawn three-blade sickle: four concave-waisted lobes
      read as blades in motion at a glance in a way three plain sickles did
      not. Filled rather than stroked — this shape's concave waists collapse
      to noise as a 1.8 outline at 14-16px, so it breaks this file's
      stroke-only convention on purpose, the same way the tiny hub dots
      already do everywhere else. Native 16x16 box scaled 1.5x to exactly
      fill this file's shared 24x24 viewBox, no coordinates hand-converted.
    -->
    <g v-else-if="name === 'fan'" fill="currentColor" stroke="none" transform="scale(1.5)">
      <path
        d="M10 3c0 1.313-.304 2.508-.8 3.4a2 2 0 0 0-1.484-.38c-.28-.982-.91-2.04-1.838-2.969a8 8 0 0 0-.491-.454A6 6 0 0 1 8 2c.691 0 1.355.117 1.973.332Q10 2.661 10 3m0 5q0 .11-.012.217c1.018-.019 2.2-.353 3.331-1.006a8 8 0 0 0 .57-.361a6 6 0 0 0-2.53-3.823a9 9 0 0 1-.145.64c-.34 1.269-.944 2.346-1.656 3.079c.277.343.442.78.442 1.254m-.137.728a2 2 0 0 1-1.07 1.109c.525.87 1.405 1.725 2.535 2.377q.3.174.605.317a6 6 0 0 0 2.053-4.111q-.311.11-.641.199c-1.264.339-2.493.356-3.482.11ZM8 10c-.45 0-.866-.149-1.2-.4c-.494.89-.796 2.082-.796 3.391q0 .346.027.678A6 6 0 0 0 8 14c.94 0 1.83-.216 2.623-.602a8 8 0 0 1-.497-.458c-.925-.926-1.555-1.981-1.836-2.96Q8.149 10 8 10M6 8q0-.12.014-.239c-1.02.017-2.205.351-3.34 1.007a8 8 0 0 0-.568.359a6 6 0 0 0 2.525 3.839a8 8 0 0 1 .148-.653c.34-1.267.94-2.342 1.65-3.075A2 2 0 0 1 6 8m-3.347-.632c1.267-.34 2.498-.355 3.488-.107c.196-.494.583-.89 1.07-1.1c-.524-.874-1.406-1.733-2.541-2.388a8 8 0 0 0-.594-.312a6 6 0 0 0-2.06 4.106q.309-.11.637-.199M8 9a1 1 0 1 0 0-2a1 1 0 0 0 0 2"
      />
      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
    </g>
    <!--
      Griddy Icons' "lightbulb-off" glyph (MIT licensed) — for a printer's own
      light pin, distinct from `sunMoon` (an unrelated concept that happens to
      share the word "light"). `AppOutputRow` swaps to `bulbOn` at render
      time when the row's own switch is on; the
      pickable catalogue in `controlsIcons.ts` still offers only `bulb` — the
      on/off choice is derived from the row's state, never a second thing to
      pick.
    -->
    <g v-else-if="name === 'bulb'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M16 16h-1.5c0-1.415.76-2.455 1.5-3.46c.77-1.055 1.5-2.055 1.5-3.54c0-3.035-2.465-5.5-5.5-5.5A5.503 5.503 0 0 0 6.5 9c0 1.485.73 2.485 1.5 3.54l.01.013c.731 1 1.49 2.038 1.49 3.447H8c0-.925-.56-1.69-1.21-2.575v-.001C5.95 12.274 5 10.974 5 9c0-3.86 3.14-7 7-7s7 3.14 7 7c0 1.975-.95 3.28-1.79 4.425C16.56 14.31 16 15.075 16 16m-7 4.5V22h6v-1.5zM8 19v-1.5h8V19z"
      />
    </g>
    <!-- Griddy Icons' "lightbulb-on" glyph (MIT licensed) — see `bulb` above. -->
    <g v-else-if="name === 'bulbOn'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M16 16h-1.5c0-1.415.76-2.455 1.5-3.46c.77-1.055 1.5-2.055 1.5-3.54c0-3.035-2.465-5.5-5.5-5.5A5.503 5.503 0 0 0 6.5 9c0 1.485.73 2.485 1.5 3.54l.01.013c.731 1 1.49 2.038 1.49 3.447H8c0-.925-.56-1.69-1.21-2.575v-.001C5.95 12.274 5 10.974 5 9c0-3.86 3.14-7 7-7s7 3.14 7 7c0 1.975-.95 3.28-1.79 4.425C16.56 14.31 16 15.075 16 16m-7 4.5V22h6v-1.5zM8 19v-1.5h8V19zM20.72 2.217l-2 2.001l1.06 1.06l2.002-2zM2.218 3.28l1.061-1.06l2.001 2l-1.06 1.06zM23 8.5h-2.5V10H23zm-22 0h2.5V10H1zm3.222 4.717L2.22 15.218l1.06 1.061l2.001-2.001l-1.06-1.06Zm14.496 1.064l1.06-1.061l2.002 2.001l-1.061 1.06z"
      />
    </g>
    <!-- Griddy Icons' "folder" glyph (MIT licensed). -->
    <g v-else-if="name === 'folder'" fill="currentColor" stroke="none">
      <path
        d="M19.25 21H4.75A2.755 2.755 0 0 1 2 18.25V5.75A2.755 2.755 0 0 1 4.75 3h4.81l2.5 2.5h7.19A2.755 2.755 0 0 1 22 8.25v10A2.755 2.755 0 0 1 19.25 21M4.75 4.5c-.69 0-1.25.56-1.25 1.25v12.5c0 .69.56 1.25 1.25 1.25h14.5c.69 0 1.25-.56 1.25-1.25v-10c0-.69-.56-1.25-1.25-1.25h-7.81l-2.5-2.5z"
      />
    </g>
    <!--
      Griddy Icons' "folder-code" glyph (MIT licensed) — `< >` brackets in
      place of `folder`'s plain silhouette, reserved for the Configuration
      nav-rail entry (`destinations.ts`) alone. Every in-page folder — a
      directory row, the `..` parent, the new-folder toolbar button — is a
      literal directory and stays plain `folder`; only the destination that
      means "browse config" gets the marked version.
    -->
    <g v-else-if="name === 'folderCode'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M19.25 21.005H4.75A2.755 2.755 0 0 1 2 18.255v-12.5a2.755 2.755 0 0 1 2.75-2.75h4.81l2.5 2.5h7.19A2.755 2.755 0 0 1 22 8.255v10a2.755 2.755 0 0 1-2.75 2.75m-14.5-16.5c-.69 0-1.25.56-1.25 1.25v12.5c0 .69.56 1.25 1.25 1.25h14.5c.69 0 1.25-.56 1.25-1.25V8.25c0-.69-.56-1.25-1.25-1.25h-7.81l-2.5-2.5H4.75zm9.78 13.025l-1.06-1.06l2.97-2.97l-2.97-2.97l1.06-1.06l3.145 3.145c.485.485.485 1.28 0 1.77zm-8.205-3.145L9.47 17.53l1.06-1.06l-2.97-2.97l2.97-2.97l-1.06-1.06l-3.145 3.145a1.26 1.26 0 0 0 0 1.77"
      />
    </g>
    <!--
      Carbon's "folder-move-to" glyph (IBM, Apache-2.0 licensed) — a folder
      with an arrow entering it, for the drag ghost that follows a file onto
      a destination folder in the Configuration explorer. Drawn on Carbon's
      own 32x32 grid, scaled 0.75x to this file's 24x24 viewBox; both origins
      sit at (0,0), so the scale alone lines it up with no translate.
    -->
    <g
      v-else-if="name === 'folderMoveTo'"
      fill="currentColor"
      stroke="none"
      transform="scale(0.75)"
    >
      <path d="m18 13l-1.41 1.41L19.17 17H10v2h9.17l-2.58 2.59L18 23l5-5z" />
      <path
        d="m11.172 6l3.414 3.414l.586.586H28v16H4V6zm0-2H4a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2H16l-3.414-3.414A2 2 0 0 0 11.172 4"
      />
    </g>
    <!--
      Griddy Icons' "folder-plus" glyph (MIT licensed) — replaces the
      compound `folder` + `add`-badge overlay the new-folder toolbar button
      used to draw with two stacked `AppIcon`s.
    -->
    <g v-else-if="name === 'folderPlus'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M12.06 5.5h7.19A2.755 2.755 0 0 1 22 8.25v10A2.755 2.755 0 0 1 19.25 21H4.75A2.755 2.755 0 0 1 2 18.25V5.75A2.755 2.755 0 0 1 4.75 3h4.81zm7.19 14c.69 0 1.25-.56 1.25-1.25v-10c0-.69-.56-1.25-1.25-1.25h-7.81l-2.5-2.5H4.75c-.69 0-1.25.56-1.25 1.25v12.5c0 .69.56 1.25 1.25 1.25zm-8-9.75h1.5v2.75h2.75V14h-2.75v2.75h-1.5V14H8.5v-1.5h2.75z"
      />
    </g>
    <!-- Fluent's "folder-up" glyph (Microsoft, MIT licensed). -->
    <g v-else-if="name === 'folderUp'" fill="currentColor" stroke="none">
      <path
        d="M12 17.25a.75.75 0 0 1-.75-.75v-5.19l-1.72 1.72a.75.75 0 1 1-1.06-1.06l3-3a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1-1.06 1.06l-1.72-1.72v5.19a.75.75 0 0 1-.75.75"
      />
      <path
        fill-rule="evenodd"
        d="M8.568 2.75c.306 0 .575 0 .836.062q.347.083.65.27c.23.14.42.33.635.546l.638.639c.285.284.344.337.402.372q.102.063.217.09c.066.016.146.021.548.021h5.138c.743 0 1.346 0 1.835.04c.505.041.955.129 1.372.341a3.5 3.5 0 0 1 1.53 1.53c.212.417.3.867.341 1.372c.04.489.04 1.092.04 1.835v6.264c0 .743 0 1.346-.04 1.835c-.041.505-.129.954-.341 1.372a3.5 3.5 0 0 1-1.53 1.53c-.417.212-.867.3-1.372.341c-.489.04-1.092.04-1.835.04H6.368c-.743 0-1.346 0-1.835-.04c-.505-.041-.954-.129-1.372-.341a3.5 3.5 0 0 1-1.53-1.53c-.212-.418-.3-.867-.341-1.372c-.04-.489-.04-1.092-.04-1.835V7.868c0-.743 0-1.346.04-1.835c.041-.505.129-.955.341-1.372a3.5 3.5 0 0 1 1.53-1.53c.418-.212.867-.3 1.372-.341c.489-.04 1.092-.04 1.835-.04zm.486 1.52c-.066-.015-.146-.02-.548-.02H6.4c-.782 0-1.324 0-1.745.035c-.412.034-.642.096-.813.183a2 2 0 0 0-.874.874c-.087.17-.15.4-.183.813c-.034.42-.035.963-.035 1.745v8.2c0 .782 0 1.324.035 1.745c.034.412.096.642.183.813a2 2 0 0 0 .874.874c.17.087.4.15.813.183c.42.034.963.035 1.745.035h11.2c.782 0 1.324 0 1.745-.035c.412-.034.642-.096.813-.183a2 2 0 0 0 .874-.874c.087-.17.15-.4.183-.813c.034-.42.035-.963.035-1.745V9.9c0-.782 0-1.324-.035-1.745c-.034-.412-.096-.642-.183-.813a2 2 0 0 0-.874-.874c-.17-.087-.4-.15-.813-.183c-.42-.034-.963-.035-1.745-.035h-5.168c-.306 0-.575 0-.836-.062a2.3 2.3 0 0 1-.65-.27c-.23-.14-.42-.33-.635-.546l-.638-.639c-.285-.284-.344-.337-.402-.373a.8.8 0 0 0-.217-.09"
        clip-rule="evenodd"
      />
    </g>
    <!-- Qlementine Icons' "fullscreen-16" glyph (MIT licensed). -->
    <g v-else-if="name === 'fullscreen'" fill="currentColor" stroke="none" transform="scale(1.5)">
      <path
        d="M13 3.5v3a.5.5 0 0 1-1 0V4.71L9.85 6.86a.5.5 0 0 1-.707-.707l2.15-2.15h-1.79a.5.5 0 0 1 0-1h3a.5.5 0 0 1 .351.144l.004.004a.5.5 0 0 1 .144.348v.004zM3.5 9a.5.5 0 0 1 .5.5v1.79l2.15-2.15a.5.5 0 0 1 .707.707l-2.15 2.15h1.79a.5.5 0 0 1 0 1H3.494a.5.5 0 0 1-.497-.499v-3a.5.5 0 0 1 .5-.5z"
      />
      <path
        fill-rule="evenodd"
        d="M0 4.8c0-1.68 0-2.52.327-3.16A3.02 3.02 0 0 1 1.637.33c.642-.327 1.48-.327 3.16-.327h6.4c1.68 0 2.52 0 3.16.327a3.02 3.02 0 0 1 1.31 1.31c.327.642.327 1.48.327 3.16v6.4c0 1.68 0 2.52-.327 3.16a3 3 0 0 1-1.31 1.31c-.642.327-1.48.327-3.16.327h-6.4c-1.68 0-2.52 0-3.16-.327a3 3 0 0 1-1.31-1.31C0 13.718 0 12.88 0 11.2zM4.8 1h6.4c.857 0 1.44 0 1.89.038c.438.035.663.1.819.18c.376.192.682.498.874.874c.08.156.145.38.18.819c.037.45.038 1.03.038 1.89v6.4c0 .857-.001 1.44-.038 1.89c-.036.438-.101.663-.18.819a2 2 0 0 1-.874.874c-.156.08-.381.145-.819.18c-.45.036-1.03.037-1.89.037H4.8c-.857 0-1.44 0-1.89-.037c-.438-.036-.663-.101-.819-.18a2 2 0 0 1-.874-.874c-.08-.156-.145-.381-.18-.82C1 12.64.999 12.06.999 11.2V4.8c0-.856.001-1.44.038-1.89c.036-.437.101-.662.18-.818c.192-.376.498-.682.874-.874c.156-.08.381-.145.819-.18C3.36 1 3.94 1 4.8 1"
        clip-rule="evenodd"
      />
    </g>
    <!-- Material Symbols' "function-rounded" glyph (Google, Apache 2.0) — the Macros module header. -->
    <path
      v-else-if="name === 'function'"
      fill="currentColor"
      stroke="none"
      d="M5.525 21Q4.4 21 3.7 20.4T3 18.8q0-.8.425-1.288t1.075-.487q.625 0 1.063.425T6 18.475q0 .125-.012.225t-.038.225q.125-.025.213-.138t.137-.312L7.85 10H6q-.425 0-.712-.287T5 9t.288-.712T6 8h2.225l.525-2.85q.175-.95.938-1.55T11.5 3q1.1 0 1.8.65t.7 1.625q0 .75-.425 1.238T12.5 7q-.625 0-1.062-.425T11 5.525q0-.125.013-.225t.037-.225q-.15.05-.225.15t-.125.3L10.275 8H14q.425 0 .712.288T15 9q0 .375-.238.65t-.587.325l1.325 1.5l1.325-1.5q-.35-.05-.587-.325T16 9q0-.425.288-.712T17 8h3q.425 0 .713.288T21 9t-.288.713T20 10h-.55l-2.625 3l2.625 3H20q.425 0 .713.288T21 17t-.288.713T20 18h-3q-.425 0-.712-.288T16 17q0-.375.238-.65t.587-.325L15.5 14.5l-1.325 1.525q.35.05.588.325T15 17q0 .425-.287.713T14 18h-3q-.425 0-.712-.288T10 17t.288-.712T11 16h.55l2.625-3l-2.625-3H9.9l-1.6 8.6q-.2 1.125-.925 1.763T5.525 21"
    />
    <!-- Boxicons' "link" glyph (MIT licensed). -->
    <g v-else-if="name === 'globe'" fill="currentColor" stroke="none">
      <path
        d="M9.88 18.36a3 3 0 0 1-4.24 0a3 3 0 0 1 0-4.24l2.83-2.83l-1.41-1.41l-2.83 2.83a5.003 5.003 0 0 0 0 7.07c.98.97 2.25 1.46 3.54 1.46s2.56-.49 3.54-1.46l2.83-2.83l-1.41-1.41l-2.83 2.83Zm2.83-14.14L9.88 7.05l1.41 1.41l2.83-2.83a3 3 0 0 1 4.24 0a3 3 0 0 1 0 4.24l-2.83 2.83l1.41 1.41l2.83-2.83a5.003 5.003 0 0 0 0-7.07a5.003 5.003 0 0 0-7.07 0Z"
      />
      <path d="m16.95 8.46l-.71-.7l-.7-.71l-4.25 4.24l-4.24 4.25l.71.7l.7.71l4.25-4.24z" />
    </g>
    <g v-else-if="name === 'help'">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </g>
    <!-- CoreUI Icons' "hide" glyph (MIT licensed). -->
    <path
      v-else-if="name === 'hide'"
      d="m4 4l16 16m-3.5-3.244C15.147 17.485 13.618 18 12 18c-3.53 0-6.634-2.452-8.413-4.221c-.47-.467-.705-.7-.854-1.159c-.107-.327-.107-.913 0-1.24c.15-.459.385-.693.855-1.16c.897-.892 2.13-1.956 3.584-2.793M19.5 14.634c.333-.293.638-.582.912-.854l.003-.003c.468-.466.703-.7.852-1.156c.107-.327.107-.914 0-1.241c-.15-.458-.384-.692-.854-1.159C18.633 8.452 15.531 6 12 6q-.507 0-1 .064m2.323 7.436a2 2 0 0 1-2.762-2.889"
    />
    <g v-else-if="name === 'home'">
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v11h14V10M9 21v-7h6v7" />
    </g>
    <!--
      Akar Icons' "info" glyph (MIT licensed) -- a circled "i", for a reported
      condition that is neither an error nor an action, distinct from `help`'s
      circled question mark. Circle radius brought from the source's 10 to 9
      to match `help`'s own clearance, since the two appear in the same rows.
    -->
    <g v-else-if="name === 'info'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01" />
      <path d="M10 11h2v5" />
      <path d="M10 16h4" />
    </g>
    <!--
      IconPark Outline's "history" glyph (ByteDance, Apache 2.0) — a clock
      face with its hour hand mid-sweep and a small counter-clockwise arrow
      at the base, for "time already elapsed" rather than `activity`'s live
      pulse. Native 48x48 box, stroked like this file's own default rather
      than filled, so it keeps its source `stroke-width="4"` and just scales
      with the box — 2 at this file's 24x24, close to the shared 1.8.
    -->
    <g v-else-if="name === 'history'" stroke-width="4" transform="scale(0.5)">
      <path d="M5.818 6.727V14h7.273" />
      <path
        d="M4 24c0 11.046 8.954 20 20 20v0c11.046 0 20-8.954 20-20S35.046 4 24 4c-7.402 0-13.865 4.021-17.323 9.998"
      />
      <path d="m24.005 12l-.001 12.009l8.48 8.48" />
    </g>
    <!-- Material Symbols' "control-camera" glyph (Google, Apache 2.0). -->
    <g v-else-if="name === 'move'" fill="currentColor" stroke="none">
      <path
        d="M11.975 15.025q-1.25 0-2.125-.875t-.875-2.125T9.85 9.9t2.125-.875T14.1 9.9t.875 2.125t-.875 2.125t-2.125.875m0 6.975l-4.25-4.25l1.425-1.425l2.85 2.85l2.825-2.825l1.4 1.4zm-5.75-5.725l-4.25-4.25l4.25-4.25L7.65 9.2L4.8 12.05l2.825 2.825zm2.9-8.625l-1.4-1.4L11.975 2l4.25 4.25L14.8 7.675l-2.85-2.85zm8.6 8.625L16.3 14.85L19.15 12l-2.825-2.825l1.4-1.4l4.25 4.25z"
      />
    </g>
    <g v-else-if="name === 'machine'">
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M8 7h8M8 11h8M8 15h3" />
      <circle cx="16" cy="16" r="1.5" />
    </g>
    <path v-else-if="name === 'macro'" d="M13.5 3 6 13.2h4.6L9.8 21l7.7-10.2h-4.7Z" />
    <!-- Griddy Icons' "alarm" glyph (MIT licensed). -->
    <g v-else-if="name === 'maintenance'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="m18.278 2.217l-1.06 1.06l3.998 4l1.06-1.061zM3 13c0 4.96 4.04 9 9 9s9-4.04 9-9s-4.04-9-9-9s-9 4.04-9 9m1.5 0c0-4.135 3.365-7.5 7.5-7.5s7.5 3.365 7.5 7.5s-3.366 7.5-7.5 7.5s-7.5-3.365-7.5-7.5m6.75.31l2.97 2.97l1.06-1.06l-2.53-2.53V8h-1.5zM1.716 6.22l3.998-4l1.061 1.061L2.777 7.28l-1.06-1.06Z"
      />
    </g>
    <g v-else-if="name === 'duplicate'">
      <rect x="3" y="3" width="12" height="12" rx="2.5" />
      <path d="M9 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2" />
    </g>
    <!--
      Material Design Icons' "printer-3d-nozzle-outline" glyph (Pictogrammers,
      Apache 2.0) — the Extruder card's default. `nozzleHeat` is its sibling
      "printer-3d-nozzle-heat-outline": `ExtruderModule`'s registry entry
      swaps to it while the hotend is climbing toward a target, the two
      little heat-wave marks the only difference between them.
    -->
    <g v-else-if="name === 'nozzle'" fill="currentColor" stroke="none">
      <path
        d="M7 2h10v5h2v6h-2.5L13 17h-2l-3.5-4H5V7h2zm3 20H2v-2h8a1 1 0 0 0 1-1v-1h2v1a3 3 0 0 1-3 3M7 9v2h1.5l3.5 4l3.5-4H17V9h-2V4H9v5z"
      />
    </g>
    <g v-else-if="name === 'nozzleHeat'" fill="currentColor" stroke="none">
      <path
        d="m23 14.5l-1.4 2.2l1.4 2.2l-2 3.1l-1.8-.9l1.5-2.2l-1.5-2.2l2-3.1zm-4.3 0l-1.5 2.2l1.5 2.2l-2 3.1l-1.8-.9l1.4-2.2l-1.4-2.2l2-3.1zM4 2h10v5h2v6h-2.5L10 17H8l-3.5-4H2V7h2zm0 7v2h1.5L9 15l3.5-4H14V9h-2V4H6v5z"
      />
    </g>
    <!--
      selfh.st's "spoolman-light" glyph (CC BY 4.0 — attribution required;
      see README's third-party credits) — Spoolman's own mark, for the card
      that is entirely a Spoolman integration rather than a generic reel of
      filament. Native 512x512 box scaled to this file's shared 24x24
      viewBox; its source hardcodes white, recoloured here to `currentColor`
      like every other icon in this set.
    -->
    <g v-else-if="name === 'spool'" fill="currentColor" stroke="none" transform="scale(0.046875)">
      <path
        d="M403.9 0H109.1C49.1 0 .5 48.6.5 108.6v294.8c0 60 48.6 108.6 108.6 108.6h294.8c60 0 108.6-48.6 108.6-108.6V108.6C512.5 48.6 463.9 0 403.9 0M256.5 465.5C140.9 465.5 47 371.6 47 256S140.9 46.5 256.5 46.5S466 140.3 466 256s-93.9 209.5-209.5 209.5m151.6-298.8c4.1-2.3 9-2.8 13.5-1.2c4.5 1.5 8.1 4.9 9.9 9.2c22 52 22 110.6 0 162.6v.1c-1.8 4.3-5.4 7.7-9.9 9.2s-9.3 1.1-13.4-1.2l-23.3-13.1l1.6-2.9c25.1-44.5 25.6-98.8 1.3-143.8l-2.9-5.4m-256.7 3.6l3.2-5.2c26.8-43.5 74.1-70.2 125.2-70.8h3.2l-.3-26.7c0-4.7-2.1-9.2-5.6-12.3s-8.2-4.6-12.9-4h-.1c-56 6.9-106.8 36.2-140.8 81.3c-2.8 3.8-3.9 8.6-3 13.2c.9 4.7 3.7 8.7 7.8 11.1m155.6 236.5l-6.1-.2c-51.1-1.5-97.9-29-123.9-73l-1.7-2.8l-22.9 13.6c-4.1 2.4-6.9 6.4-7.8 11c-.9 4.7.2 9.4 3 13.2v.1c34 45.1 84.8 74.4 140.8 81.3c4.7.6 9.4-.9 13-4s5.6-7.6 5.7-12.3m-4-319.5h3.6l.6 68.6c.2 16.3-8.5 31.5-22.7 39.6s-31.6 8-45.6-.3l-58.7-35.1l3.2-5.1c25.7-41.8 70.5-67.1 119.6-67.7m4.8 217.7l-.8 68.4l-6-.2c-49.2-1.4-93.5-27.5-118.5-69.8l-1.8-3l59-34.9c14.1-8.3 31.5-8.4 45.6-.2s22.7 23.4 22.5 39.7m117.7-2.7l-59.7-33.7c-14.2-8-23-23.1-23-39.4s8.9-31.4 23.1-39.4l59.7-33.4l2.9 5.3c23.4 43.3 22.9 94.7-1.3 137.6z"
      />
    </g>
    <g v-else-if="name === 'mesh'">
      <path d="m12 3 9 5.2-9 5.2-9-5.2Z" />
      <path d="m3 14.8 9 5.2 9-5.2M7.5 5.7l9 5.2M16.5 5.7l-9 5.2" />
    </g>
    <!-- Iconoir's "box-3d-center" glyph (MIT licensed). -->
    <g v-else-if="name === 'viewer'">
      <path fill="currentColor" stroke="none" d="M12 17a1 1 0 1 0 0-2a1 1 0 0 0 0 2" />
      <path
        d="M21 7.353v9.294a.6.6 0 0 1-.309.525l-8.4 4.666a.6.6 0 0 1-.582 0l-8.4-4.666A.6.6 0 0 1 3 16.647V7.353a.6.6 0 0 1 .309-.524l8.4-4.667a.6.6 0 0 1 .582 0l8.4 4.667a.6.6 0 0 1 .309.524"
      />
      <path
        d="m20.5 16.722l-8.209-4.56a.6.6 0 0 0-.582 0L3.5 16.722m.028-9.428l8.18 4.544a.6.6 0 0 0 .583 0l8.209-4.56M12 3v9m0 7.5V22"
      />
    </g>
    <path v-else-if="name === 'pause'" d="M9 5v14M15 5v14" />
    <g v-else-if="name === 'pin'">
      <path
        d="M12 4.87a5.5 5.5 0 0 0-5.5 5.5c0 4 5.5 11.7 5.5 11.7s5.5-7.7 5.5-11.7A5.5 5.5 0 0 0 12 4.87Z"
      />
      <circle cx="12" cy="10.37" r="2" />
    </g>
    <path v-else-if="name === 'play'" d="m8 5 11 7-11 7Z" />
    <g v-else-if="name === 'power'">
      <path d="M12 3v8" />
      <path d="M7 6.3a8 8 0 1 0 10 0" />
    </g>
    <!--
      EOS Icons' "3d-print" glyph (SUSE UX/UI team, MIT licensed) — the
      Print card's own icon, replacing a generic office printer with a
      silhouette that is actually a 3D printer's gantry and nozzle. Its
      source draws to the full 24x24 edge with no margin, unlike every other
      icon in this set; scaled to 20x20 and centred so it keeps the same ~2px
      clearance the rest already have, rather than reading as the one icon
      with no breathing room.
    -->
    <g
      v-else-if="name === 'print'"
      fill="currentColor"
      stroke="none"
      transform="translate(2 2) scale(0.8333)"
    >
      <path
        d="M22 2v20H2V2zm0-2H2a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2"
      />
      <path d="M18 17H6v2h12zm-5 2h-2v3h2z" />
      <path
        fill-rule="evenodd"
        d="M9.327 7.089L9.272 7H2V5h7.266A2 2 0 0 1 11 4h2a2 2 0 0 1 1.731 1H23v2h-8.272a2 2 0 0 1-1.186.916L12 11l-1.542-3.084a2 2 0 0 1-1.131-.827M12 7h-1.004h2.008zm1-1a1 1 0 1 1-2 0a1 1 0 0 1 2 0"
      />
    </g>
    <!--
      Element Plus' "cpu" glyph (Element, MIT licensed). Native 1024x1024 box
      scaled to this file's shared 24x24 viewBox, the same treatment `spool`
      already gives a non-24 native size.
    -->
    <g
      v-else-if="name === 'processor'"
      fill="currentColor"
      stroke="none"
      transform="scale(0.0234375)"
    >
      <path
        d="M320 256a64 64 0 0 0-64 64v384a64 64 0 0 0 64 64h384a64 64 0 0 0 64-64V320a64 64 0 0 0-64-64zm0-64h384a128 128 0 0 1 128 128v384a128 128 0 0 1-128 128H320a128 128 0 0 1-128-128V320a128 128 0 0 1 128-128"
      />
      <path
        d="M512 64a32 32 0 0 1 32 32v128h-64V96a32 32 0 0 1 32-32m160 0a32 32 0 0 1 32 32v128h-64V96a32 32 0 0 1 32-32m-320 0a32 32 0 0 1 32 32v128h-64V96a32 32 0 0 1 32-32m160 896a32 32 0 0 1-32-32V800h64v128a32 32 0 0 1-32 32m160 0a32 32 0 0 1-32-32V800h64v128a32 32 0 0 1-32 32m-320 0a32 32 0 0 1-32-32V800h64v128a32 32 0 0 1-32 32M64 512a32 32 0 0 1 32-32h128v64H96a32 32 0 0 1-32-32m0-160a32 32 0 0 1 32-32h128v64H96a32 32 0 0 1-32-32m0 320a32 32 0 0 1 32-32h128v64H96a32 32 0 0 1-32-32m896-160a32 32 0 0 1-32 32H800v-64h128a32 32 0 0 1 32 32m0-160a32 32 0 0 1-32 32H800v-64h128a32 32 0 0 1 32 32m0 320a32 32 0 0 1-32 32H800v-64h128a32 32 0 0 1 32 32"
      />
    </g>
    <!--
      Fluent System Icons' "ram-20-regular" glyph (Microsoft, MIT licensed).
      Native 20x20 box scaled to this file's shared 24x24 viewBox.
    -->
    <path
      v-else-if="name === 'ram'"
      fill="currentColor"
      stroke="none"
      transform="scale(1.2)"
      d="M16.04 4q.39 0 .741.156q.352.157.625.43q.274.273.43.625q.156.351.164.75V11q0 .531-.266 1a1.9 1.9 0 0 1-.734.734V14.5q0 .305-.117.578a1.5 1.5 0 0 1-.805.805q-.28.125-.578.117h-4a.48.48 0 0 1-.352-.148L10 14.703l-1.148 1.149A.48.48 0 0 1 8.5 16h-4q-.305 0-.578-.117a1.5 1.5 0 0 1-.805-.805A1.3 1.3 0 0 1 3 14.5v-1.766A1.93 1.93 0 0 1 2.273 12A2.06 2.06 0 0 1 2 11V5.96q0-.39.156-.741a2.1 2.1 0 0 1 .43-.625a2.1 2.1 0 0 1 .625-.43A1.9 1.9 0 0 1 3.96 4zM17 6a.95.95 0 0 0-.078-.383a1.1 1.1 0 0 0-.211-.32a.9.9 0 0 0-.32-.219A1 1 0 0 0 16 5H4a.97.97 0 0 0-.703.29a1.1 1.1 0 0 0-.219.32A.85.85 0 0 0 3 6v5q0 .21.078.39q.079.18.211.32a.85.85 0 0 0 .313.212q.18.07.398.078h12a.97.97 0 0 0 .703-.29q.133-.132.219-.32A.85.85 0 0 0 17 11zm-2 0a.95.95 0 0 1 .383.078q.18.079.32.211a.9.9 0 0 1 .219.32Q16 6.797 16 7v3a.97.97 0 0 1-.29.703a1.1 1.1 0 0 1-.32.219A.85.85 0 0 1 15 11H5a1 1 0 0 1-.39-.078a1.1 1.1 0 0 1-.32-.211a.85.85 0 0 1-.212-.313A1.2 1.2 0 0 1 4 10V7a.97.97 0 0 1 .29-.703a1.1 1.1 0 0 1 .32-.219A.85.85 0 0 1 5 6zM7.5 7H5v3h2.5zm4 3V7h-3v3zm1 0H15V7h-2.5zm3.5 3H4v1.5q0 .203.148.352A.48.48 0 0 0 4.5 15h3.797l1.351-1.352A.48.48 0 0 1 10 13.5a.48.48 0 0 1 .352.148L11.71 15h3.79a.48.48 0 0 0 .352-.148A.48.48 0 0 0 16 14.5z"
    />
    <!-- Flowbite's "refresh-outline" glyph (MIT licensed). -->
    <path
      v-else-if="name === 'refresh'"
      d="M17.651 7.65a7.131 7.131 0 0 0-12.68 3.15M18.001 4v4h-4m-7.652 8.35a7.13 7.13 0 0 0 12.68-3.15M6 20v-4h4"
    />
    <!--
      line-md's "loading-loop" glyph (MIT licensed): a single quarter-circle
      arc. Upstream spins it with its own `animateTransform`, which sits
      outside the application-wide `prefers-reduced-motion` rule, so the spin
      is a CSS `animation: spinner-turn` on `.spinner-icon` instead (main.css),
      the same substitution the cog above makes for its own SMIL. See outlier
      12 in button-system.md and ADR 0004's spinning-icon-family exception.
    -->
    <path v-else-if="name === 'spinner'" d="M12 3c4.97 0 9 4.03 9 9" />
    <g v-else-if="name === 'rename'">
      <path d="M4 18h6M7 15V5M4 5h6M14 7h6M14 12h5M14 17h6" />
    </g>
    <g v-else-if="name === 'save'">
      <path d="M5 3h12l3 3v15H4V4a1 1 0 0 1 1-1Z" />
      <path d="M8 3v6h8V3M8 21v-7h8v7" />
    </g>
    <!-- Griddy Icons' "file-search" glyph (MIT licensed). -->
    <g v-else-if="name === 'fileSearch'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M4 2h9.56L20 8.44V18.5h-1.5v-9h-4.75c-.69 0-1.25-.56-1.25-1.25V3.5h-7v17h9V22H4zm13.44 6L14 4.56V8zM12 11c2.205 0 4 1.795 4 4c0 .83-.26 1.605-.695 2.245l3.475 3.475l-1.06 1.06l-3.475-3.475c-.64.44-1.415.695-2.245.695c-2.205 0-4-1.795-4-4s1.795-4 4-4m0 1.5a2.5 2.5 0 0 0 0 5a2.5 2.5 0 0 0 0-5"
      />
    </g>
    <g v-else-if="name === 'warning'">
      <path d="M12 3.5 2.5 20h19Z" />
      <path d="M12 9.5v5M12 18h.01" />
    </g>
    <!--
      Carbon's "warning--diamond" glyph (IBM, Apache-2.0 licensed), scaled from
      its native 32x32 box (`scale(0.75)`, unmoved: 32 * 0.75 = 24). A diamond
      rather than `warning`'s triangle, so a row needing attention reads as a
      distinct shape rather than the same caution glyph at a different size.
    -->
    <g
      v-else-if="name === 'warningDiamond'"
      fill="currentColor"
      stroke="none"
      transform="scale(0.75)"
    >
      <path
        d="m16,20c-.8284,0-1.5.6716-1.5,1.5s.6716,1.5,1.5,1.5,1.5-.6716,1.5-1.5-.6716-1.5-1.5-1.5h0Z"
      />
      <rect x="15" y="9" width="2" height="9" />
      <path
        d="m16,30c-.5335,0-1.0672-.2031-1.4732-.6094L2.6094,17.4732c-.8126-.8123-.8126-2.1342,0-2.9465L14.5268,2.6094c.8121-.8126,2.1344-.8126,2.9465,0l11.9173,11.9173c.8126.8123.8126,2.1342,0,2.9465l-11.9173,11.9173c-.406.4063-.9398.6094-1.4732.6094Zm0-26.0008c-.0215,0-.0427.0083-.0591.0244L4.0236,15.9409c-.0325.0327-.0325.0855,0,.1182l11.9173,11.9173c.0327.0322.0855.0322.1182,0l11.9173-11.9173c.0325-.0327.0325-.0855,0-.1182l-11.9173-11.9173c-.0164-.0161-.0376-.0244-.0591-.0244Z"
      />
    </g>
    <g v-else-if="name === 'zoomIn'">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5M10.5 7.5v6M7.5 10.5h6" />
    </g>
    <g v-else-if="name === 'zoomOut'">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5M7.5 10.5h6" />
    </g>
    <!--
      FormKit's "submit" glyph (MIT licensed). Native 15x16 box scaled 1.5x
      into this file's shared 24x24 viewBox, the same treatment `fan` already
      gives a non-24 native size — the 1.5px the width falls short of 24
      reads as centred at every size this renders at.
    -->
    <g v-else-if="name === 'send'" fill="currentColor" stroke="none" transform="scale(1.5)">
      <path
        d="M12.49 7.14L3.44 2.27c-.76-.41-1.64.3-1.4 1.13l1.24 4.34q.075.27 0 .54l-1.24 4.34c-.24.83.64 1.54 1.4 1.13l9.05-4.87a.98.98 0 0 0 0-1.72Z"
      />
    </g>
    <!-- Lucide's "gauge" glyph (ISC licensed). -->
    <g v-else-if="name === 'sensor'">
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </g>
    <rect v-else-if="name === 'stop'" x="6" y="6" width="12" height="12" rx="2" />
    <!-- Material Symbols' "speed-outline" glyph (Google, Apache 2.0). -->
    <path
      v-else-if="name === 'speed'"
      fill="currentColor"
      stroke="none"
      d="M12 16.088q.95-.013 1.4-.688L19 7l-8.4 5.6q-.675.45-.712 1.375t.562 1.525t1.55.588M12 4q1.475 0 2.838.413T17.4 5.65l-1.9 1.2q-.825-.425-1.712-.637T12 6Q8.675 6 6.337 8.338T4 14q0 1.05.288 2.075T5.1 18h13.8q.575-.95.838-1.975T20 13.9q0-.9-.213-1.75t-.637-1.65l1.2-1.9q.75 1.175 1.188 2.5T22 13.85t-.325 2.725t-1.025 2.475q-.275.45-.75.7t-1 .25H5.1q-.525 0-1-.25t-.75-.7q-.65-1.125-1-2.387T2 14q0-2.075.788-3.887t2.15-3.175t3.187-2.15T12 4"
    />
    <!-- Griddy Icons' "temperature" glyph (MIT licensed). -->
    <g v-else-if="name === 'temperature'" fill="currentColor" stroke="none">
      <path
        d="M11.5 5.5C11.5 3.57 9.93 2 8 2S4.5 3.57 4.5 5.5v7.935C3.54 14.375 3 15.655 3 17c0 2.755 2.245 5 5 5s5-2.245 5-5c0-1.35-.54-2.63-1.5-3.565zM8 20.5c-1.93 0-3.5-1.57-3.5-3.5c0-1.025.45-2 1.235-2.665L6 14.11V5.5a2 2 0 1 1 4 0v8.61l.265.225A3.5 3.5 0 0 1 11.5 17c0 1.93-1.57 3.5-3.5 3.5"
      />
      <path
        d="M8.75 15.71V8.5h-1.5v7.21c-.445.26-.75.74-.75 1.29c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5c0-.555-.305-1.03-.75-1.29M21 4h-6.5v1.5H21zm-2 3.5h-4.5V9H19zm2 3.5h-6.5v1.5H21zm-2 3.5h-4.5V16H19z"
      />
    </g>
    <!--
      A BLTouch/MicroProbe-style bed probe: a flat top mounting plate, a
      rounded body, and a thin stem down to the contact tip — distinct from
      `temperature` (a thermometer, no plate or stem) and `crosshair` (the
      positioning-mode readout, an unrelated targeting reticle that happens to
      share the general idea of "sensing a point").
    -->
    <g v-else-if="name === 'probe'">
      <rect x="6" y="3" width="12" height="3" rx="1.2" />
      <path d="M8.5 6v6a3.5 3.5 0 0 0 7 0V6" />
      <path d="M12 15.5V19" />
      <circle cx="12" cy="20.5" r="1" fill="currentColor" stroke="none" />
    </g>
    <!-- Griddy Icons' "trash-alt" glyph (MIT licensed). -->
    <g v-else-if="name === 'trash'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M21 5h-5v-.25A2.755 2.755 0 0 0 13.25 2h-2.5A2.755 2.755 0 0 0 8 4.75V5H3v1.5h1v12.75A2.755 2.755 0 0 0 6.75 22h10.5A2.755 2.755 0 0 0 20 19.25V6.5h1zM9.5 4.75c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25V5h-5zm9 14.5c0 .69-.56 1.25-1.25 1.25H6.75c-.69 0-1.25-.56-1.25-1.25V6.5h13zm-8-9.75H9v8h1.5zm3 0H15v8h-1.5z"
      />
    </g>
    <!--
      The shackle carries the state, not the body: closed and centred when
      locked, swung clear of the keyway when open. The body stays put between
      the two so the pair reads as one padlock changing rather than two icons
      swapping, and the difference survives the 1rem the xs and sm tiers draw
      these at.
    -->
    <g v-else-if="name === 'lock'">
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </g>
    <g v-else-if="name === 'unlock'">
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 7.7-1.5" />
    </g>
    <!--
      Griddy Icons' "undo" glyph (MIT licensed) — one branch for both
      `reset` and `undo`. The two were never actually distinct: `reset` lived
      only inside AppField/AppSlider's own revert-to-configured button, while
      `undo` already covered every other revert/discard action in the
      product, including a control literally labelled "reset" (Movement's Z
      offset). One glyph for one concept, named twice for two call sites that
      each read naturally with their own word.
    -->
    <g v-else-if="name === 'reset' || name === 'undo'" fill="currentColor" stroke="none">
      <path
        d="M15 7H5.06l2.97-2.97l-1.06-1.06l-3.895 3.895a1.26 1.26 0 0 0 0 1.77L6.97 12.53l1.06-1.06L5.06 8.5H15c2.48 0 4.5 2.02 4.5 4.5s-2.02 4.5-4.5 4.5H7V19h8c3.31 0 6-2.69 6-6s-2.69-6-6-6"
      />
    </g>
    <path v-else-if="name === 'up'" d="m7 15 5-5 5 5" />
    <!-- Material Symbols' "usb-rounded" glyph (Google, Apache 2.0). -->
    <path
      v-else-if="name === 'usb'"
      fill="currentColor"
      stroke="none"
      d="M10.588 21.413Q10 20.825 10 20q0-.525.275-.975T11 18.3V16H8q-.825 0-1.412-.587T6 14v-2.3q-.45-.225-.725-.675T5 10q0-.825.588-1.413T7 8t1.413.588T9 10q0 .575-.275 1T8 11.7V14h3V6H9l3-4l3 4h-2v8h3v-2h-1V8h4v4h-1v2q0 .825-.587 1.413T16 16h-3v2.3q.475.25.738.7T14 20q0 .825-.587 1.413T12 22t-1.412-.587"
    />
    <!--
      Boxicons' "user" glyph (MIT licensed) — the header's account shortcut,
      a head-and-shoulders silhouette rather than the outline set's stroked
      figures, matching this file's other Boxicons imports (`edit`, `globe`).
    -->
    <path
      v-else-if="name === 'user'"
      fill="currentColor"
      stroke="none"
      d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5s-5 2.24-5 5s2.24 5 5 5m0-8c1.65 0 3 1.35 3 3s-1.35 3-3 3s-3-1.35-3-3s1.35-3 3-3M4 22h16c.55 0 1-.45 1-1v-1c0-3.86-3.14-7-7-7h-4c-3.86 0-7 3.14-7 7v1c0 .55.45 1 1 1m6-7h4c2.76 0 5 2.24 5 5H5c0-2.76 2.24-5 5-5"
    />
    <g v-else-if="name === 'skipForward'">
      <path d="m6 5 9 7-9 7Z" />
      <path d="M18 5v14" />
    </g>
    <!--
      Griddy Icons' "file-upload" glyph (MIT licensed), filled like `fileCode`
      above rather than the arrow-and-tray outline it replaces. The upward
      arrow used to carry `--accent-primary` as this icon's one accent — see
      button-system.md's "Accent-coloured icon details" — but that made it the
      one base icon that arrived already coloured everywhere it appeared.
      Base icons default to plain `currentColor`; retired along with `sunMoon`'s
      accent below.
    -->
    <g v-else-if="name === 'fileUpload'" fill="currentColor" stroke="none">
      <path
        fill-rule="evenodd"
        d="M4 2h9.56L20 8.44V22H4zm13.44 6L14 4.56V8zM5.5 3.5v17h13v-11h-4.75c-.69 0-1.25-.56-1.25-1.25V3.5z"
      />
      <path
        d="M8.22 14.22l2.895-2.895a1.26 1.26 0 0 1 1.77 0l2.895 2.895l-1.06 1.06l-1.97-1.97V18h-1.5v-4.69l-1.97 1.97z"
      />
    </g>
    <path v-else-if="name === 'moon'" d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z" />
    <!--
      Tabler's "sun-moon" glyph (MIT licensed) — new, not yet wired to any
      control. `moon` alone already means "macro standby" in
      MacrosSettingsPane, so this is kept as its own separate glyph rather
      than replacing `moon`. The diagonal splits the icon into a moon half
      (two crescent arcs) and a sun half (three ray ticks); the ticks used to
      carry `--accent-primary` as this icon's one accent — see
      button-system.md's "Accent-coloured icon details" — but base icons
      default to plain `currentColor`, so the split is retired.
    -->
    <g v-else-if="name === 'sunMoon'">
      <path d="M9.173 14.83a4 4 0 1 1 5.657-5.657" />
      <path d="m11.294 12.707.174.247a7.5 7.5 0 0 0 8.845 2.492A9 9 0 0 1 5.642 18.36" />
      <path d="M3 21 21 3" />
      <path d="M3 12h1" />
      <path d="M12 3v1" />
      <path d="M5.6 5.6l.7.7" />
    </g>
    <g v-else-if="name === 'snowflake'">
      <path d="M12 2v20M20.66 7 3.34 17M3.34 7l17.32 10" />
      <path
        d="M12 6.5 9.5 4.5M12 6.5l2.5-2M12 17.5 9.5 19.5M12 17.5l2.5 2M6.8 9.6 3.6 9.1M6.8 9.6 5.9 6.5M17.2 14.4l3.2.5M17.2 14.4l.9 3.1M6.8 14.4l-3.2.5M6.8 14.4l-.9 3.1M17.2 9.6l3.2-.5M17.2 9.6l.9-3.1"
      />
    </g>
    <!--
      A plain lightning bolt, stroked like every other icon in this set. It
      used to stand alone inside a prohibition sign — the ring said "cut", the
      bolt said what — but that reading only mattered while the control was
      icon-only. Now it sits beside the word "Off", so the label carries the
      meaning the ring used to, and the bolt only has to be recognisable as
      power. Same path the ring used to frame, without the ring or its
      `--accent-primary` fill: that colour deviation was recorded in
      `button-system.md` for the icon-only case this no longer is.
    -->
    <path v-else-if="name === 'bolt'" d="M13.8 4.6 8.2 12.6h3.2l-1.2 6.8 5.6-8h-3.2z" />
    <g v-else>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 3v18" />
      <path v-if="name === 'sidebarCollapse'" d="m15 9-3 3 3 3" />
      <path v-else d="m13 9 3 3-3 3" />
    </g>
  </svg>
</template>
