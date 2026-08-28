<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import { isChangedRow, type PendingConfigSection } from '@/features/config/pendingConfig'

/*
 * A documented multi-choice dialog per docs/design/dialog-system.md: three
 * mutually exclusive outcomes — write the file, throw the staged values away, or
 * leave both alone — which is neither a binary confirmation nor a single value,
 * so it is hand-built markup on the shared `<dialog>` shell rather than a fourth
 * generic component. Listed in that document's outlier table.
 *
 * **Both write actions restart Klipper, and the labels say so.** `SAVE_CONFIG`
 * is not separable from its restart — Klipper's own help for it reads "Overwrite
 * config file and restart", and it requests that restart unconditionally — so
 * "save" and "save and restart" cannot be two different offers. Discarding is a
 * restart for a different reason: Klipper has no command that unstages a pending
 * block, so the only way to be rid of one is to re-read `printer.cfg` from disk,
 * which is what a firmware restart does. Neither label hides the cost.
 *
 * Presentational on purpose: it is handed the sections to show and reports which
 * button was pressed. The two stores it would otherwise read — what is staged,
 * and what is loaded — are paired by `features/config/pendingConfig.ts` outside
 * the component, so every rule about *reading* a staged section is testable
 * without mounting anything.
 */
const props = defineProps<{
  open: boolean
  sections: PendingConfigSection[]
  /** A write is in flight; both destructive actions wait for it. */
  busy?: boolean | undefined
  /**
   * Whichever restart happens ends a running print, so while one is running
   * neither write action is offered — and the dialog says why rather than
   * presenting two dead buttons.
   */
  isPrinting?: boolean | undefined
}>()

const emit = defineEmits<{ save: []; discard: []; close: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)

const canWrite = computed(() => !props.isPrinting && !props.busy)

/**
 * A one-line reading of each section, so the list is scannable closed. The
 * counts come from the rows rather than from a second source, which is what
 * keeps a summary from disagreeing with the block it summarizes once expanded.
 */
function summaryFor(section: PendingConfigSection): string {
  const counted = section.rows.find((row) => row.count !== undefined)
  if (section.kind === 'bedMesh') {
    return t('saveConfig.summary.bedMesh', { count: counted?.count ?? section.rows.length })
  }
  if (section.kind === 'probe') return t('saveConfig.summary.probe')
  if (section.kind === 'heaterModel') {
    return t('saveConfig.summary.heaterModel', { count: section.rows.length })
  }
  return t('saveConfig.summary.generic', { count: section.rows.length })
}

/** What a row's value reads as: the number, or how many numbers there are. */
function valueFor(row: PendingConfigSection['rows'][number]): string {
  if (row.next !== null) return row.next
  return t('saveConfig.valueCount', { count: row.count ?? 0 })
}

watch(
  () => props.open,
  (open) => {
    const element = dialog.value
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
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
    class="confirm-dialog save-config-dialog"
    aria-labelledby="save-config-title"
    aria-describedby="save-config-description"
    @cancel.prevent="emit('close')"
  >
    <h2 id="save-config-title" class="text-dialog-title">{{ t('saveConfig.title') }}</h2>
    <p id="save-config-description" class="mt-2 text-sm leading-6 text-muted">
      {{ t('saveConfig.description') }}
    </p>

    <!--
      Every staged section is listed, never totalled — the section is the unit
      being authorized, and `dialog-system.md` requires an authorized set to be
      shown rather than counted. What a section's own options do is one level
      down: a bed mesh stages 168 point measurements, so a value that is a list
      of numbers reports its size instead of printing them. The box scrolls at a
      capped height so a printer with several staged meshes can never push the
      actions off-screen.
    -->
    <div class="save-config-dialog__sections selectable">
      <details v-for="section in sections" :key="section.section" class="pending-section">
        <summary class="pending-section__head">
          <AppIcon name="right" class="size-3.5 pending-section__caret" aria-hidden="true" />
          <span class="pending-section__name">[{{ section.section }}]</span>
          <span class="pending-section__summary">{{ summaryFor(section) }}</span>
        </summary>
        <div class="pending-section__body">
          <div
            v-for="row in section.rows"
            :key="row.option"
            class="pending-row"
            :class="{ 'pending-row--unchanged': !isChangedRow(row) }"
          >
            <span class="pending-row__option">{{ row.option }}</span>
            <span class="pending-row__value">
              <!--
                The old value only where there is one to replace: an option the
                running config lacks has nothing to arrow from, and drawing an
                empty "before" would imply it did.
              -->
              <template v-if="row.previous !== null && isChangedRow(row)">
                <span class="pending-row__previous">{{ row.previous }}</span>
                <AppIcon name="right" class="size-3" aria-hidden="true" />
              </template>
              <span class="pending-row__next">{{ valueFor(row) }}</span>
            </span>
          </div>
        </div>
      </details>
    </div>

    <!--
      Why the write actions are unavailable, in words. A restart ends a running
      print, and two disabled buttons with no reason beside them read as a bug.
    -->
    <p v-if="isPrinting" class="save-config-dialog__blocked">
      <AppIcon name="warning" class="size-4" aria-hidden="true" />
      {{ t('saveConfig.whilePrinting') }}
    </p>

    <!--
      Stacked full-width actions, exactly one primary and one danger, and the
      dismissive action last and quietest — the multi-choice layout the dialog
      system specifies.
    -->
    <div class="save-config-dialog__actions">
      <AppButton
        variant="primary"
        block
        :pending="busy"
        icon="save"
        :label="t('saveConfig.save')"
        :disabled="!canWrite"
        @click="emit('save')"
      />
      <AppButton
        variant="danger"
        block
        icon="undo"
        :label="t('saveConfig.discard')"
        :disabled="!canWrite"
        @click="emit('discard')"
      />
      <AppButton variant="quiet" block :label="t('dashboard.cancel')" @click="emit('close')" />
    </div>
  </dialog>
</template>
