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
delete process.env.KURMIS_UPSTREAM_URL
delete process.env.SSH_CONNECTION
delete process.env.SSH_CLIENT
delete process.env.SSH_TTY

// Kurmis code a test runs (the daemon's usage probes, the wrapper) finds claude and codex through
// these. They name a program that only fails, so no test can start the real claude or codex from
// PATH. A test that uses a fake names it; a test of the PATH search removes them from its env.
process.env.KURMIS_CLAUDE_BIN = join(dirname(fileURLToPath(import.meta.url)), 'no-real-program.mjs')
process.env.KURMIS_CODEX_BIN = process.env.KURMIS_CLAUDE_BIN

// Anything that reads the macOS Keychain in a test reads this stand-in, with no items, unless
// the test points it elsewhere. The real `/usr/bin/security` is never run by a test.
process.env.KURMIS_SECURITY_PROGRAM = join(dirname(fileURLToPath(import.meta.url)), 'daemon', 'fake-security', 'security.mjs')
process.env.FAKE_SECURITY_DIR = join(home, 'fake-keychain')
mkdirSync(process.env.FAKE_SECURITY_DIR, { recursive: true })

// The same for launchd and the Windows registry: `launchctl` and `reg.exe` are stand-ins that
// keep their jobs and values in the temporary home. They start no program unless a test sets
// FAKE_LAUNCHCTL_RUN=1.
process.env.KURMIS_LAUNCHCTL_PROGRAM = join(dirname(fileURLToPath(import.meta.url)), 'platform', 'fake-launchctl', 'launchctl.mjs')
process.env.FAKE_LAUNCHCTL_DIR = join(home, 'fake-launchctl')
mkdirSync(process.env.FAKE_LAUNCHCTL_DIR, { recursive: true })
delete process.env.FAKE_LAUNCHCTL_RUN
delete process.env.FAKE_LAUNCHCTL_FAIL_BOOTSTRAP
process.env.KURMIS_REG_PROGRAM = join(dirname(fileURLToPath(import.meta.url)), 'platform', 'fake-reg', 'reg.mjs')
process.env.FAKE_REG_DIR = join(home, 'fake-reg')
mkdirSync(process.env.FAKE_REG_DIR, { recursive: true })
delete process.env.FAKE_REG_FAIL

// No test may start a real launchctl, security, PowerShell, reg, taskkill, wscript, claude or
// codex, even through an environment it built itself: kurmis refuses them while this is set
// (src/platform/system-program-guard.ts), and passes it on to every program it starts.
process.env.KURMIS_REFUSE_SYSTEM_PROGRAMS = '1'

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})
