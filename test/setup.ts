// Every test file runs with HOME and KURMIS_HOME pointing at a fresh temporary folder, so no
// test can read or write the real ~/.claude, ~/.codex or ~/.kurmis by accident.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})
