import { defineConfig } from 'vitest/config'

// Pure unit tests (the realization router). Node env, no DOM, and intentionally
// NOT the app's vite.config.ts — the Deno edge files under test import only
// type-only symbols from sibling .ts files, so esbuild strips those imports and
// the files transpile here without resolving any Deno/npm specifiers.
export default defineConfig({
  test: {
    include: ['supabase/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
