import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests resolve sibling packages from source, so `npm test` needs no build
// and a change in one package is seen by another's tests at once.
const packagesDir = resolve(import.meta.dirname, 'packages');
const alias = Object.fromEntries(
  readdirSync(packagesDir).map(name => [`@aaronsb/mcp-component-${name}`, resolve(packagesDir, name, 'src', 'index.ts')]),
);

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
  },
});
