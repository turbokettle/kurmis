// Helpers the daemon lifecycle tests share: a free port, a data folder with a config.json
// naming it, an output collector and a wait.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_VERSION } from '../../src/data/config.ts'

/** A port nothing listens on now: one the OS hands out for port 0, closed again. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/**
 * A new data folder with a `config.json` that sets `port`. It is inside the test file's
 * temporary HOME (`test/setup.ts`), which is removed after the file's tests.
 */
export function dataFolderWithPort(port: number): string {
  const home = mkdtempSync(join(process.env.HOME ?? tmpdir(), 'kurmis-home-'))
  writeFileSync(join(home, 'config.json'), JSON.stringify({ version: CONFIG_VERSION, port }))
  return home
}

export interface Collector {
  write(text: string): boolean
  text(): string
}

export function collector(): Collector {
  let text = ''
  return {
    write(chunk: string) {
      text += chunk
      return true
    },
    text: () => text
  }
}

/** Polls `check` every 20 ms until it answers true; fails after `ms`. */
export async function waitUntil(check: () => boolean | Promise<boolean>, ms = 5_000, what = 'the condition'): Promise<void> {
  const deadline = Date.now() + ms
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error(`waited ${String(ms)} ms for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
