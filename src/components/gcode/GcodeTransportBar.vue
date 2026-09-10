<script setup lang="ts">
/**
 * One bar along the bottom of the stage for everything that moves through the
 * file, in whichever of three states applies.
 *
 * The old viewer had these on opposite sides of the page: a "follow live
 * toolhead" checkbox inside a sidebar card, a simulation transport in its own
 * row below the canvas, and a separate loading card floating over it. All
 * three answer the same question — where in this file are we — so they are one
 * control that changes what it is showing, and only one can apply at a time.
 *
 * The states, and why each looks the way it does:
 *
 * - **loading** — the file name, a determinate fill, a percentage and a
 *   cancel. It replaces the old floating loading card outright: progress
 *   belongs on the axis the file is being read along.
 * - **live** — a print of this exact file is running. The fill is the frontier
 *   in the printed colour, the scrubber is read-only, and the Follow toggle is
 *   the way out. Turning it off hands the bar to the scrubber without
 *   reloading anything.
 * - **idle** — the scrubber owns the file. Dragging it or pressing play is
 *   what enters simulation, which is why there is no separate "start
 *   simulation" button any more.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import HeaderMenu from '@/components/HeaderMenu.vue'

const props = defineProps<{
  state: 'loading' | 'live' | 'idle'
  /** Loading state: the name being read and how far, null while unknown. */
  loadingName?: string | undefined
  loadingPercent?: number | null | undefined
  /** Live state. */
  following?: boolean | undefined
  followAvailable?: boolean | undefined
  followUnavailableReason?: string | undefined
  liveProgress?: number | undefined
  /** Idle state: a segment cursor over the file's total moves. */
  cursor?: number | undefined
  totalMoves?: number | undefined
  playing?: boolean | undefined
  speed?: number | undefined
  speeds?: readonly number[] | undefined
}>()

const emit = defineEmits<{
  cancel: []
  'update:following': [boolean]
  seek: [number]
  play: []
  pause: []
  restart: []
  finish: []
  'update:speed': [number]
}>()

const { t, n } = useI18n({ useScope: 'global' })

const total = computed(() => Math.max(1, props.totalMoves ?? 1))
const fillPercent = computed(() => {
  if (props.state === 'loading') return props.loadingPercent ?? 0
  if (props.state === 'live') return (props.liveProgress ?? 0) * 100
  return ((props.cursor ?? 0) / total.value) * 100
})
const reading = computed(() => {
  if (props.state === 'loading') {
    return props.loadingPercent === null || props.loadingPercent === undefined
      ? (props.loadingName ?? '')
      : t('gcodeViewer.transport.loadingReading', {
          name: props.loadingName ?? '',
          percent: n(props.loadingPercent),
        })
  }
  if (props.state === 'live') {
    return t('gcodeViewer.transport.liveReading', {
      percent: n(Math.round((props.liveProgress ?? 0) * 100)),
    })
  }
  return t('gcodeViewer.transport.moveReading', {
    current: n(props.cursor ?? 0),
    total: n(props.totalMoves ?? 0),
  })
})

/** One call, because an inline handler may not be two statements. */
function pickSpeed(option: number, close: () => void): void {
  close()
  emit('update:speed', option)
}

function onSeek(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  emit('seek', target.valueAsNumber)
}
</script>

<template>
  <div class="gcode-transport" :data-state="props.state">
    <AppButton
      v-if="props.state === 'loading'"
      class="gcode-transport__action"
      variant="quiet"
      size="xs"
      icon-only
      on-strong
      icon="close"
      :aria-label="t('gcodeViewer.transport.cancel')"
      @click="emit('cancel')"
    />

    <AppButton
      v-if="props.state === 'live' || props.followAvailable"
      class="gcode-transport__follow"
      :variant="props.following ? 'primary' : 'quiet'"
      size="xs"
      on-strong
      :disabled="!props.followAvailable"
      :title="props.followUnavailableReason"
      icon="print"
      :label="t('gcodeViewer.transport.follow')"
      :aria-pressed="props.following ? 'true' : 'false'"
      @click="emit('update:following', !props.following)"
    />

    <div class="gcode-transport__track">
      <div class="gcode-transport__fill" :style="{ width: `${fillPercent}%` }"></div>
      <input
        v-if="props.state !== 'loading'"
        class="gcode-transport__input"
        type="range"
        min="0"
        :max="props.totalMoves ?? 0"
        step="1"
        :value="props.cursor ?? 0"
        :disabled="props.state === 'live'"
        :aria-label="t('gcodeViewer.transport.position')"
        :aria-valuetext="reading"
        @input="onSeek"
      />
    </div>

    <p class="gcode-transport__reading">{{ reading }}</p>

    <template v-if="props.state === 'idle'">
      <AppButton
        class="gcode-transport__action"
        variant="quiet"
        size="xs"
        icon-only
        on-strong
        icon="refresh"
        :aria-label="t('gcodeViewer.transport.restart')"
        @click="emit('restart')"
      />
      <AppButton
        class="gcode-transport__action"
        variant="primary"
        size="xs"
        icon-only
        on-strong
        :aria-label="
          props.playing ? t('gcodeViewer.transport.pause') : t('gcodeViewer.transport.play')
        "
        :icon="props.playing ? 'pause' : 'play'"
        @click="props.playing ? emit('pause') : emit('play')"
      />
      <AppButton
        class="gcode-transport__action"
        variant="quiet"
        size="xs"
        icon-only
        on-strong
        icon="skipForward"
        :aria-label="t('gcodeViewer.transport.finish')"
        @click="emit('finish')"
      />
      <HeaderMenu
        :label="t('gcodeViewer.transport.speed')"
        align="end"
        placement="above"
        panel-class="gcode-popover gcode-popover--narrow"
        trigger-variant="quiet"
        trigger-size="xs"
        trigger-class="gcode-transport__action"
        trigger-on-strong
      >
        <template #trigger>
          {{ t('gcodeViewer.transport.speedValue', { speed: n(props.speed ?? 1) }) }}
        </template>
        <template #default="{ close }">
          <AppButton
            v-for="option in props.speeds ?? []"
            :key="option"
            variant="quiet"
            size="sm"
            block
            :aria-pressed="option === props.speed ? 'true' : 'false'"
            @click="pickSpeed(option, close)"
          >
            {{ t('gcodeViewer.transport.speedValue', { speed: n(option) }) }}
          </AppButton>
        </template>
      </HeaderMenu>
    </template>
  </div>
</template>
