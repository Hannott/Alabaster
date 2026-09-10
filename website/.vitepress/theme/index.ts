import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import CreatorNote from './CreatorNote.vue'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-hero-after': () => h(CreatorNote),
    }),
}
