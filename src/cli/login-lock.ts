// One `kurmis login` or `kurmis logout` at a time per login. A sign-in can take minutes (the
// person signs in in the browser), and two runs for the same login would share its folder: a
// run that failed would delete the folder, and with it the credentials another run had just
// written, and a logout could delete the folder while a sign-in writes into it. So both
// commands hold the login's lock file (`loginLockPath`) from before they create or delete its
// folder until they are done, and a second run for the same login stops at once with a message
// instead of waiting.
//
// The lock is the one in `src/data/lock.ts`. It is stale, and is taken over, when the pid in it
// no longer runs, which is what a killed run leaves; and after `LOGIN_LOCK_STALE_MS`, in case
// that pid was reused by another program.
import { acquireFileLockSync, LockTimeoutError, type FileLock } from '../data/lock.ts'
import { loginLockPath } from '../data/paths.ts'

/** How long a sign-in may hold its lock before another run may take it: longer than anyone takes to sign in. */
export const LOGIN_LOCK_STALE_MS = 24 * 60 * 60 * 1000

/** Long enough to remove a stale lock and take it, short enough that a busy login answers at once. */
const LOGIN_LOCK_WAIT_MS = 500

/** Another `kurmis login` or `kurmis logout` of the same login is running. */
export class LoginBusyError extends Error {
  constructor(readonly id: string, readonly path: string, pid: number | null) {
    super(`another "kurmis login" or "kurmis logout" of ${id} is running now${pid === null ? '' : ` (pid ${String(pid)})`}. ` +
      `Wait for it to end and try again. If none is running, delete ${path}.`)
    this.name = 'LoginBusyError'
  }
}

/** Takes the lock of login `id`, or throws `LoginBusyError` when another run holds it. */
export function lockLogin(id: string): FileLock {
  const path = loginLockPath(id)
  try {
    return acquireFileLockSync(path, { timeoutMs: LOGIN_LOCK_WAIT_MS, staleMs: LOGIN_LOCK_STALE_MS })
  } catch (error) {
    if (error instanceof LockTimeoutError) throw new LoginBusyError(id, path, error.holder?.pid ?? null)
    throw error
  }
}
