import { rmSync, writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { COMMANDS } from '../../src/cli/commands/index.ts'
import { runCli } from '../../src/cli/dispatch.ts'
import { addLogin, defaultConfig, saveConfig, updateLogin } from '../../src/data/config.ts'
import { configPath } from '../../src/data/paths.ts'

async function run(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await runCli(argv, {
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
    // An empty KURMIS_CLAUDE_BIN and KURMIS_CODEX_BIN with no PATH: no claude or codex is found.
    env: { KURMIS_CLAUDE_BIN: '', KURMIS_CODEX_BIN: '' }
  })
  return { code, stdout, stderr }
}

const NAMES = ['claude', 'codex', 'status', 'list', 'set', 'login', 'logout', 'setup', 'daemon']

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

  it('passes --help after a claude argument on to claude instead of showing kurmis help', async () => {
    // The test environment is empty, so no claude is found and nothing is started.
    const result = await run('claude', '-p', '--help')
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain('Usage: kurmis claude')
    expect(result.code).toBe(127)
  })

  it('gives a usage error for a bad option', async () => {
    const status = await run('status', '--nope')
    expect(status.code).toBe(2)
    expect(status.stderr).toContain('kurmis status:')
    expect((await run('claude', '--login', '../x')).code).toBe(2)
    expect((await run('daemon')).code).toBe(2)
    expect((await run('daemon', 'nope')).code).toBe(2)
    expect((await run('daemon', 'stop', '--nope')).code).toBe(2)
    expect((await run('daemon', 'constructor')).code).toBe(2)
  })
})

describe('kurmis list', () => {
  beforeEach(() => {
    rmSync(configPath(), { force: true })
  })

  it('lists the default logins when there is no config', async () => {
    const result = await run('list')
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(
      [
        'ID              LABEL    AUTO  FIVE-HOUR  WEEKLY  USE-FIRST  CREDENTIALS',
        'claude:default  default  on    100%       100%    off        no',
        'codex:default   default  on    100%       100%    off        no',
        ''
      ].join('\n')
    )
  })

  it('lists stored logins and settings, also as JSON', async () => {
    let config = addLogin(defaultConfig(), 'claude:work', { label: 'Work account', useFirst: true })
    config = updateLogin(config, 'codex:default', { routing: false, weeklyLimit: 75 })
    saveConfig(config)
    const table = await run('list')
    expect(table.stdout).toContain('claude:work     Work account  on    100%       100%    on         no')
    expect(table.stdout).toContain('codex:default   default       off   100%       75%     off        no')
    const json = await run('list', '--json')
    expect(JSON.parse(json.stdout)).toEqual(config.logins.map((login) => ({ ...login, credentials: false })))
  })

  it('reports a broken config.json', async () => {
    writeFileSync(configPath(), '{"version": 7}')
    const result = await run('list')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('newer kurmis')
  })
})
