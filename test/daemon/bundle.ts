// Builds kurmis into a temporary folder the way `scripts/build.mjs` does, with a version of the
// test's choosing, so a test can run the daemon as its own process and fake an older or newer
// kurmis. `entry: 'real'` bundles `src/cli/main.ts`; `entry: 'fake'` bundles
// `fake-daemon-entry.ts`, whose `daemon run` uses the fake request handling in `fake-app.ts`.
//
// With `apiVersion` the bundle's `CONTROL_API_VERSION` is that number instead, so a test can fake
// two builds of one version that differ only in their control API version.
//
// Each bundle is built once per test file, version, entry and control API version. The folder is removed after the
// file's tests (the `afterAll` below), or earlier by `disposeTestBundles()`.
import { build, type Plugin } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

export type BundleEntry = 'fake' | 'real'

export interface TestBundleOptions {
  /** What `kurmisVersion` is in the bundle, e.g. `0.0.1`. */
  version: string
  entry: BundleEntry
  /** What `CONTROL_API_VERSION` is in the bundle; the source's own when absent. */
  apiVersion?: number
}

const CONTROL_API_FILE = /[\\/]src[\\/]core[\\/]control-api\.ts$/
const CONTROL_API_LINE = /^export const CONTROL_API_VERSION = \d+$/m

/** Replaces the number in `export const CONTROL_API_VERSION = <n>` while bundling. */
function controlApiVersionPlugin(apiVersion: number): Plugin {
  return {
    name: 'control-api-version',
    setup(bundler) {
      bundler.onLoad({ filter: CONTROL_API_FILE }, (args) => {
        const text = readFileSync(args.path, 'utf8')
        if (!CONTROL_API_LINE.test(text)) throw new Error(`${args.path} has no CONTROL_API_VERSION line to replace`)
        return { contents: text.replace(CONTROL_API_LINE, `export const CONTROL_API_VERSION = ${String(apiVersion)}`), loader: 'ts' }
      })
    }
  }
}

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

const ENTRY_FILES: Record<BundleEntry, string> = {
  real: join(repoRoot, 'src', 'cli', 'main.ts'),
  fake: join(repoRoot, 'test', 'daemon', 'fake-daemon-entry.ts')
}

let folder: string | null = null
let counter = 0
const builds = new Map<string, Promise<string>>()

/** Builds the bundle, or answers the one already built. Resolves with the `.cjs` file's path. */
export function buildTestBundle(options: TestBundleOptions): Promise<string> {
  const cacheKey = JSON.stringify([options.version, options.entry, options.apiVersion ?? null])
  const cached = builds.get(cacheKey)
  if (cached !== undefined) return cached
  folder ??= mkdtempSync(join(tmpdir(), 'kurmis-test-bundle-'))
  counter++
  const outfile = join(folder, `kurmis-${options.entry}-${String(counter)}.cjs`)
  const built = build({
    absWorkingDir: repoRoot,
    entryPoints: [ENTRY_FILES[options.entry]],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    banner: { js: '#!/usr/bin/env node' },
    define: { KURMIS_VERSION: JSON.stringify(options.version) },
    legalComments: 'none',
    logLevel: 'silent',
    plugins: options.apiVersion === undefined ? [] : [controlApiVersionPlugin(options.apiVersion)]
  }).then(() => outfile)
  // A failed build is not kept, so the next call tries again.
  built.catch(() => builds.delete(cacheKey))
  builds.set(cacheKey, built)
  return built
}

/** Removes every bundle built so far. */
export function disposeTestBundles(): void {
  builds.clear()
  if (folder !== null) rmSync(folder, { recursive: true, force: true, maxRetries: 10 })
  folder = null
}

afterAll(disposeTestBundles)
