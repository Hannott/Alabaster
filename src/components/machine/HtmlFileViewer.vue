<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ content: string; title: string }>()

const isLoading = ref(true)

watch(
  () => props.content,
  () => {
    isLoading.value = true
  },
)

function handleLoad(): void {
  isLoading.value = false
}
</script>

<template>
  <div class="machine-html-viewer" :data-pending="isLoading || undefined">
    <!--
      `srcdoc` rather than `src`: Moonraker's file-download endpoint answers
      every GET with `Content-Disposition: attachment`, which a browser
      treats as a save prompt on a frame *navigation* and leaves the frame
      blank — the same header `<img>` and `fetch` both ignore, since neither
      is a navigation. Handing the already-fetched text to `srcdoc` sidesteps
      the header entirely, the same way the code editor already reads this
      file with `fetch` rather than pointing at it directly. No error state
      to match ImageViewer's: a `srcdoc` iframe fires `load` once it has
      rendered whatever markup it was given, so there is no failed-request
      case left to catch here.
    -->
    <iframe
      class="machine-html-viewer__frame"
      :srcdoc="props.content"
      :title="props.title"
      sandbox="allow-scripts"
      @load="handleLoad"
    ></iframe>
  </div>
</template>
