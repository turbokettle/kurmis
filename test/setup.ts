// Every test file runs with HOME and KURMIS_HOME pointing at a fresh temporary folder, so no
// test can read or write the real ~/.claude, ~/.codex or ~/.kurmis by accident.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'kurmis-test-home-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.KURMIS_HOME = join(home, '.kurmis')
// os.homedir() must follow HOME (USERPROFILE on Windows). It does in a process of its own, but
// not in a worker thread, so a test file run with --pool=threads would reach the real home.
if (homedir() !== home) {
  rmSync(home, { recursive: true, force: true })
  throw new Error(`os.homedir() is ${homedir()}, not the temporary home ${home}, so the tests would reach the real ` +
    'home folder. Run them in processes of their own (pool: \'forks\' in vitest.config.ts).')
}
delete process.env.CODEX_HOME
delete process.env.CLAUDE_CONFIG_DIR
delete process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
delete process.env.ANTHROPIC_BASE_URL
delete process.env.ANTHROPIC_API_KEY
delete process.env.ANTHROPIC_AUTH_TOKEN
delete process.env.ANTHROPIC_CUSTOM_HEADERS
delete process.env.CLAUDE_CODE_OAUTH_TOKEN
delete process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
// A daemon a test starts without naming the fake API sends its requests to a loopback port
// nothing listens on (port 1 needs root to bind), never to Anthropic.
process.env.KURMIS_UPSTREAM_URL = 'http://127.0.0.1:1'
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

// The Windows programs: PowerShell (the Credential Manager read) fails and records its calls, taskkill
// records its calls and ends only the one pid it is given, and wscript, which kurmis only names
// in the logon entry, fails when run. src/platform/system-programs.ts falls back to these
// variables of this process even when a test hands kurmis an environment without them.
const fakeWindows = join(dirname(fileURLToPath(import.meta.url)), 'platform', 'fake-windows')
process.env.KURMIS_POWERSHELL_PROGRAM = join(fakeWindows, 'powershell.mjs')
process.env.FAKE_POWERSHELL_DIR = join(home, 'fake-powershell')
process.env.KURMIS_TASKKILL_PROGRAM = join(fakeWindows, 'taskkill.mjs')
process.env.FAKE_TASKKILL_DIR = join(home, 'fake-taskkill')
process.env.KURMIS_WSCRIPT_PROGRAM = join(fakeWindows, 'wscript.mjs')

// No test may start a real launchctl, security, PowerShell, reg, taskkill, wscript, cscript,
// wmic, schtasks, cmd, claude or codex, even through an environment it built itself: kurmis
// refuses them while this is set (`GUARDED_PROGRAMS` in src/platform/system-program-guard.ts),
// and passes it on to every program it starts.
process.env.KURMIS_REFUSE_SYSTEM_PROGRAMS = '1'

// The guard writes every program it refused to this file, and a test after which it is not
// empty fails: its code reached a real system program instead of a stand-in. A test that
// checks the guard itself empties the file.
const refusals = join(home, 'refused-programs.log')
process.env.KURMIS_REFUSED_PROGRAMS_LOG = refusals
writeFileSync(refusals, '')

afterEach(() => {
  let text: string
  try {
    text = readFileSync(refusals, 'utf8')
  } catch {
    return
  }
  if (text.trim() === '') return
  writeFileSync(refusals, '')
  throw new Error(`This test reached real system programs, which the guard refused: ${text.trim().split('\n').join(', ')}. ` +
    'Point the code at the stand-ins of test/setup.ts (src/platform/system-programs.ts).')
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 10 })
})
