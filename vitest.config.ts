import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/test/**/*.test.tsx',
      'ui/src/test/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
  },
})
