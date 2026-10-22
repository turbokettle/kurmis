// `kurmis logout <login>`: removes an extra login, named by its alias or id (`resolveLogin`). In
// this order:
//
// 1. The login is removed from config.json (under the config lock) and a running daemon is told,
//    so it stops routing to the login and probing it before its folder goes.
// 2. `claude auth logout` or `codex logout` runs on the login (`signOutLogin` in `sign-out.ts`),
//    so the CLI removes what it keeps outside the folder (on macOS the Keychain item, on Windows
//    the Credential Manager record). A logout CLI that fails or is missing is reported and the
//    removal goes on: the person asked for the login to be gone, and the credentials file, where
//    there is one, goes with the folder anyway. On macOS and Windows the message names the item
//    that may be left.
// 3. The login's folder is deleted without following links out of it (`removeTreeSync`): a
//    Codex home links into `~/.codex`, and only the links are removed. For a Codex login the
//    record of what was last merged into its home (`codexMergedRecordPath`) goes too.
//
// A bare id that names no login in config.json but has a folder, `claude/<id>/` or `codex/<id>/`
// (a removal or a sign-in that stopped half-way), is cleaned up the same way. A Codex id of which
// only the merged record is left has the record deleted.
//
// The whole removal holds the login's lock (`login-lock.ts`), so it never runs while a
// `kurmis login` of the same login writes into the folder.
//
// `kurmis setup --uninstall-and-logout` removes each login through `createLoginLogout` too, with
// `keepWhenSignOutFails`. Then the logout CLI runs first, while the login is still in config.json,
// and when it fails nothing is removed: the login stays in config.json and its folder stays, so
// that running the uninstall again finds the login and runs the logout CLI again. The folder's
// path is what names the Keychain item. The message names the way out when the logout CLI can
// never finish: `kurmis logout <id>` removes the login anyway.
import { lstatSync, rmSync } from 'node:fs'
import { changeConfig, ConfigError, findLogin, loadConfig, removeLogin, resolveLogin, type KurmisConfig } from '../../data/config.ts'
import { isLoginId, isLoginProvider, LOGIN_PROVIDERS, type LoginRef } from '../../data/login-id.ts'
import { codexMergedRecordPath, loginFolder } from '../../data/paths.ts'
import { type findProgram } from '../../platform/programs.ts'
import { removeTreeSync } from '../../platform/remove-tree.ts'
import { runProgram } from '../../platform/run.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { realDaemonClient, realFindProgram, reloadIfRunning, reloadText, type DaemonClient } from '../command-deps.ts'
import { LoginBusyError, lockLogin } from '../login-lock.ts'
import { plainCliLoginText } from '../login-names.ts'
import { leftBehindText, signOutLogin } from '../sign-out.ts'

export { LOGOUT_TIMEOUT_MS } from '../sign-out.ts'

export interface LogoutDeps {
  daemon: DaemonClient
  findProgram: typeof findProgram
  runProgram: typeof runProgram
  platform: NodeJS.Platform
}

export interface LogoutOptions {
  /**
   * Run the logout CLI before the login is taken out of config.json, and when it does not
   * finish, remove nothing and answer `EXIT_FAILURE`: the login stays in config.json, when it is
   * there, and its folder stays, when it has one. So running `again` runs the logout CLI again.
   * Without it, the login is removed anyway and the removal counts as done.
   */
  keepWhenSignOutFails?: boolean
  /** The command that tries again, named in the messages. `kurmis logout <id>` by default. */
  again?: string
  /** What each error message starts with. `kurmis logout` by default. */
  prefix?: string
}

/**
 * Removes the extra login `login` while holding its lock, and says what it did: the login in
 * config.json with that id and provider, or the folder of that id that is left without one.
 * Answers the exit code.
 */
export type LoginLogout = (login: LoginRef, context: CliContext, options?: LogoutOptions) => Promise<number>

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function fail(context: CliContext, message: string, prefix = 'kurmis logout'): number {
  writeLine(context.stderr, `${prefix}: ${message}`)
  return EXIT_FAILURE
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createLoginLogout(deps: Partial<LogoutDeps> = {}): LoginLogout {
  const daemon = deps.daemon ?? realDaemonClient
  const signOutDeps = {
    findProgram: deps.findProgram ?? realFindProgram,
    runProgram: deps.runProgram ?? runProgram,
    platform: deps.platform ?? process.platform
  }

  async function removeNow(login: LoginRef, context: CliContext, options: LogoutOptions): Promise<number> {
    const { id } = login
    const again = options.again ?? `kurmis logout ${id}`
    const prefix = options.prefix ?? 'kurmis logout'
    const keep = options.keepWhenSignOutFails === true
    const folder = loginFolder(login)
    let name: string = id
    let listed = false
    try {
      // Read again under the login's lock: another run may have removed it in the meantime.
      const found = findLogin(loadConfig(), id)
      if (found?.usedByPlainCli === true) return fail(context, `${found.alias} is ${plainCliLoginText(found.provider)} and cannot be removed.`, prefix)
      if (found !== undefined && found.provider === login.provider) {
        listed = true
        name = found.alias
      }
    } catch (error) {
      if (error instanceof ConfigError) return fail(context, error.message, prefix)
      throw error
    }
    const hasFolder = exists(folder)
    if (!listed && !hasFolder) {
      // A sign-in of a new Codex login that stopped half-way can leave only the record of what
      // was merged into its home.
      const record = login.provider === 'codex' ? codexMergedRecordPath(login) : null
      if (record === null || !exists(record)) return fail(context, `there is no login ${id}; "kurmis status" shows the logins`, prefix)
      rmSync(record, { force: true })
      writeLine(context.stdout, `Deleted the record of what was merged into the Codex home of ${id}, which ${id} left behind.`)
      return EXIT_OK
    }

    let reload: string | null = null
    /** Takes the login out of config.json and tells a running daemon. Answers an exit code when that failed. */
    const unlist = async (): Promise<number | null> => {
      if (!listed) return null
      try {
        changeConfig((config) => findLogin(config, id) === undefined ? config : removeLogin(config, id))
      } catch (error) {
        if (error instanceof ConfigError) return fail(context, error.message, prefix)
        throw error
      }
      reload = reloadText(await reloadIfRunning(daemon, context.env))
      return null
    }

    if (!keep) {
      const failed = await unlist()
      if (failed !== null) return failed
    }
    // Claude on macOS keeps the secret in the Keychain, so the logout of a listed Claude login
    // runs even when its folder is gone.
    if (hasFolder || login.provider === 'claude') {
      const problem = await signOutLogin(login, context.env, signOutDeps)
      if (problem !== null) {
        const left = leftBehindText(login, signOutDeps.platform)
        if (keep) {
          const kept = listed
            ? `${name} stays in kurmis${hasFolder ? ` with its folder ${folder}` : ''}`
            : `Its folder ${folder} is kept`
          const cli = login.provider === 'claude' ? 'claude' : 'codex'
          const wayOut = `If that cannot work, for example because ${cli} is not installed, "kurmis logout ${id}" removes ` +
            `${name} and its folder without signing it out${left === '' ? '' : ', which leaves the item named above'}.`
          return fail(context, `${problem}.${left} ${kept}, so that "${again}" runs it again. ${wayOut}`, prefix)
        }
        writeLine(context.stderr, `${prefix}: ${problem}; ${name} is removed anyway.${left}`)
      }
    }
    if (keep) {
      const failed = await unlist()
      if (failed !== null) return failed
    }
    try {
      removeTreeSync(folder)
      if (login.provider === 'codex') rmSync(codexMergedRecordPath(login), { force: true })
    } catch (error) {
      const problem = `its folder ${folder} could not be deleted (${errorText(error)})`
      // The id still names the folder; the alias is gone with the login.
      return fail(context, listed
        ? `${name} is removed from kurmis, but ${problem}. Close what uses it and run "${again}".`
        : `${id} left a folder behind, but ${problem}. Close what uses it and run "${again}" again.`, prefix)
    }
    writeLine(context.stdout, listed ? `Removed ${name} (id ${id}).` : `Deleted the folder that ${id} left behind.`)
    if (reload !== null) writeLine(context.stdout, reload)
    return EXIT_OK
  }

  return async (login, context, options = {}) => {
    const prefix = options.prefix ?? 'kurmis logout'
    if (login.usedByPlainCli) return fail(context, `${login.id} is ${plainCliLoginText(login.provider)} and cannot be removed.`, prefix)
    let name: string
    try {
      name = findLogin(loadConfig(), login.id)?.alias ?? login.id
    } catch (error) {
      if (error instanceof ConfigError) return fail(context, error.message, prefix)
      throw error
    }
    let lock
    try {
      lock = lockLogin(login.id, name)
    } catch (error) {
      if (error instanceof LoginBusyError) return fail(context, error.message, prefix)
      throw error
    }
    try {
      return await removeNow(login, context, options)
    } finally {
      lock.release()
    }
  }
}

/** What `kurmis logout` was asked to remove. */
type LogoutTarget =
  /** A login in config.json, or the folders of an id that is in config.json no more. */
  | { kind: 'logins'; logins: LoginRef[] }
  | { kind: 'error'; message: string; usage: boolean }

/**
 * The login `text` names, or, for a bare id (or `claude:<id>`, `codex:<id>`) that names no login,
 * the folders it left behind.
 */
function logoutTarget(config: KurmisConfig, text: string): LogoutTarget {
  const resolved = resolveLogin(config, text)
  if ('login' in resolved) {
    const login = resolved.login
    if (login.usedByPlainCli) {
      const cli = login.provider === 'claude' ? 'claude auth logout' : 'codex logout'
      return {
        kind: 'error',
        usage: true,
        message: `${login.alias} is ${plainCliLoginText(login.provider)} and cannot be removed. To sign it out, run "${cli}" yourself.`
      }
    }
    return { kind: 'logins', logins: [{ id: login.id, provider: login.provider, usedByPlainCli: false }] }
  }
  // Read as `resolveLogin` reads it.
  const typed = text.trim().toLowerCase()
  const colon = typed.indexOf(':')
  const prefix = colon < 0 ? null : typed.slice(0, colon)
  const id = colon < 0 ? typed : typed.slice(colon + 1)
  const providers = prefix === null ? LOGIN_PROVIDERS : isLoginProvider(prefix) ? [prefix] : []
  if (isLoginId(id) && findLogin(config, id) === undefined) {
    const refs = providers.map((provider): LoginRef => ({ id, provider, usedByPlainCli: false }))
    const withFolder = refs.filter((login) => exists(loginFolder(login)))
    if (withFolder.length > 0) return { kind: 'logins', logins: withFolder }
    const recordOnly = refs.filter((login) => login.provider === 'codex' && exists(codexMergedRecordPath(login)))
    if (recordOnly.length > 0) return { kind: 'logins', logins: recordOnly }
  }
  return { kind: 'error', usage: false, message: `${resolved.error}; "kurmis status" shows the logins` }
}

export function createLogoutCommand(deps: Partial<LogoutDeps> = {}): Command {
  const logOut = createLoginLogout(deps)
  return {
    name: 'logout',
    summary: 'Remove a login and its credentials',
    usage: `Usage: kurmis logout <login>

Signs a login out and removes it from kurmis. A running daemon stops using it at once.

<login> is an alias or id that "kurmis status" shows. When a Claude login and a Codex login
have the same alias, put claude: or codex: in front, for example codex:work-example.

The logins plain claude and plain codex use cannot be removed. To sign them out, run
"claude auth logout" or "codex logout".

Options:
  -h, --help   Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs('logout', args, {}, context, true)
      if (typeof parsed === 'number') return parsed
      if (parsed.positionals.length !== 1) return usageError('logout', 'takes one login, by its alias or id', context)

      let target: LogoutTarget
      try {
        target = logoutTarget(loadConfig(), parsed.positionals[0]!)
      } catch (error) {
        if (error instanceof ConfigError) return fail(context, error.message)
        throw error
      }
      if (target.kind === 'error') return target.usage ? usageError('logout', target.message, context) : fail(context, target.message)
      for (const login of target.logins) {
        const code = await logOut(login, context)
        if (code !== EXIT_OK) return code
      }
      return EXIT_OK
    }
  }
}

export const logoutCommand = createLogoutCommand()
