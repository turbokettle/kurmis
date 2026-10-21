// Bundles the CLI and everything it imports into one CommonJS file, so the installed package
// needs no runtime dependencies and no build step.
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

await build({
  entryPoints: ['src/cli/main.ts'],
  outfile: 'dist/kurmis.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  define: { KURMIS_VERSION: JSON.stringify(version) },
  legalComments: 'none',
  logLevel: 'warning'
})
