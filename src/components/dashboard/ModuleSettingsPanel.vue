<script setup lang="ts">
import DisclosureReveal from '@/components/DisclosureReveal.vue'
import ModuleSettingsLink from '@/components/dashboard/ModuleSettingsLink.vue'

/**
 * A card's disclosure layer: its heading, the module's own rows, and the link
 * out to the settings surface, in that order for every module. A module
 * supplies its rows and nothing else, so the layer opens the same way, is laid
 * out the same way, and leads to the same place from all eleven of them — and
 * changing any of that is one edit rather than eleven.
 *
 * Attributes land on the panel rather than on the reveal around it. A module
 * whose card body has no padding of its own passes that inset here, and inside
 * the clip it collapses with the panel instead of popping.
 */
defineOptions({ inheritAttrs: false })

defineProps<{
  open: boolean
  /** Omitted where the content already names itself. */
  title?: string
}>()
</script>

<template>
  <DisclosureReveal :open="open">
    <div class="module-settings" v-bind="$attrs">
      <p v-if="title" class="text-xs font-black">{{ title }}</p>
      <slot></slot>
      <ModuleSettingsLink />
    </div>
  </DisclosureReveal>
</template>
