import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { COMMANDS } from '../../src/cli/commands/index.ts'
import { runCli } from '../../src/cli/dispatch.ts'
import { configPath } from '../../src/data/paths.ts'
import { OWN_CLAUDE, writeTestConfig } from '../logins.ts'

async function run(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await runCli(argv, {
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
    // An empty KURMIS_CLAUDE_BIN with no PATH: no claude is found.
    env: { KURMIS_CLAUDE_BIN: '' }
  })
  return { code, stdout, stderr }
}

const NAMES = ['claude', 'status', 'set', 'login', 'logout', 'setup', 'daemon']

describe('dispatch', () => {
  it('has every command from the docs', () => {
    expect(COMMANDS.map((command) => command.name)).toEqual(NAMES)
  })

  it('prints the main help for no arguments, --help and -h', async () => {
    for (const argv of [[], ['--help'], ['-h'], ['help']]) {
      const result = await run(...argv)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Usage: kurmis <command>')
      for (const name of NAMES) expect(result.stdout).toContain(`  ${name} `)
    }
  })

  it('prints the version', async () => {
    expect(await run('--version')).toEqual({ code: 0, stdout: 'dev\n', stderr: '' })
  })

  it('answers an unknown command or option with the help and exit code 2', async () => {
    const command = await run('nope')
    expect(command.code).toBe(2)
    expect(command.stderr).toContain('unknown command "nope"')
    expect(command.stderr).toContain('Usage: kurmis <command>')
    const option = await run('--nope')
    expect(option.code).toBe(2)
    expect(option.stderr).toContain('unknown option "--nope"')
  })


  it.each(NAMES)('shows the help of %s three ways', async (name) => {
    const usage = COMMANDS.find((command) => command.name === name)!.usage
    expect(usage).toMatch(new RegExp(`^Usage: kurmis ${name}`))
    for (const argv of [[name, '--help'], [name, '-h'], ['help', name]]) {
      expect(await run(...argv)).toEqual({ code: 0, stdout: `${usage}\n`, stderr: '' })
    }
  })

  it('refuses help for an unknown command', async () => {
    const result = await run('help', 'nope')
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('unknown command "nope"')
  })

  it('passes --help after -- on to claude instead of showing kurmis help', async () => {
    // The test environment is empty, so no claude is found and nothing is started.
    const result = await run('claude', '--', '--help')
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain('Usage: kurmis claude')
    expect(result.code).toBe(127)
  })

  it('gives a usage error for a bad option', async () => {
    const status = await run('status', '--nope')
    expect(status.code).toBe(2)
    expect(status.stderr).toContain('kurmis status:')
    expect((await run('claude', '--login=')).code).toBe(2)
    expect((await run('daemon')).code).toBe(2)
    expect((await run('daemon', 'nope')).code).toBe(2)
    expect((await run('daemon', 'stop', '--nope')).code).toBe(2)
    expect((await run('daemon', 'constructor')).code).toBe(2)
  })
})

describe('kurmis status without a daemon', () => {
  beforeEach(() => {
    rmSync(configPath(), { force: true })
  })

  it('gives the login of plain claude an id in a new config.json when there is none', async () => {
    const result = await run('status')
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/^The kurmis daemon is not running\./)
    expect(existsSync(configPath())).toBe(true)
    const logins = (JSON.parse(readFileSync(configPath(), 'utf8')) as { logins: { id: string }[] }).logins
    expect(logins).toHaveLength(1)
    expect(result.stdout).toContain(`\n${logins[0]!.id}\n  the login plain claude uses\n  no credentials on this machine, routing on`)
    expect(result.stdout).not.toContain('no id yet')
  })

  it('shows stored logins and settings, also as JSON', async () => {
    writeTestConfig({
      extras: [{ id: 'workclaude', alias: 'work-example', useFirst: true }],
      ownClaude: { routing: false, weeklyLimit: 75 }
    })
    const text = await run('status')
    expect(text.stdout).toContain('work-example (id workclaude)\n  no credentials on this machine, routing on, limits 100% 5 hour, 100% weekly,\n  use first')
    expect(text.stdout).toContain(`\n${OWN_CLAUDE}\n  the login plain claude uses\n  no credentials on this machine, routing off, limits 100% 5 hour, 75% weekly`)
    const json = JSON.parse((await run('status', '--json')).stdout) as { daemon: unknown; logins: Array<{ id: string; credentials: boolean }> }
    expect(json.daemon).toBeNull()
    expect(json.logins.map((login) => [login.id, login.credentials])).toEqual([[OWN_CLAUDE, false], ['workclaude', false]])
  })

  it('reports a broken config.json', async () => {
    writeFileSync(configPath(), '{"version": 7}')
    const result = await run('status')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('newer kurmis')
  })
})
