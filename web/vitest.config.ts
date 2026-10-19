import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vite derives `isProduction` from `process.env.NODE_ENV` *while resolving this config* (it reads
// the variable only after the config file has been loaded) and hangs a production build off it:
// the `development`/`production` export conditions, the externalization of `node:` builtins for
// the jsdom environment, and `import.meta.env.DEV`/`PROD` (which `simSeatsEnabled()` and the dev-only
// screens read). An inherited `NODE_ENV=production` — this box's shells export it — therefore turns
// the suite into a production build: every test file importing `node:fs`/`node:path`/`node:url` dies
// at collection ("No such built-in module: node:", reported as 0 tests, so a real regression hides
// behind the wall) and React resolves to its production CJS build, where `React.act` does not exist.
// Vitest only defaults the variable when it is unset (`process.env.NODE_ENV ??= 'test'`), so the
// suite's green baseline *is* test mode; pin exactly that here rather than leave it to the caller.
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test'

export default defineConfig({
  plugins: [react()],
  define: { __DEMO__: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'fixtures/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      // The gate only means something if the set is real. It used to list
      // `src/board/gameToScene.ts` and `src/board/zones.ts`, neither of which exists, and left
      // the 8 000-line `src/board/` and the whole state layer out: 721 instrumented lines out of
      // ~80 000, reported as "87% lines" on the dashboard. The scope is now the directories that
      // hold the protocol and the state machine, which is what a regression in a callback or in
      // a store action would show up in, plus the deck builder/storage, the lobby and the game
      // screen logic, where most of the client-side behaviour lives.
      include: [
        'src/net/**/*.ts',
        'src/state/**/*.ts',
        'src/board/**/*.ts',
        'src/board/**/*.tsx',
        'src/cards/cardImages.ts',
        'src/decks/**/*.ts',
        'src/decks/**/*.tsx',
        'src/lobby/**/*.ts',
        'src/lobby/**/*.tsx',
        'src/game/**/*.ts',
        'src/game/**/*.tsx',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/__fixtures__/**',
        'src/game/feedback/*.test.ts',
        'src/state/*.test.ts',
        'src/net/*.test.ts',
        'src/board/*.test.ts',
        'src/board/*.test.tsx',
        'src/dev/**',
        'src/i18n/locales/**',
      ],
      // A few points under the measured totals (79 / 72 / 68 / 76 when the scope was widened),
      // so a real regression fails the gate instead of hiding in a 20-point margin.
      thresholds: {
        lines: 75,
        functions: 68,
        branches: 64,
        statements: 72,
      },
    },
  },
})
