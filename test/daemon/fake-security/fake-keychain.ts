// Drives `security.mjs`, the stand-in for `/usr/bin/security`. A test makes a `FakeKeychain` in
// a temporary folder, sets `FAKE_SECURITY_DIR` to `keychain.dir` (with `vi.stubEnv`), and passes
// `FAKE_SECURITY` as the security program.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The stand-in's path, to pass where the real `/usr/bin/security` would go. */
export const FAKE_SECURITY = resolve('test/daemon/fake-security/security.mjs')

/** What the stand-in does instead of answering; see `security.mjs`. */
export type FakeSecurityMode = 'locked' | 'prompt' | 'oversize'

export class FakeKeychain {
  constructor(readonly dir: string) {
    mkdirSync(join(dir, 'items'), { recursive: true })
  }

  /** Puts an item with this service name and secret in the Keychain. */
  setItem(service: string, secret: string): void {
    writeFileSync(join(this.dir, 'items', encodeURIComponent(service)), secret)
  }

  removeItem(service: string): void {
    rmSync(join(this.dir, 'items', encodeURIComponent(service)), { force: true })
  }

  /** Makes every later call behave this way, or answer normally again with null. */
  setMode(mode: FakeSecurityMode | null): void {
    const file = join(this.dir, 'mode')
    if (mode === null) rmSync(file, { force: true })
    else writeFileSync(file, mode)
  }

  /** The arguments of every call so far, oldest first. */
  calls(): string[][] {
    const file = join(this.dir, 'calls.jsonl')
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8').trim().split('\n').filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as string[])
  }
}
