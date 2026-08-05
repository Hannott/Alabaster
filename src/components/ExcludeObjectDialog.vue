<!--
  Opened from Print when a job defines objects Klipper can individually cancel
  (`[exclude_object]`). The scatter is a supplementary picture — aria-hidden,
  because every object it draws is also a row below with its own button — so
  "where on the bed is the one that just failed" is answerable without the
  list being anything other than an ordinary, fully keyboard-reachable list.

  Not a ConfirmDialog or PromptDialog: browsing which object to act on is not
  itself the yes/no decision. The decision — "exclude this one, and it will
  not print" — is its own ConfirmDialog, opened per row, per
  docs/design/dialog-system.md's binary-confirmation shape.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { bedExtents, planPoint, type BedExtents } from '@/dashboard/bedPlan'
import type { ExcludeObjectDefinition } from '@/stores/excludeObject'
import { useExcludeObjectStore } from '@/stores/excludeObject'
import { useActionGuard } from '@/composables/useActionGuard'
import { usePrinterStore } from '@/stores/printer'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n({ useScope: 'global' })
const printer = usePrinterStore()
const excludeObject = useExcludeObjectStore()

const dialog = ref<HTMLDialogElement | null>(null)
const pendingName = ref<string | null>(null)

const objects = computed(() => excludeObject.objects)
const excludedSet = computed(() => excludeObject.excludedSet)
const currentObjectName = computed(() => excludeObject.currentObjectName)

/** Null until the printer has reported a build volume — see `bedPlan.ts`. */
const extents = computed<BedExtents | null>(() =>
  bedExtents(printer.buildVolume.minimum, printer.buildVolume.maximum),
)

function markerState(object: ExcludeObjectDefinition): 'excluded' | 'current' | 'pending' {
  if (excludedSet.value.has(object.name)) return 'excluded'
  if (object.name === currentObjectName.value) return 'current'
  return 'pending'
}

/** A dot's position on the scatter, as a percentage from the top-left. */
function markerPosition(object: ExcludeObjectDefinition): { left: string; top: string } | null {
  const plotExtents = extents.value
  if (!plotExtents || !object.center) return null
  const point = planPoint({ x: object.center[0], y: object.center[1] }, plotExtents)
  return { left: `${point.x * 100}%`, top: `${point.y * 100}%` }
}

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
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog ref="dialog" class="exclude-object-dialog" @cancel.prevent="emit('close')">
    <header>
      <h2>{{ t('excludeObject.title') }}</h2>
      <button
        type="button"
        class="button button--icon"
        :aria-label="t('excludeObject.close')"
        @click="emit('close')"
      >
        <AppIcon name="close" class="size-5" aria-hidden="true" />
      </button>
    </header>
    <p class="exclude-object-description">{{ t('excludeObject.description') }}</p>

    <div v-if="extents" class="exclude-object-plate" aria-hidden="true">
      <span
        v-for="object in objects"
        :key="object.name"
        class="exclude-object-dot"
        :class="`exclude-object-dot--${markerState(object)}`"
        :style="markerPosition(object) ?? undefined"
      ></span>
    </div>

    <ul class="exclude-object-list">
      <li
        v-for="object in objects"
        :key="object.name"
        class="exclude-object-row"
        :data-state="markerState(object)"
      >
        <span class="min-w-0 flex-1">
          <span class="block truncate text-row-name" :title="object.name">{{ object.name }}</span>
          <span v-if="markerState(object) === 'current'" class="exclude-object-row__badge">
            {{ t('excludeObject.printingNow') }}
          </span>
        </span>
        <button
          type="button"
          class="button button--sm"
          :class="excludeGuard.variant.value"
          v-bind="excludeGuard.bind.value"
          :disabled="markerState(object) === 'excluded' || printer.pendingCommands.excludeObject"
          @click="requestExclude(object.name)"
        >
          <AppIcon
            :name="markerState(object) === 'excluded' ? 'stop' : 'close'"
            class="size-4"
            aria-hidden="true"
          />
          {{
            markerState(object) === 'excluded'
              ? t('excludeObject.excluded')
              : t('excludeObject.exclude')
          }}
        </button>
      </li>
    </ul>
    <p v-if="objects.length === 0" class="exclude-object-empty">
      {{ t('excludeObject.empty') }}
    </p>
  </dialog>

  <ConfirmDialog
    :open="pendingName !== null"
    :title="t('excludeObject.confirmTitle')"
    :description="t('excludeObject.confirmDescription', { name: pendingName ?? '' })"
    :confirm-label="t('excludeObject.exclude')"
    tone="danger"
    @confirm="confirmExclude"
    @cancel="pendingName = null"
  />
</template>
