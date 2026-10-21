// `kurmis set <login> [--auto on|off] [--five-hour <1-100>] [--weekly <1-100>] [--use-first on|off]
// [--alias <alias>]`: changes a login's settings in config.json, under the config lock, and tells a
// running daemon to read them. The login is named by its alias or id (`resolveLogin`).
import { aliasProblem, changeConfig, ConfigError, findLogin, loadConfig, resolveLogin, updateLogin, type KurmisConfig, type LoginSettings, type LoginSettingsPatch } from '../../data/config.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { realDaemonClient, reloadIfRunning, reloadText, type DaemonClient } from '../command-deps.ts'
import { machineOwnText, PROVIDER_NAMES } from '../login-names.ts'

export interface SetDeps {
  daemon: DaemonClient
}

/** `on` or `off` as a boolean, or null for anything else. */
export function parseOnOff(text: string): boolean | null {
  if (text === 'on') return true
  if (text === 'off') return false
  return null
}

/** A whole number from 1 to 100 written as digits only, or null. */
export function parsePercent(text: string): number | null {
  if (!/^\d{1,3}$/.test(text)) return null
  const value = Number(text)
  return value >= 1 && value <= 100 ? value : null
}

export type SetOptions = Partial<Record<'auto' | 'five-hour' | 'weekly' | 'use-first' | 'alias', string>>

/**
 * The patch the options ask for, or a sentence saying which option is wrong. The alias is only
 * taken as it was typed here; whether it is free is checked against the config
 * (`aliasProblem`).
 */
export function patchFromOptions(options: SetOptions): LoginSettingsPatch | { error: string } {
  const patch: LoginSettingsPatch = {}
  for (const [option, field] of [['auto', 'routing'], ['use-first', 'useFirst']] as const) {
    const text = options[option]
    if (text === undefined) continue
    const value = parseOnOff(text)
    if (value === null) return { error: `--${option} takes on or off, not "${text}"` }
    patch[field] = value
  }
  for (const [option, field] of [['five-hour', 'fiveHourLimit'], ['weekly', 'weeklyLimit']] as const) {
    const text = options[option]
    if (text === undefined) continue
    const value = parsePercent(text)
    if (value === null) return { error: `--${option} takes a whole number from 1 to 100, not "${text}"` }
    patch[field] = value
  }
  if (options.alias !== undefined) patch.alias = options.alias
  if (Object.keys(patch).length === 0) return { error: 'give at least one of --auto, --five-hour, --weekly, --use-first or --alias' }
  return patch
}

/** Where a login's alias comes from, in a few words. */
function aliasSource(login: LoginSettings): string {
  if (login.aliasSetByUser) return 'set by you'
  if (login.alias === login.id) return 'the id, while kurmis knows no email for the login'
  return 'made from the email'
}

/** A login's settings, one per line, under the option names `set` takes. */
export function formatLoginSettings(login: LoginSettings): string {
  const lines = [`${login.alias} (${PROVIDER_NAMES[login.provider]}, id ${login.id})`]
  if (login.machineOwn) lines.push(`  ${machineOwnText(login.provider)}`)
  lines.push(
    `  alias       ${login.alias} (${aliasSource(login)})`,
    `  auto        ${login.routing ? 'on' : 'off'}`,
    `  five-hour   ${String(login.fiveHourLimit)}%`,
    `  weekly      ${String(login.weeklyLimit)}%`,
    `  use-first   ${login.useFirst ? 'on' : 'off'}`
  )
  return lines.join('\n')
}

function failWith(context: CliContext, message: string): number {
  writeLine(context.stderr, `kurmis set: ${message}`)
  return EXIT_FAILURE
}

export function createSetCommand(deps: Partial<SetDeps> = {}): Command {
  const daemon = deps.daemon ?? realDaemonClient
  return {
    name: 'set',
    summary: "Change a login's routing settings or alias",
    usage: `Usage: kurmis set <login> [--auto on|off] [--five-hour <1-100>] [--weekly <1-100>]
                       [--use-first on|off] [--alias <alias>]

Changes the settings of a login and prints them. A running daemon uses them at once. Give at
least one option.

<login> is the login's alias or its id, as "kurmis status" shows them. When a Claude login and a
Codex login have the same alias, put claude: or codex: in front, for example
claude:work-example.

Options:
  --auto on|off         Whether Auto routing may use the login. A session started with
                        "--login <login>" uses it either way.
  --five-hour <1-100>   Auto routing stops using the login once its five-hour window is at
                        this percentage.
  --weekly <1-100>      The same for the weekly window.
  --use-first on|off    Take this login before every other one that has room.
  --alias <alias>       The name you type and see for the login. It is 1 to 32 lowercase
                        letters, digits, "-" or "_", starts with a letter or digit, and is not
                        "claude" or "codex". No other login of the same provider may have it,
                        and it may not be another login's id.
                        Kurmis keeps an alias you set; without one, the alias follows the
                        account's email.
  -h, --help            Show this help.

Example:
  kurmis set work-example --weekly 80 --use-first on`,
    async run(args, context) {
      const parsed = parseCommandArgs('set', args, {
        auto: { type: 'string' },
        'five-hour': { type: 'string' },
        weekly: { type: 'string' },
        'use-first': { type: 'string' },
        alias: { type: 'string' }
      }, context, true)
      if (typeof parsed === 'number') return parsed
      if (parsed.positionals.length !== 1) return usageError('set', 'takes one login, by its alias or id', context)
      const patch = patchFromOptions(parsed.values)
      if ('error' in patch) return usageError('set', patch.error, context)

      let login: LoginSettings
      try {
        const config: KurmisConfig = loadConfig()
        const resolved = resolveLogin(config, parsed.positionals[0]!)
        if ('error' in resolved) return usageError('set', `${resolved.error}; "kurmis status" shows the logins`, context)
        const target = resolved.login
        if (patch.alias !== undefined) {
          const problem = aliasProblem(config, target, patch.alias)
          if (problem !== null) return usageError('set', problem, context)
        }
        const changed = changeConfig((current) => updateLogin(current, target.id, patch))
        login = findLogin(changed, target.id)!
      } catch (error) {
        if (error instanceof ConfigError) return failWith(context, error.message)
        throw error
      }
      writeLine(context.stdout, formatLoginSettings(login))
      const reload = reloadText(await reloadIfRunning(daemon, context.env))
      if (reload !== null) writeLine(context.stdout, reload)
      return EXIT_OK
    }
  }
}

export const setCommand = createSetCommand()
