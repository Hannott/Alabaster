import eslint from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'website/.vitepress/cache/**',
      'website/.vitepress/dist/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    /*
     * `no-undef` cannot see an ambient type. `tseslint`'s own recommended set
     * already turns it off for `.ts` files — its guidance is that TypeScript
     * checks this better than the lint rule can — but its `files` list does not
     * include `.vue`, so a single-file component naming a DOM *interface*
     * (`RTCConfiguration`, `RTCIceServer`) was reported as using an undefined
     * variable while `vue-tsc` resolved it perfectly well. Extending the same
     * exemption to `.vue` keeps one answer for both halves of the codebase; the
     * types are still checked, by the typechecker `npm run check` runs first.
     */
    files: ['**/*.vue'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      'vue/attributes-order': 'error',
      'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
      'vue/multi-word-component-names': 'off',
    },
  },
)
