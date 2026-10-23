// Signing an extra login out with `claude auth logout`, run on the login's folder the way
// `kurmis login` ran the sign-in, before the folder is deleted. claude removes what it keeps
// outside the folder: on macOS the Keychain item, on Windows the Credential Manager record,
// which Claude Code deletes only with `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`, so that is set
// there. `kurmis logout` uses it, and so does `kurmis login` when the account it signed in is
// already a kurmis login.
import { keychainService } from '../core/keychain-service.ts'
import { applyEnvPatch } from '../core/routed-env.ts'
import { claudeLoginEnv } from '../data/login-env.ts'
import type { LoginRef } from '../data/login-id.ts'
import { loginFolder } from '../data/paths.ts'
import { ProgramNotFoundError, type ProgramFinder } from '../platform/programs.ts'
import type { runProgram } from '../platform/run.ts'

/** How long `claude auth logout` may take. It removes local files and items and revokes the token. */
const LOGOUT_TIMEOUT_MS = 30_000

export interface SignOutDeps {
  findProgram: ProgramFinder
  runProgram: typeof runProgram
  platform: NodeJS.Platform
}

/**
 * Runs `claude auth logout` on the extra login `login`. Answers null when it exited 0, and
 * otherwise the start of a sentence saying what went wrong, to which the caller adds what it
 * does anyway and `leftBehindText`.
 */
export async function signOutLogin(login: LoginRef, env: NodeJS.ProcessEnv, deps: SignOutDeps): Promise<string | null> {
  let problem: string
  try {
    const program = await deps.findProgram({ env })
    // On Windows claude deletes the record in Credential Manager only with the switch on.
    const patch = claudeLoginEnv(login, deps.platform === 'win32')
    const result = await deps.runProgram(program.command, [...program.args, 'auth', 'logout'],
      { timeoutMs: LOGOUT_TIMEOUT_MS, env: applyEnvPatch(env, patch) })
    if (result.code === 0) return null
    problem = result.error ?? `exit code ${String(result.code)}`
  } catch (error) {
    if (!(error instanceof ProgramNotFoundError)) throw error
    problem = error.message
  }
  return `"claude auth logout" did not finish (${problem})`
}

/** The sentence about the Keychain item or Credential Manager record a failed logout may leave, or '' where there is none to name. */
export function leftBehindText(login: LoginRef, platform: NodeJS.Platform): string {
  const service = keychainService(loginFolder(login))
  if (platform === 'darwin') return ` Its Keychain item "${service}" may be left; Keychain Access can delete it.`
  if (platform === 'win32') return ` Its Windows credentials "${service}/…" may be left; Credential Manager can delete them.`
  return ''
}
