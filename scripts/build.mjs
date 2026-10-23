// Bundles the CLI and everything it imports into one CommonJS file, so the installed package
// needs no runtime dependencies and no build step.
import { build } from 'esbuild'
import { chmodSync, readFileSync } from 'node:fs'

const { version: packageVersion } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
// The build time in UTC (`0.1.0+20261023120000`). A daemon of an earlier build counts as older,
// so an update replaces the running daemon although the version number in package.json is the same.
const version = `${packageVersion}+${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`

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

// Executable, so a clone can run it directly. npm also marks a bin executable when it links it.
chmodSync('dist/kurmis.cjs', 0o755)
