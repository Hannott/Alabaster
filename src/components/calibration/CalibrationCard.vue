<script setup lang="ts">
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'

import AppSelect from '@/components/AppSelect.vue'
import { procedurePickerKey } from '@/components/calibration/procedurePicker'
import type { ProcedureId } from '@/features/calibration/procedures'

/**
 * The one card every Calibration surface is: a header strip naming what the
 * card is, and a body under it. The procedure list was the first card drawn
 * this way — a flush card, a soft strip, then its rows — and the workspace, the
 * panels and the hosted dashboard modules each drew their own padded
 * `page-card` with a large title inside it, so the four columns of one stage
 * read as four different kinds of object. Sharing the shell is what keeps a
 * fifth card from inventing a fifth header.
 *
 * `flush` is for a body that is its own rows and wants them edge to edge, as the
 * procedure list does; any other body gets the padded, gapped one.
 */
const props = defineProps<{
  title: string
  /** A sentence under the strip, the first thing in the body. */
  hint?: string | undefined
  flush?: boolean | undefined
  /**
   * The open procedure's card. Below the bench's middle width the procedure
   * list is hidden and this title becomes the stage's picker, rather than a
   * card of its own holding nothing but a select above it.
   */
  workspace?: boolean | undefined
}>()

defineSlots<{
  default(): unknown
  /** What the header carries at its end: a count, a command name, a refresh. */
  aside?(): unknown
}>()

const { t } = useI18n({ useScope: 'global' })
const picker = props.workspace ? inject(procedurePickerKey, null) : null
</script>

<template>
  <section class="page-card calibration-card" :aria-label="title">
    <header class="calibration-card__header">
      <h2 class="calibration-card__title">{{ title }}</h2>
      <div v-if="picker" class="calibration-card__picker">
        <AppSelect
          :model-value="picker.selected.value ?? ''"
          :options="picker.options.value"
          :label="t('calibration.bench.procedures')"
          @update:model-value="(value) => picker!.select(value as ProcedureId)"
        />
      </div>
      <div v-if="$slots.aside" class="calibration-card__aside">
        <slot name="aside"></slot>
      </div>
    </header>
    <div class="calibration-card__body" :class="{ 'calibration-card__body--flush': flush }">
      <p v-if="hint" class="calibration-panel__hint">{{ hint }}</p>
      <slot></slot>
    </div>
  </section>
</template>
