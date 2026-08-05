import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  plugins: [vue(), tailwindcss()],
  server: {
    watch: {
      usePolling: process.env.VITE_USE_POLLING === 'true',
      interval: 250,
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    /*
     * A git worktree checked out inside the repository is a second copy of
     * every spec file, and collecting it is always wrong: the copies run
     * against *this* config, so `@` resolves to this tree's `src` while the
     * spec came from another commit. The result is a run reporting hundreds of
     * failures that belong to neither tree. Agent worktrees live under
     * `.claude/worktrees`, so `npm run check` has to skip them to mean
     * anything while one exists.
     */
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
  },
})
