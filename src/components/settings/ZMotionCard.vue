<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/AppIcon.vue'
import { useZMotionStore, zMovingParts, zPlusDirections } from '@/stores/zMotion'

/**
 * Which part moves when Z changes, and which way Z+ moves it, for the active
 * printer — the two answers every Z control on the Movement card is drawn
 * from. Two questions rather than one, because the first does not settle the
 * second: most machines put Z 0 where the nozzle meets the bed, but some home
 * to the far end of travel, and a bed that Z+ raises reads the other way round
 * from one that Z+ lowers. Rendered only where there is a choice to make —
 * never on a delta, whose effector is the only thing that moves.
 */
const { t } = useI18n({ useScope: 'global' })
const zMotion = useZMotionStore()

const partIcons = { nozzle: 'zMovesNozzle', bed: 'zMovesBed' } as const
</script>

<template>
  <section class="page-card">
    <p class="text-eyebrow text-data-blue">{{ t('zMotion.eyebrow') }}</p>
    <h2 class="mt-2 text-section-title">{{ t('zMotion.title') }}</h2>
    <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">{{ t('zMotion.description') }}</p>

    <p class="mt-7 text-group-title">{{ t('zMotion.movingPartLabel') }}</p>
    <div class="z-motion-options mt-2">
      <label
        v-for="part in zMovingParts"
        :key="part"
        class="z-motion-option check-row check-row--block selection-row"
        :class="{ 'selection-row--selected': zMotion.movingPart === part }"
      >
        <input
          type="radio"
          name="z-moving-part"
          :checked="zMotion.movingPart === part"
          @change="zMotion.setMovingPart(part)"
        />
        <span>
          <span class="z-motion-option__name">{{ t(`zMotion.movingPart.${part}`) }}</span>
          <span class="z-motion-option__detail">{{ t(`zMotion.movingPartDetail.${part}`) }}</span>
        </span>
        <AppIcon :name="partIcons[part]" class="size-8 shrink-0 text-muted" aria-hidden="true" />
      </label>
    </div>

    <p class="mt-7 text-group-title">{{ t('zMotion.zPlusLabel') }}</p>
    <div class="z-motion-options mt-2">
      <label
        v-for="direction in zPlusDirections"
        :key="direction"
        class="z-motion-option check-row check-row--block selection-row"
        :class="{ 'selection-row--selected': zMotion.motion.zPlus === direction }"
      >
        <input
          type="radio"
          name="z-plus-direction"
          :checked="zMotion.motion.zPlus === direction"
          @change="zMotion.setZPlus(direction)"
        />
        <span>
          <span class="z-motion-option__name">
            {{ t(`zMotion.zPlus.${zMotion.movingPart}.${direction}`) }}
          </span>
          <span class="z-motion-option__detail">
            {{ t(`zMotion.zeroAt.${zMotion.movingPart}.${direction}`) }}
          </span>
        </span>
      </label>
    </div>
  </section>
</template>
