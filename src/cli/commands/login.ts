// `kurmis login`: signs a login in with the provider's own CLI and adds it to config.json.
//
//   kurmis login claude|codex [--name <name>] [--label <text>]   a new login
//   kurmis login <id> [--label <text>]                           a new login with that id, or an
//                                                                existing one signed in again
//
// Claude runs `claude auth login --claudeai` with the login's folder as `CLAUDE_CONFIG_DIR`
// (`claudeLoginEnv`), Codex runs `codex login` with the folder as `CODEX_HOME` (`codexLoginEnv`).
// The CLI gets the terminal, as in `kurmis claude`. A new login is added to config.json only after
// its CLI has exited 0 and its credentials are there; otherwise a folder this command created is
// removed again. The email the CLI reports is shown on the terminal and written nowhere: the
// label defaults to the login's name.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { addLogin, changeConfig, ConfigError, findLogin, loadConfig, updateLogin, type KurmisConfig, type LoginSettingsPatch } from '../../data/config.ts'
import { CLAUDE_PROFILE_FILE, parseClaudeIdentity, readClaudeIdentity, type ClaudeIdentity } from '../../data/identity.ts'
import { applyEnvPatch, claudeLoginEnv, codexLoginEnv } from '../../data/login-env.ts'
import { isDefaultLoginId, isLoginProvider, isValidLoginName, parseLoginId, type LoginId, type LoginProvider } from '../../data/login-id.ts'
import { loginFolder } from '../../data/paths.ts'
import { makePrivateDirSync } from '../../platform/files.ts'
import { ProgramNotFoundError, type findProgram } from '../../platform/programs.ts'
import { removeTreeSync } from '../../platform/remove-tree.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { realChildRunner, realDaemonClient, realFindProgram, reloadIfRunning, reloadText, type ChildRunner, type DaemonClient } from '../command-deps.ts'
import { hasLocalCredentials } from './list.ts'

export interface LoginDeps {
  daemon: DaemonClient
  runner: ChildRunner
  findProgram: typeof findProgram
  /** The user's home folder, where `~/.claude.json` and `~/.codex` are. */
  home: () => string
}

/** The first of `<provider>:2`, `<provider>:3`, ... that no login uses and that has no folder. */
export function freeLoginName(provider: LoginProvider, config: KurmisConfig): string {
  for (let number = 2; ; number++) {
    const id = `${provider}:${String(number)}`
    if (findLogin(config, id) === undefined && !existsSync(loginFolder(id))) return String(number)
  }
}

/** What the command line asks for: the login, and whether it is to be added. */
export type LoginTarget = { id: LoginId; isNew: boolean } | { error: string }

/** Reads `kurmis login <provider|id> [--name <name>]` against the current config. */
export function loginTarget(argument: string, name: string | undefined, config: KurmisConfig): LoginTarget {
  if (isLoginProvider(argument)) {
    const chosen = name ?? freeLoginName(argument, config)
    if (!isValidLoginName(chosen)) {
      return { error: `"${chosen}" is not a login name; a name is 1 to 32 lowercase letters, digits, "-" or "_"` }
    }
    const id = `${argument}:${chosen}`
    if (findLogin(config, id) !== undefined) {
      return { error: `there is already a login ${id}; "kurmis login ${id}" signs it in again` }
    }
    return { id: id as LoginId, isNew: true }
  }
  if (name !== undefined) return { error: '--name goes with "kurmis login claude" or "kurmis login codex", not with a login id' }
  if (!argument.includes(':')) {
    return { error: `"${argument}" is not claude, codex or a login id such as claude:${argument}` }
  }
  const parsed = parseLoginId(argument)
  if (parsed === null) {
    return { error: `"${argument}" is not a login id; a login id is claude:<name> or codex:<name>, where the name is 1 to 32 lowercase letters, digits, "-" or "_"` }
  }
  return { id: parsed.id, isNew: findLogin(config, parsed.id) === undefined }
}

/** The account in `~/.claude.json`, which `claude auth login` writes for the machine's own login. */
function homeIdentity(home: string): ClaudeIdentity | null {
  try {
    return parseClaudeIdentity(readFileSync(join(home, CLAUDE_PROFILE_FILE), 'utf8'))
  } catch {
    return null
  }
}

function fail(context: CliContext, message: string): number {
  writeLine(context.stderr, `kurmis login: ${message}`)
  return EXIT_FAILURE
}

export function createLoginCommand(deps: Partial<LoginDeps> = {}): Command {
  const daemon = deps.daemon ?? realDaemonClient
  const runner = deps.runner ?? realChildRunner
  const find = deps.findProgram ?? realFindProgram
  const home = deps.home ?? homedir
  return {
    name: 'login',
    summary: 'Sign in a new login, or sign an existing one in again',
    usage: `Usage: kurmis login claude|codex [--name <name>] [--label <text>]
       kurmis login <id> [--label <text>]

Signs a login in with Claude Code's "claude auth login" or Codex's "codex login", which open
the sign-in page in the browser, and adds it to kurmis with Auto routing on and both limits at
100% ("kurmis set" changes that).

  kurmis login claude          Adds a new Claude login, named 2, 3, ... (claude:2) unless
                               --name gives the name.
  kurmis login codex           The same for Codex.
  kurmis login claude:work     Adds claude:work, or signs it in again when it exists. This also
                               signs in the machine's own claude:default or codex:default again.

A name is 1 to 32 lowercase letters, digits, "-" or "_". Each extra login keeps its own
credentials in its folder in the kurmis data folder (on macOS in the Keychain).

Options:
  --name <name>    The name of the new login, for "kurmis login claude|codex".
  --label <text>   The name "kurmis list" and "kurmis status" show. Defaults to the login's name.
  -h, --help       Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs('login', args, { name: { type: 'string' }, label: { type: 'string' } }, context, true)
      if (typeof parsed === 'number') return parsed
      if (parsed.positionals.length !== 1) return usageError('login', 'takes claude, codex or one login id', context)
      const label = parsed.values.label?.trim()
      if (label !== undefined && (label === '' || label.length > 64)) return usageError('login', '--label takes 1 to 64 characters', context)

      let target: LoginTarget
      try {
        target = loginTarget(parsed.positionals[0]!, parsed.values.name, loadConfig())
      } catch (error) {
        if (error instanceof ConfigError) return fail(context, error.message)
        throw error
      }
      if ('error' in target) return usageError('login', target.error, context)
      const { id, isNew } = target
      const provider: LoginProvider = id.startsWith('codex:') ? 'codex' : 'claude'
      const isDefault = isDefaultLoginId(id)

      let program
      try {
        program = find(provider, { env: context.env })
      } catch (error) {
        if (error instanceof ProgramNotFoundError) return fail(context, error.message)
        throw error
      }

      const folder = isDefault ? null : loginFolder(id)
      let created = false
      if (folder !== null && !existsSync(folder)) {
        makePrivateDirSync(folder)
        created = true
      }
      const cleanUp = (): void => {
        if (created && folder !== null) removeTreeSync(folder)
      }
      const notAdded = isNew ? ` ${id} was not added.` : ''

      const cliName = provider === 'claude' ? 'claude auth login' : 'codex login'
      writeLine(context.stdout, `Signing in ${id}${isNew ? ' (a new login)' : ''} with "${cliName}". Follow its steps.`)
      const env = applyEnvPatch(context.env, provider === 'claude' ? claudeLoginEnv(id) : codexLoginEnv(id))
      const cliArgs = provider === 'claude' ? ['auth', 'login', '--claudeai'] : ['login']
      const end = await runner.runInteractive({ command: program.command, args: [...program.args, ...cliArgs], env })

      if (end.kind !== 'exit') {
        cleanUp()
        // Before `finishLikeChild`, which raises the child's signal on this process.
        if (isNew) writeLine(context.stderr, `kurmis login:${notAdded}`)
        return runner.finishLikeChild(end, { stderr: context.stderr, name: provider })
      }
      if (end.code !== 0) {
        cleanUp()
        return fail(context, `"${cliName}" failed (exit code ${String(end.code)}).${notAdded}`)
      }

      const identity = provider === 'claude' ? (isDefault ? homeIdentity(home()) : readClaudeIdentity(id, home())) : null
      if (identity === null && !hasLocalCredentials(id, context.env, home())) {
        cleanUp()
        return fail(context, `"${cliName}" ended, but ${id} has no credentials.${notAdded}`)
      }

      try {
        const patch: LoginSettingsPatch = label === undefined ? {} : { label }
        if (isNew) changeConfig((config) => addLogin(config, id, patch))
        else if (label !== undefined) changeConfig((config) => updateLogin(config, id, patch))
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error
        // The login is signed in, so its credentials are kept; logout removes them.
        return fail(context, `${id} is signed in but could not be saved: ${error.message} ` +
          `Run "kurmis login ${id}" again, or "kurmis logout ${id}" to remove its credentials.`)
      }

      const who = identity?.email ?? null
      writeLine(context.stdout, who === null ? `Signed in ${id}.` : `Signed in ${id} as ${who}.`)
      if (isNew) {
        writeLine(context.stdout, `Added ${id} with the label "${label ?? id.slice(id.indexOf(':') + 1)}", Auto routing on and both limits at 100%. ` +
          `"kurmis set ${id}" changes that.`)
      }
      const reload = reloadText(await reloadIfRunning(daemon, context.env))
      if (reload !== null) writeLine(context.stdout, reload)
      return EXIT_OK
    }
  }
}

export const loginCommand = createLoginCommand()
