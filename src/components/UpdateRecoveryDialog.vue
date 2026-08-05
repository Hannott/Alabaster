<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import UpdateCommitList from '@/components/UpdateCommitList.vue'
import type { MachineUpdateItem } from '@/stores/machineSystem'

/*
 * A documented multi-choice dialog per docs/design/dialog-system.md: three
 * mutually exclusive outcomes — inspect, reset, dismiss — which is neither a
 * binary confirmation nor a single value, so it is hand-built markup on the shared
 * `<dialog>` shell rather than a fourth generic component.
 */
const props = defineProps<{
  update: MachineUpdateItem | null
  busy?: boolean | undefined
}>()

const emit = defineEmits<{ reset: [id: string]; close: [] }>()

const { t } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)
const isShowingDifferences = ref(false)

const isOpen = computed(() => props.update !== null)
const name = computed(() => props.update?.displayName ?? '')

/**
 * `git reset` cannot repair a corrupt repository, so Moonraker re-clones that one
 * instead. The button says which will happen rather than leaving the user to guess.
 */
const isReclone = computed(() => props.update?.corrupt === true)

/** Every reported reason the source needs attention, most severe first. */
const reasons = computed(() => {
  const update = props.update
  if (!update) return []
  const reported: string[] = []
  if (update.corrupt) reported.push(t('machine.recovery.reasonCorrupt'))
  if (update.is_valid === false) reported.push(t('machine.recovery.reasonInvalid'))
  if (update.is_dirty) reported.push(t('machine.recovery.reasonDirty'))
  if (update.detached) reported.push(t('machine.recovery.reasonDetached'))
  return reported
})

const localBranch = computed(() => props.update?.branch || t('machine.recovery.unknownBranch'))
const remoteBranch = computed(() => {
  const update = props.update
  if (!update?.branch) return t('machine.recovery.unknownBranch')
  return update.remote_alias ? `${update.remote_alias}/${update.branch}` : update.branch
})

const commitsBehind = computed(() => props.update?.commits_behind ?? [])

/*
 * Moonraker exposes no file-level diff over its API. What it does report is the
 * upstream commits this repository has not applied, plus the git output and
 * conditions behind the attention state — so that is what "differences" shows,
 * and the dialog says so rather than implying a `git diff`.
 */
const gitMessages = computed(() => props.update?.git_messages ?? [])
const warnings = computed(() => props.update?.warnings ?? [])
const anomalies = computed(() => props.update?.anomalies ?? [])
const hasReportedDetail = computed(
  () => gitMessages.value.length + warnings.value.length + anomalies.value.length > 0,
)

watch(
  () => props.update,
  (update) => {
    // Every open starts on the summary; a stale differences view would otherwise
    // describe the previous source.
    if (update) isShowingDifferences.value = false
  },
)

watch(
  isOpen,
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
    class="confirm-dialog update-recovery-dialog"
    aria-labelledby="update-recovery-title"
    aria-describedby="update-recovery-description"
    @cancel.prevent="emit('close')"
  >
    <h2 id="update-recovery-title" class="text-dialog-title">
      {{ t('machine.recovery.title', { name }) }}
    </h2>
    <p id="update-recovery-description" class="mt-2 text-sm leading-6 text-muted">
      {{ t('machine.recovery.description') }}
    </p>

    <ul v-if="reasons.length" class="update-recovery-reasons">
      <li v-for="reason in reasons" :key="reason">
        <AppIcon name="warning" class="size-4" aria-hidden="true" />
        <span>{{ reason }}</span>
      </li>
    </ul>

    <template v-if="isShowingDifferences">
      <p class="update-recovery-section-note">
        {{
          t('machine.recovery.branchSummary', {
            local: localBranch,
            remote: remoteBranch,
            count: commitsBehind.length,
          })
        }}
      </p>

      <UpdateCommitList v-if="commitsBehind.length" :commits="commitsBehind" />

      <template v-if="hasReportedDetail">
        <p class="update-recovery-section-note">{{ t('machine.recovery.reportedTitle') }}</p>
        <ul class="update-recovery-messages selectable">
          <li v-for="message in warnings" :key="`warning-${message}`">{{ message }}</li>
          <li v-for="message in anomalies" :key="`anomaly-${message}`">{{ message }}</li>
          <li v-for="message in gitMessages" :key="`git-${message}`">{{ message }}</li>
        </ul>
      </template>

      <p v-if="!commitsBehind.length && !hasReportedDetail" class="update-recovery-section-note">
        {{ t('machine.recovery.noDetail') }}
      </p>
    </template>

    <!--
      Stacked full-width actions, at most one danger, and the dismissive action
      last and quietest — the multi-choice layout the dialog system specifies.
    -->
    <div class="update-recovery-dialog__actions">
      <button
        v-if="!isShowingDifferences"
        type="button"
        class="button button--block"
        @click="isShowingDifferences = true"
      >
        <AppIcon name="fileSearch" class="size-5" aria-hidden="true" />
        {{ t('machine.recovery.viewDifferences') }}
      </button>
      <button
        v-else
        type="button"
        class="button button--block"
        @click="isShowingDifferences = false"
      >
        <AppIcon name="back" class="size-5" aria-hidden="true" />
        {{ t('machine.recovery.back') }}
      </button>
      <button
        type="button"
        class="button button--danger button--block"
        :disabled="busy || !update"
        :data-pending="busy ? 'true' : undefined"
        @click="update && emit('reset', update.id)"
      >
        <AppIcon name="undo" class="size-5" aria-hidden="true" />
        {{ isReclone ? t('machine.recovery.reclone') : t('machine.recovery.resetBranch') }}
      </button>
      <button type="button" class="button button--quiet button--block" @click="emit('close')">
        {{ t('dashboard.cancel') }}
      </button>
    </div>
  </dialog>
</template>
