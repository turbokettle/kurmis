// `kurmis setup`, `--pause` and `--uninstall-and-logout` end to end, against the world's
// temporary HOME: the real bundle edits `~/.claude/settings.json`, registers the login item
// through the fake launchctl and starts the daemon, and a plain fake `claude -p`, started with
// the world's environment and no routing variable of its own, reaches the fake Anthropic API
// through the daemon because of that settings file alone.
//
// The login item is the host's: on macOS a launchd agent, which the fake launchctl stands in
// for, and on Windows a Run value in the registry, which the fake reg.exe stands in for, and a
// JScript file that wscript.exe would run at logon.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTING_VARIABLES } from '../../src/core/routed-env.ts'
import { parseRegQuery, regFor, regQueryArgs, RUN_ENTRY_DESCRIPTION, RUN_VALUE_NAME } from '../../src/platform/windows-autostart.ts'
import { FAKE_CLAUDE_SCRIPT, fakeToken, reply, type FakeClaudeRecord } from '../fakes/index.ts'
import { createWorld, waitUntil, type KurmisResult, type World } from './harness.ts'

/** A settings file with keys of the person's own around `env`, in a 4-space indent. */
const ORIGINAL = [
  '{',
  '    "model": "sonnet",',
  '    "env": {',
  '        "MY_SETTING": "1",',
  '        "ANTHROPIC_CUSTOM_HEADERS": "X-Team: blue"',
  '    },',
  '    "permissions": {',
  '        "allow": ["Bash(ls:*)"]',
  '    }',
  '}',
  ''
].join('\n')

/** What setup makes of `ORIGINAL`: the routing variables in `env`, every other line as it was. */
function expectedAfterSetup(port: number, key: string): string {
  return [
    '{',
    '    "model": "sonnet",',
    '    "env": {',
    '        "MY_SETTING": "1",',
    `        "ANTHROPIC_CUSTOM_HEADERS": "X-Team: blue\\nx-kurmis-key: ${key}",`,
    `        "ANTHROPIC_BASE_URL": "http://127.0.0.1:${String(port)}",`,
    '        "ENABLE_TOOL_SEARCH": "true",',
    '        "CLAUDE_CODE_MAX_RETRIES": "15"',
    '    },',
    '    "permissions": {',
    '        "allow": ["Bash(ls:*)"]',
    '    }',
    '}',
    ''
  ].join('\n')
}

const LABEL = 'kurmis.daemon'

type StartRecord = Extract<FakeClaudeRecord, { kind: 'start' }>

function settingsPath(world: World): string {
  return join(world.home, '.claude', 'settings.json')
}

function plistPath(world: World): string {
  return join(world.home, 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

function readKey(world: World): string {
  return readFileSync(join(world.data, 'key'), 'utf8').trim()
}

function fileMode(path: string): number {
  return statSync(path).mode & 0o777
}

/** The fake launchctl's calls, one argument list each. */
function launchctlCalls(world: World): string[][] {
  const file = join(world.fakeLaunchctlDir, 'calls.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as string[])
}

/** The jobs the fake launchctl has loaded, by label. */
function launchctlJobs(world: World): Record<string, { plist: string; pid: number | null }> {
  const file = join(world.fakeLaunchctlDir, 'state.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, { plist: string; pid: number | null }> : {}
}

/** The bundle as kurmis names it in what it starts: with its symlinks resolved (`/tmp` is one on macOS). */
function bundlePath(world: World): string {
  return realpathSync(world.bundle)
}

/** The pids of the processes that run `<bundle> daemon run`. The bundle is this test file's own. */
function daemonProcesses(world: World): number[] {
  const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  return lines
    .filter((line) => line.includes(`${bundlePath(world)} daemon run`))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
}

/**
 * Runs the fake claude itself, the way a person's plain `claude` runs: with the world's
 * environment (HOME, so it reads the world's `~/.claude/settings.json`) and nothing that routes it.
 */
function plainClaude(world: World, args: string[]): Promise<KurmisResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FAKE_CLAUDE_SCRIPT, ...args], { env: world.env, cwd: world.work, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`fake claude ${args.join(' ')} did not finish within 60 s\nstdout: ${stdout}\nstderr: ${stderr}`))
    }, 60_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
    })
    child.stdin.end()
  })
}

function messageRequests(world: World): ReturnType<World['api']['apiRequests']> {
  return world.api.apiRequests().filter((request) => request.path.startsWith('/v1/messages'))
}

describe.skipIf(process.platform !== 'darwin')('kurmis setup on macOS', () => {
  it('routes a plain claude through the daemon, pauses, turns on again, and uninstalls', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    mkdirSync(join(world.home, '.claude'), { recursive: true })
    writeFileSync(settingsPath(world), ORIGINAL, { mode: 0o644 })
    world.api.setDefault(reply.ok({ text: 'Hello through global mode' }))

    // FAKE_LAUNCHCTL_RUN=1: loading the login item runs its program at once, as launchd does
    // with RunAtLoad, so the job and setup itself start the daemon at the same moment.
    const setup = await world.kurmis(['setup'], { env: { FAKE_LAUNCHCTL_RUN: '1' } })
    expect(setup, JSON.stringify(setup)).toMatchObject({ code: 0, stderr: '' })
    expect(setup.stdout).toContain(`Claude Code settings: ${settingsPath(world)}`)
    expect(setup.stdout).toContain(`The daemon now starts at login (${plistPath(world)}).`)
    expect(setup.stdout).toContain(`The daemon is running on port ${String(world.port)}.`)

    // The settings file: exactly kurmis' variables added, the rest and the layout as they were.
    const key = readKey(world)
    expect(readFileSync(settingsPath(world), 'utf8')).toBe(expectedAfterSetup(world.port, key))
    const env = (JSON.parse(readFileSync(settingsPath(world), 'utf8')) as { env: Record<string, string> }).env
    expect(Object.keys(env).sort()).toEqual(['MY_SETTING', ...ROUTING_VARIABLES].sort())
    // The file now holds the key, so setup made it readable only by the user.
    expect(fileMode(settingsPath(world))).toBe(0o600)
    expect(setup.stdout).toContain('Made the file readable only by you, because it holds kurmis\' key (its mode was 0644).')
    const backup = `${settingsPath(world)}.kurmis-backup`
    expect(readFileSync(backup, 'utf8')).toBe(ORIGINAL)
    expect(fileMode(backup)).toBe(0o600)

    // The login item: a plist that starts `daemon start` with this world's data folder, loaded
    // into the user's GUI domain.
    const plist = readFileSync(plistPath(world), 'utf8')
    expect(plist).toContain(`<string>${bundlePath(world)}</string>\n    <string>daemon</string>\n    <string>start</string>\n  </array>`)
    expect(plist).toContain(`<key>KURMIS_HOME</key>\n    <string>${world.data}</string>`)
    expect(plist).toContain(`<key>HOME</key>\n    <string>${world.home}</string>`)
    expect(plist).not.toMatch(/ANTHROPIC_|SSH_|CLAUDE_CONFIG_DIR/)
    expect(plist).not.toContain(key)
    const uid = process.getuid!()
    expect(launchctlCalls(world)).toContainEqual(['bootstrap', `gui/${String(uid)}`, plistPath(world)])
    expect(Object.keys(launchctlJobs(world))).toEqual([LABEL])
    const runs = readFileSync(join(world.fakeLaunchctlDir, 'runs.jsonl'), 'utf8').split('\n').filter((line) => line !== '')
    expect(runs.map((line) => (JSON.parse(line) as { label: string }).label)).toEqual([LABEL])

    // The two starts end with one daemon, the one daemon.json names.
    const info = world.daemonInfo()
    expect(info).toMatchObject({ port: world.port })
    await waitUntil(() => daemonProcesses(world).length === 1, 15_000, 'only one daemon to be left')
    expect(daemonProcesses(world)).toEqual([info!.pid])

    // A plain claude, which has only the settings file to go by, is routed through the daemon.
    const routed = await plainClaude(world, ['-p', 'hi'])
    expect(routed, JSON.stringify(routed)).toMatchObject({ code: 0, stdout: expect.stringContaining('Hello through global mode') as string })
    const start = world.claudeRecord().find((line): line is StartRecord => line.kind === 'start' && JSON.stringify(line.argv) === JSON.stringify(['-p', 'hi']))
    expect(start?.env).not.toHaveProperty('ANTHROPIC_BASE_URL')
    expect(start?.effectiveEnv).toMatchObject({ ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(world.port)}` })
    const requests = messageRequests(world)
    expect(requests.map((request) => request.bearer)).toEqual([fakeToken('default')])
    expect(requests[0]!.headers['x-team']).toBe('blue')
    for (const request of world.api.requests) {
      expect(Object.keys(request.headers).filter((name) => name.startsWith('x-kurmis'))).toEqual([])
    }

    // Setup again changes nothing.
    const again = await world.kurmis(['setup'])
    expect(again, JSON.stringify(again)).toMatchObject({ code: 0, stderr: '' })
    expect(again.stdout).toContain('The file already has kurmis\' settings; nothing to change.')
    expect(again.stdout).toContain(`The daemon already starts at login (${plistPath(world)}).`)
    expect(readFileSync(settingsPath(world), 'utf8')).toBe(expectedAfterSetup(world.port, key))
    expect(readFileSync(backup, 'utf8')).toBe(ORIGINAL)
    expect(launchctlCalls(world).filter((call) => call[0] === 'bootstrap')).toHaveLength(1)

    // A pause: the file is byte for byte what it was, and the login item, the backup and the
    // daemon stay.
    const pause = await world.kurmis(['setup', '--pause'])
    expect(pause, JSON.stringify(pause)).toMatchObject({ code: 0, stderr: '' })
    expect(pause.stdout).toContain('Paused global routing')
    expect(readFileSync(settingsPath(world), 'utf8')).toBe(ORIGINAL)
    // A pause keeps the mode setup left.
    expect(fileMode(settingsPath(world))).toBe(0o600)
    expect(existsSync(plistPath(world))).toBe(true)
    expect(Object.keys(launchctlJobs(world))).toEqual([LABEL])
    expect(readFileSync(backup, 'utf8')).toBe(ORIGINAL)
    expect(existsSync(join(world.data, 'paused.json'))).toBe(true)
    expect(world.daemonInfo()?.pid).toBe(info!.pid)

    // A plain claude is no longer routed: with no base URL the fake refuses to start.
    const unrouted = await plainClaude(world, ['-p', 'hi'])
    expect(unrouted.code).toBe(2)
    expect(messageRequests(world)).toHaveLength(1)

    // A pause again changes nothing.
    const pauseAgain = await world.kurmis(['setup', '--pause'])
    expect(pauseAgain, JSON.stringify(pauseAgain)).toMatchObject({ code: 0, stderr: '' })
    expect(pauseAgain.stdout).toContain('Global routing is already paused.')
    expect(readFileSync(settingsPath(world), 'utf8')).toBe(ORIGINAL)

    // Setup turns it on again.
    const resumed = await world.kurmis(['setup'])
    expect(resumed, JSON.stringify(resumed)).toMatchObject({ code: 0, stderr: '' })
    expect(resumed.stdout).toContain('Global routing was paused; it is on again.')
    expect(readFileSync(settingsPath(world), 'utf8')).toBe(expectedAfterSetup(world.port, key))
    expect(existsSync(join(world.data, 'paused.json'))).toBe(false)
    expect((await plainClaude(world, ['-p', 'hi'])).code).toBe(0)

    // Without a terminal, the uninstall needs --yes.
    const refused = await world.kurmis(['setup', '--uninstall-and-logout'])
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('Run it again with --yes')
    expect(readFileSync(settingsPath(world), 'utf8')).toBe(expectedAfterSetup(world.port, key))

    // The uninstall: the file as it was, no backup, no login item, no daemon, no data folder.
    const { folder } = await world.addClaudeLogin('work@example.com')
    const uninstall = await world.kurmis(['setup', '--uninstall-and-logout', '--yes'])
    expect(uninstall, JSON.stringify(uninstall)).toMatchObject({ code: 0, stderr: '' })
    expect(readFileSync(settingsPath(world), 'utf8')).toBe(ORIGINAL)
    expect(existsSync(backup)).toBe(false)
    expect(existsSync(plistPath(world))).toBe(false)
    expect(launchctlCalls(world)).toContainEqual(['bootout', `gui/${String(uid)}/${LABEL}`])
    expect(launchctlJobs(world)).toEqual({})
    expect(world.claudeRecord().filter((line) => line.kind === 'logout')).toEqual([expect.objectContaining({ credentialsDir: folder })])
    await waitUntil(() => daemonProcesses(world).length === 0, 15_000, 'the daemon to stop')
    expect(existsSync(world.data)).toBe(false)
    expect(uninstall.stdout.trimEnd().split('\n').at(-1)).toBe('Last step: remove the kurmis program with "npm uninstall -g kurmis".')
  }, 180_000)

  it('creates a settings file readable only by the person when there is none, and a pause empties it', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()

    const setup = await world.kurmis(['setup'])
    expect(setup, JSON.stringify(setup)).toMatchObject({ code: 0, stderr: '' })
    expect(setup.stdout).toContain('Created the file, readable only by you.')
    expect(fileMode(settingsPath(world))).toBe(0o600)
    expect(existsSync(`${settingsPath(world)}.kurmis-backup`)).toBe(false)
    const created = JSON.parse(readFileSync(settingsPath(world), 'utf8')) as Record<string, unknown>
    expect(created).toEqual({
      env: {
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(world.port)}`,
        ANTHROPIC_CUSTOM_HEADERS: `x-kurmis-key: ${readKey(world)}`,
        ENABLE_TOOL_SEARCH: 'true',
        CLAUDE_CODE_MAX_RETRIES: '15'
      }
    })

    const routed = await plainClaude(world, ['-p', 'hi'])
    expect(routed, JSON.stringify(routed)).toMatchObject({ code: 0 })
    expect(messageRequests(world).map((request) => request.bearer)).toEqual([fakeToken('default')])

    const pause = await world.kurmis(['setup', '--pause'])
    expect(pause, JSON.stringify(pause)).toMatchObject({ code: 0, stderr: '' })
    expect(pause.stdout).toContain('Removed the "env" block, which had nothing else in it.')
    expect(JSON.parse(readFileSync(settingsPath(world), 'utf8'))).toEqual({})
    expect(existsSync(plistPath(world))).toBe(true)
  }, 180_000)

  it('refuses a settings file whose base URL points elsewhere, and changes nothing', async () => {
    const world = await createWorld()
    const theirs = '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://proxy.example.com"\n  }\n}\n'
    mkdirSync(join(world.home, '.claude'), { recursive: true })
    writeFileSync(settingsPath(world), theirs)

    const setup = await world.kurmis(['setup'])
    expect(setup.code).toBe(1)
    expect(setup.stderr).toContain('https://proxy.example.com')
    expect(readFileSync(settingsPath(world), 'utf8')).toBe(theirs)
    expect(existsSync(`${settingsPath(world)}.kurmis-backup`)).toBe(false)
    expect(existsSync(plistPath(world))).toBe(false)
    expect(launchctlCalls(world)).toEqual([])
    expect(world.daemonInfo()).toBeNull()
  }, 60_000)
})

describe.runIf(process.platform === 'win32')('kurmis setup on Windows', () => {
  /** kurmis' Run value as the fake reg.exe holds it, or null. */
  async function runValue(world: World): Promise<string | null> {
    return parseRegQuery((await regFor(world.env)(regQueryArgs())).stdout, RUN_VALUE_NAME)?.data ?? null
  }

  it('routes a plain claude through the daemon, and --uninstall-and-logout puts the file back and removes the logon entry', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    mkdirSync(join(world.home, '.claude'), { recursive: true })
    writeFileSync(settingsPath(world), ORIGINAL)
    world.api.setDefault(reply.ok({ text: 'Hello through global mode' }))
    const script = join(world.data, 'autostart.js')

    const setup = await world.kurmis(['setup'])
    expect(setup, JSON.stringify(setup)).toMatchObject({ code: 0 })
    expect(setup.stdout).toContain(`The daemon now starts at login (${RUN_ENTRY_DESCRIPTION}).`)
    expect(setup.stdout).toContain(`The daemon is running on port ${String(world.port)}.`)
    const key = readKey(world)
    expect(readFileSync(settingsPath(world), 'utf8')).toBe(expectedAfterSetup(world.port, key))

    // The Run value runs wscript (the stand-in of test/setup.ts) on the script, and the script
    // starts this bundle's `daemon start` with this world's data folder.
    const value = await runValue(world)
    expect(value).toContain('//E:JScript')
    expect(value).toContain(script)
    const text = readFileSync(script).subarray(2).toString('utf16le')
    // A folder with a space in it is quoted on the command line, and the quote is escaped in
    // the script's string.
    expect(text).toMatch(/daemon start --env (\\")?KURMIS_HOME=/)
    expect(text).not.toContain(key)

    const routed = await plainClaude(world, ['-p', 'hi'])
    expect(routed, JSON.stringify(routed)).toMatchObject({ code: 0, stdout: expect.stringContaining('Hello through global mode') as string })
    expect(messageRequests(world).map((request) => request.bearer)).toEqual([fakeToken('default')])

    const again = await world.kurmis(['setup'])
    expect(again, JSON.stringify(again)).toMatchObject({ code: 0 })
    expect(again.stdout).toContain(`The daemon already starts at login (${RUN_ENTRY_DESCRIPTION}).`)

    const pause = await world.kurmis(['setup', '--pause'])
    expect(pause, JSON.stringify(pause)).toMatchObject({ code: 0 })
    expect(readFileSync(settingsPath(world), 'utf8')).toBe(ORIGINAL)
    expect(await runValue(world)).toBe(value)
    expect((await world.kurmis(['daemon', 'status'])).code).toBe(0)

    const uninstall = await world.kurmis(['setup', '--uninstall-and-logout', '--yes'])
    expect(uninstall, JSON.stringify(uninstall)).toMatchObject({ code: 0 })
    expect(uninstall.stdout).toContain(`Removed the daemon's start at login (${RUN_ENTRY_DESCRIPTION}).`)
    expect(readFileSync(settingsPath(world), 'utf8')).toBe(ORIGINAL)
    expect(existsSync(`${settingsPath(world)}.kurmis-backup`)).toBe(false)
    expect(await runValue(world)).toBeNull()
    expect(existsSync(world.data)).toBe(false)
  }, 180_000)
})
