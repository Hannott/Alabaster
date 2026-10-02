<!--
  Opened from Print when a job defines objects Klipper can individually cancel
  (`[exclude_object]`). The map answers "where on the bed is the one that just
  failed"; the list beside it stays an ordinary, fully keyboard-reachable list,
  and the two pick out the same object from either side.

  Not a ConfirmDialog or PromptDialog: browsing which object to act on is not
  itself the yes/no decision. The decision — "exclude this one, and it will
  not print" — is its own ConfirmDialog, opened per row, per
  docs/design/dialog-system.md's binary-confirmation shape.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ExcludeObjectMap, { type ExcludeObjectState } from '@/components/ExcludeObjectMap.vue'
import { bedExtents, type BedExtents } from '@/dashboard/bedPlan'
import type { ExcludeObjectDefinition } from '@/stores/excludeObject'
import { useExcludeObjectStore } from '@/stores/excludeObject'
import { useActionGuard } from '@/composables/useActionGuard'
import { useConfirmationsStore } from '@/stores/confirmations'
import { usePrinterConfigStore } from '@/stores/printerConfig'
import { usePrinterStore } from '@/stores/printer'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const printerConfig = usePrinterConfigStore()
const excludeObject = useExcludeObjectStore()
const confirmations = useConfirmationsStore()

const dialog = ref<HTMLDialogElement | null>(null)
const pendingName = ref<string | null>(null)
const selectedName = ref<string | null>(null)
const hoveredName = ref<string | null>(null)
const rowElements = new Map<string, HTMLElement>()

const objects = computed(() => excludeObject.objects)
const excludedSet = computed(() => excludeObject.excludedSet)
const currentObjectName = computed(() => excludeObject.currentObjectName)

/** Null until the printer has reported a build volume — see `bedPlan.ts`. */
const extents = computed<BedExtents | null>(() =>
  bedExtents(printer.buildVolume.minimum, printer.buildVolume.maximum, printerConfig.bedShape),
)

const hasMap = computed(
  () =>
    extents.value !== null &&
    objects.value.some((object) => object.polygon !== null || object.center !== null),
)

/*
 * `gcode_position`, not the live position: the outlines are in the file's own
 * frame, and the live position carries the bed mesh and G-code offsets on top.
 * Unhomed, Klipper still reports a position, but not one the machine knows.
 */
const nozzle = computed(() => {
  const homed = printer.motion.homedAxes.toUpperCase()
  if (!homed.includes('X') || !homed.includes('Y')) return null
  const [x, y] = printer.motion.position
  if (typeof x !== 'number' || typeof y !== 'number') return null
  return { x, y }
})

function markerState(object: ExcludeObjectDefinition): ExcludeObjectState {
  if (excludedSet.value.has(object.name)) return 'excluded'
  if (object.name === currentObjectName.value) return 'current'
  return 'pending'
}

const highlightedName = computed(() => hoveredName.value ?? selectedName.value)

/** The object the caption under the map names: the one picked out, else the one printing. */
const captionObject = computed(() => {
  const name = highlightedName.value ?? currentObjectName.value
  return objects.value.find((object) => object.name === name) ?? null
})

const captionState = computed(() => {
  const object = captionObject.value
  if (!object) return null
  const state = markerState(object)
  if (state === 'excluded') return t('excludeObject.excluded')
  if (state === 'current') return t('excludeObject.printingNow')
  return null
})

function rememberRow(name: string, element: Element | ComponentPublicInstance | null): void {
  if (element instanceof HTMLElement) rowElements.set(name, element)
  else rowElements.delete(name)
}

function selectFromMap(name: string): void {
  selectedName.value = name
  void nextTick(() => rowElements.get(name)?.scrollIntoView?.({ block: 'nearest' }))
}

watch(objects, (next) => {
  const names = new Set(next.map((object) => object.name))
  if (selectedName.value && !names.has(selectedName.value)) selectedName.value = null
  if (hoveredName.value && !names.has(hoveredName.value)) hoveredName.value = null
})

/*
 * Terminal, and unconditionally so: excluding an object is one of the few
 * commands Klipper offers no inverse for, and the part it abandons is abandoned
 * for the rest of the job. It is only reachable while a print is running, so
 * there is no idle state for the tier to resolve to.
 *
 * This dialog had no skip setting at all -- it was one of four confirmations in
 * the app that could not be turned off, which the dialog-system contract says
 * every binary confirm must be. A guard the user cannot remove is a guard the
 * user learns to click through.
 */
const excludeGuard = useActionGuard({
  tier: 'terminal',
  emphasis: 'danger-quiet',
  key: 'excludeObject',
})

function requestExclude(name: string): void {
  if (excludedSet.value.has(name)) return
  excludeGuard.request(
    () => void printer.excludeObject(name),
    () => (pendingName.value = name),
  )
}

async function confirmExclude(): Promise<void> {
  const name = pendingName.value
  pendingName.value = null
  if (name) await printer.excludeObject(name)
}

watch(
  () => props.open,
  (isOpen) => {
    const element = dialog.value
    if (!element) return
    if (isOpen && !element.open) element.showModal()
    if (!isOpen && element.open) element.close()
    if (!isOpen) {
      selectedName.value = null
      hoveredName.value = null
    }
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="exclude-object-dialog"
    :class="{ 'exclude-object-dialog--map': hasMap }"
    aria-labelledby="exclude-object-title"
    @cancel.prevent="emit('close')"
  >
    <header>
      <h2 id="exclude-object-title">{{ t('excludeObject.title') }}</h2>
      <AppButton
        icon-only
        icon="close"
        :aria-label="t('excludeObject.close')"
        :title="t('excludeObject.close')"
        @click="emit('close')"
      />
    </header>

    <div class="exclude-object-body">
      <div v-if="hasMap && extents" class="exclude-object-plate">
        <ExcludeObjectMap
          :extents="extents"
          :objects="objects"
          :state-of="markerState"
          :highlighted="highlightedName"
          :nozzle="nozzle"
          @select="selectFromMap"
          @hover="hoveredName = $event"
        />
        <p class="exclude-object-caption" aria-hidden="true">
          <template v-if="captionObject">
            <span class="exclude-object-caption__name">{{ captionObject.name }}</span>
            <span v-if="captionState" class="exclude-object-caption__state">{{
              captionState
            }}</span>
          </template>
        </p>
      </div>

      <ul v-if="objects.length > 0" class="exclude-object-list">
        <li
          v-for="object in objects"
          :key="object.name"
          :ref="(element) => rememberRow(object.name, element)"
          class="exclude-object-row selection-row"
          :class="{ 'selection-row--selected': object.name === selectedName }"
          :aria-current="object.name === selectedName ? 'true' : undefined"
          :data-state="markerState(object)"
          :data-hovered="object.name === hoveredName ? '' : undefined"
          @pointerenter="hoveredName = object.name"
          @pointerleave="hoveredName = null"
          @focusin="hoveredName = object.name"
          @focusout="hoveredName = null"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-row-name" :title="object.name">{{ object.name }}</span>
            <span v-if="markerState(object) === 'current'" class="exclude-object-row__badge">
              {{ t('excludeObject.printingNow') }}
            </span>
          </span>
          <AppButton
            size="sm"
            :guard="excludeGuard"
            :icon="markerState(object) === 'excluded' ? 'stop' : 'close'"
            :label="
              markerState(object) === 'excluded'
                ? t('excludeObject.excluded')
                : t('excludeObject.exclude')
            "
            :disabled="markerState(object) === 'excluded' || printer.pendingCommands.excludeObject"
            @click="requestExclude(object.name)"
          />
        </li>
      </ul>
      <p v-else class="exclude-object-empty">
        {{ t('excludeObject.empty') }}
      </p>
    </div>
  </dialog>

  <ConfirmDialog
    :open="pendingName !== null"
    :title="t('excludeObject.confirmTitle')"
    :description="t('excludeObject.confirmDescription', { name: pendingName ?? '' })"
    :confirm-label="t('excludeObject.exclude')"
    tone="danger"
    show-skip-option
    @confirm="confirmExclude"
    @cancel="pendingName = null"
    @skip="confirmations.setSkip('excludeObject', true)"
  />
</template>
