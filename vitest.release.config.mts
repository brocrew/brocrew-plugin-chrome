import { defineConfig } from 'vitest/config'
import { THE_GUARD, theTestsEnv } from './scripts/lib/tests-run-in-a-fictional-home.mjs'
export default defineConfig({
  test: { environment: 'node', env: theTestsEnv(), setupFiles: [THE_GUARD],
    include: ['plugins/chrome/test/**/*.test.ts', 'release-test/*.test.ts', 'scripts/test/chrome-release-guards.test.mjs'],
    exclude: ['plugins/chrome/test/archive.test.ts'],
  },
})
