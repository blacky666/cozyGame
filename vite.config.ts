import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

export default defineConfig({
  base: '/cozyGame/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Build time (ISO, UTC) so players can see whether their tab runs the newest deploy.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    environment: 'node',
    // CI runners are several times slower than a desktop; keep headroom for simulation tests.
    testTimeout: 15000,
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
