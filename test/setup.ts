// Every test file runs with HOME and KURMIS_HOME pointing at a fresh temporary folder, so no
// test can read or write the real ~/.claude, ~/.codex or ~/.kurmis by accident.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'kurmis-test-home-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.KURMIS_HOME = join(home, '.kurmis')
delete process.env.CODEX_HOME
delete process.env.CLAUDE_CONFIG_DIR
delete process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
delete process.env.ANTHROPIC_BASE_URL
delete process.env.ANTHROPIC_API_KEY
delete process.env.ANTHROPIC_AUTH_TOKEN
delete process.env.ANTHROPIC_CUSTOM_HEADERS
delete process.env.KURMIS_CLAUDE_BIN
delete process.env.KURMIS_CODEX_BIN
delete process.env.KURMIS_UPSTREAM_URL
delete process.env.SSH_CONNECTION
delete process.env.SSH_CLIENT
delete process.env.SSH_TTY

// Anything that reads the macOS Keychain in a test reads this stand-in, with no items, unless
// the test points it elsewhere. The real `/usr/bin/security` is never run by a test.
process.env.KURMIS_SECURITY_PROGRAM = join(dirname(fileURLToPath(import.meta.url)), 'daemon', 'fake-security', 'security.mjs')
process.env.FAKE_SECURITY_DIR = join(home, 'fake-keychain')
mkdirSync(process.env.FAKE_SECURITY_DIR, { recursive: true })

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})
