// `kurmis set <id> [--auto on|off] [--five-hour <1-100>] [--weekly <1-100>] [--use-first on|off]
// [--label <text>]`: changes a login's settings in config.json, under the config lock, and tells a
// running daemon to read them.
import { changeConfig, ConfigError, findLogin, loadConfig, updateLogin, type KurmisConfig, type LoginSettings, type LoginSettingsPatch } from '../../data/config.ts'
import { parseLoginId } from '../../data/login-id.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { realDaemonClient, reloadIfRunning, reloadText, type DaemonClient } from '../command-deps.ts'

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

/** The longest label `config.json` accepts. */
const MAX_LABEL_LENGTH = 64

export type SetOptions = Partial<Record<'auto' | 'five-hour' | 'weekly' | 'use-first' | 'label', string>>

/** The patch the options ask for, or a sentence saying which option is wrong. */
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
  if (options.label !== undefined) {
    const label = options.label.trim()
    if (label === '' || label.length > MAX_LABEL_LENGTH) return { error: `--label takes 1 to ${String(MAX_LABEL_LENGTH)} characters` }
    patch.label = label
  }
  if (Object.keys(patch).length === 0) return { error: 'give at least one of --auto, --five-hour, --weekly, --use-first or --label' }
  return patch
}

/**
 * The login `text` names: a full id, or a name that exactly one login has (`work` for
 * `claude:work` when there is no `codex:work`). Answers a sentence when it names none or two.
 */
export function resolveLoginArgument(text: string, config: KurmisConfig): LoginSettings | { error: string } {
  if (text.includes(':')) {
    if (parseLoginId(text) === null) return { error: `"${text}" is not a login id (claude:<name> or codex:<name>)` }
    const login = findLogin(config, text)
    return login ?? { error: `there is no login ${text}; "kurmis list" shows them` }
  }
  const matches = config.logins.filter((login) => login.id.slice(login.id.indexOf(':') + 1) === text)
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) return { error: `"${text}" could be ${matches.map((login) => login.id).join(' or ')}; give the full id` }
  return { error: `there is no login named "${text}"; "kurmis list" shows them` }
}

/** A login's settings, one per line, under the option names `set` takes. */
export function formatLoginSettings(login: LoginSettings): string {
  return [
    `${login.id}`,
    `  label       ${login.label}`,
    `  auto        ${login.routing ? 'on' : 'off'}`,
    `  five-hour   ${String(login.fiveHourLimit)}%`,
    `  weekly      ${String(login.weeklyLimit)}%`,
    `  use-first   ${login.useFirst ? 'on' : 'off'}`
  ].join('\n')
}

function failWith(context: CliContext, message: string): number {
  writeLine(context.stderr, `kurmis set: ${message}`)
  return EXIT_FAILURE
}

export function createSetCommand(deps: Partial<SetDeps> = {}): Command {
  const daemon = deps.daemon ?? realDaemonClient
  return {
    name: 'set',
    summary: "Change a login's routing settings or label",
    usage: `Usage: kurmis set <id> [--auto on|off] [--five-hour <1-100>] [--weekly <1-100>]
                    [--use-first on|off] [--label <text>]

Changes the settings of the login <id> (claude:<name> or codex:<name>, or just the name when
only one login has it) and prints them. A running daemon uses them at once. Give at least one
option.

Options:
  --auto on|off         Whether Auto routing may use the login. A session started with
                        "--login <id>" uses it either way.
  --five-hour <1-100>   Auto routing stops using the login once its five-hour window is at
                        this percentage.
  --weekly <1-100>      The same for the weekly window.
  --use-first on|off    Take this login before every other one that has room.
  --label <text>        The name "kurmis list" and "kurmis status" show, 1 to 64 characters.
  -h, --help            Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs('set', args, {
        auto: { type: 'string' },
        'five-hour': { type: 'string' },
        weekly: { type: 'string' },
        'use-first': { type: 'string' },
        label: { type: 'string' }
      }, context, true)
      if (typeof parsed === 'number') return parsed
      if (parsed.positionals.length !== 1) return usageError('set', 'takes one login id', context)
      const patch = patchFromOptions(parsed.values)
      if ('error' in patch) return usageError('set', patch.error, context)

      let login: LoginSettings
      try {
        const resolved = resolveLoginArgument(parsed.positionals[0]!, loadConfig())
        if ('error' in resolved) return usageError('set', resolved.error, context)
        const config = changeConfig((current) => updateLogin(current, resolved.id, patch))
        login = findLogin(config, resolved.id)!
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
