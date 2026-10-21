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
// `kurmis setup --uninstall-and-logout` removes each login through `createLoginLogout` too. It
// asks for the folder to be kept when the logout CLI fails, so that running it again finds the
// folder and runs the logout CLI again: the folder's path is what names the Keychain item.
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
import { machineOwnText } from '../login-names.ts'
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
   * When the logout CLI does not finish, keep the login's folder and answer `EXIT_FAILURE`, so
   * that running the command again runs the logout CLI again. Without it the folder is deleted
   * anyway and the removal counts as done.
   */
  keepFolderWhenSignOutFails?: boolean
  /** The command that tries again, named in the messages. `kurmis logout <id>` by default. */
  again?: string
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

function fail(context: CliContext, message: string): number {
  writeLine(context.stderr, `kurmis logout: ${message}`)
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
    const folder = loginFolder(login)
    let name: string = id
    let listed = false
    try {
      // Read again under the login's lock: another run may have removed it in the meantime.
      const found = findLogin(loadConfig(), id)
      if (found?.machineOwn === true) return fail(context, `${found.alias} is ${machineOwnText(found.provider)} and cannot be removed.`)
      if (found !== undefined && found.provider === login.provider) {
        listed = true
        name = found.alias
        changeConfig((config) => removeLogin(config, id))
      }
    } catch (error) {
      if (error instanceof ConfigError) return fail(context, error.message)
      throw error
    }
    const hasFolder = exists(folder)
    if (!listed && !hasFolder) {
      // A sign-in of a new Codex login that stopped half-way can leave only the record of what
      // was merged into its home.
      const record = login.provider === 'codex' ? codexMergedRecordPath(login) : null
      if (record === null || !exists(record)) return fail(context, `there is no login ${id}; "kurmis list" shows the logins`)
      rmSync(record, { force: true })
      writeLine(context.stdout, `Deleted the record of what was merged into the Codex home of ${id}, which ${id} left behind.`)
      return EXIT_OK
    }
    const reload = listed ? reloadText(await reloadIfRunning(daemon, context.env)) : null

    // Claude on macOS keeps the secret in the Keychain, so the logout of a listed Claude login
    // runs even when its folder is gone.
    if (hasFolder || login.provider === 'claude') {
      const problem = await signOutLogin(login, context.env, signOutDeps)
      if (problem !== null) {
        const left = leftBehindText(login, signOutDeps.platform)
        if (options.keepFolderWhenSignOutFails === true && hasFolder) {
          if (reload !== null) writeLine(context.stdout, reload)
          const kept = listed ? ` ${name} is removed from kurmis, but its folder` : ' Its folder'
          return fail(context, `${problem}.${left}${kept} ${folder} is kept, so that "${again}" runs it again.`)
        }
        writeLine(context.stderr, `kurmis logout: ${problem}; ${name} is removed anyway.${left}`)
      }
    }
    try {
      removeTreeSync(folder)
      if (login.provider === 'codex') rmSync(codexMergedRecordPath(login), { force: true })
    } catch (error) {
      const problem = `its folder ${folder} could not be deleted (${errorText(error)})`
      // The id still names the folder; the alias is gone with the login.
      return fail(context, listed
        ? `${name} is removed from kurmis, but ${problem}. Close what uses it and run "${again}".`
        : `${id} left a folder behind, but ${problem}. Close what uses it and run "${again}" again.`)
    }
    writeLine(context.stdout, listed ? `Removed ${name} (id ${id}).` : `Deleted the folder that ${id} left behind.`)
    if (reload !== null) writeLine(context.stdout, reload)
    return EXIT_OK
  }

  return async (login, context, options = {}) => {
    if (login.machineOwn) return fail(context, `${login.id} is ${machineOwnText(login.provider)} and cannot be removed.`)
    let name: string
    try {
      name = findLogin(loadConfig(), login.id)?.alias ?? login.id
    } catch (error) {
      if (error instanceof ConfigError) return fail(context, error.message)
      throw error
    }
    let lock
    try {
      lock = lockLogin(login.id, name)
    } catch (error) {
      if (error instanceof LoginBusyError) return fail(context, error.message)
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
    if (login.machineOwn) {
      const cli = login.provider === 'claude' ? 'claude auth logout' : 'codex logout'
      return {
        kind: 'error',
        usage: true,
        message: `${login.alias} is ${machineOwnText(login.provider)} and cannot be removed. To sign it out, run "${cli}" yourself.`
      }
    }
    return { kind: 'logins', logins: [{ id: login.id, provider: login.provider, machineOwn: false }] }
  }
  const colon = text.indexOf(':')
  const prefix = colon < 0 ? null : text.slice(0, colon)
  const id = colon < 0 ? text : text.slice(colon + 1)
  const providers = prefix === null ? LOGIN_PROVIDERS : isLoginProvider(prefix) ? [prefix] : []
  if (isLoginId(id) && findLogin(config, id) === undefined) {
    const refs = providers.map((provider): LoginRef => ({ id, provider, machineOwn: false }))
    const withFolder = refs.filter((login) => exists(loginFolder(login)))
    if (withFolder.length > 0) return { kind: 'logins', logins: withFolder }
    const recordOnly = refs.filter((login) => login.provider === 'codex' && exists(codexMergedRecordPath(login)))
    if (recordOnly.length > 0) return { kind: 'logins', logins: recordOnly }
  }
  return { kind: 'error', usage: false, message: `${resolved.error}; "kurmis list" shows the logins` }
}

export function createLogoutCommand(deps: Partial<LogoutDeps> = {}): Command {
  const logOut = createLoginLogout(deps)
  return {
    name: 'logout',
    summary: 'Remove a login and its credentials',
    usage: `Usage: kurmis logout <login>

Signs a login out with "claude auth logout" or "codex logout", removes it from kurmis and
deletes its folder in the kurmis data folder. A running daemon stops using it at once.

<login> is the login's alias or its id, as "kurmis list" shows them. When a Claude login and a
Codex login have the same alias, put claude: or codex: in front, for example
codex:work-example.

The logins of plain claude and plain codex cannot be removed. To sign them out, run
"claude auth logout" or "codex logout" yourself.

An id that is in no list any more but still has a folder in the kurmis data folder, for
example after a removal that stopped half-way, has that folder deleted.

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
