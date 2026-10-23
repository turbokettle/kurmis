// Where kurmis keeps its files. Every path is computed when it is asked for, so a test that
// changes KURMIS_HOME or HOME sees the change.
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { toLoginId, type LoginRef } from './login-id.ts'

/**
 * The data folder: `KURMIS_HOME` when it is set and not empty, otherwise `.kurmis` in the
 * user's home folder (`~/.kurmis`, or `%USERPROFILE%\.kurmis` on Windows, which is what
 * `os.homedir()` returns there). A relative `KURMIS_HOME` is taken from the current folder.
 */
export function kurmisHome(): string {
  const override = process.env.KURMIS_HOME
  if (override !== undefined && override !== '') return resolve(override)
  return join(homedir(), '.kurmis')
}

/** The logins and their routing settings. */
export function configPath(): string {
  return join(kurmisHome(), 'config.json')
}

/** The running daemon's pid, port and version. */
export function daemonFilePath(): string {
  return join(kurmisHome(), 'daemon.json')
}

/** The key every proxied and control request carries. Kept across daemon restarts. */
export function keyPath(): string {
  return join(kurmisHome(), 'key')
}

/** The daemon's usage snapshots, cooldowns and session placements. */
export function statePath(): string {
  return join(kurmisHome(), 'state.json')
}

export function logPath(): string {
  return join(kurmisHome(), 'daemon.log')
}

/** The log as it was before its last rotation. */
export function previousLogPath(): string {
  return join(kurmisHome(), 'daemon.log.1')
}

/** The lock file `config.json`'s read-modify-write takes, so two CLIs do not lose each other's change. */
export function configLockPath(): string {
  return join(kurmisHome(), 'config.json.lock')
}

/**
 * The config folder (`CLAUDE_CONFIG_DIR`) of the usage probe of plain claude's login.
 * A probe on the user's own `~/.claude` would walk its transcripts and write into
 * `~/.claude.json`, so it gets this folder instead, and its credentials are pointed back at the
 * default place with an empty `CLAUDE_SECURESTORAGE_CONFIG_DIR` (`claudeProbeEnv` in
 * `login-env.ts`). The CLI caches the login's profile in `.claude.json` here, which is where the
 * daemon reads that login's account uuid and email.
 */
export function ownClaudeProbeFolder(): string {
  return join(kurmisHome(), 'probe', 'claude-own')
}

/**
 * The settings files `kurmis claude` passes to claude with `--settings`. They hold the daemon's
 * key, so they live here, readable by the user only, rather than on claude's command line, where
 * other users of the machine could read it in the process list.
 */
export function wrapperSettingsFolder(): string {
  return join(kurmisHome(), 'settings')
}

/** An empty folder the usage probes run in, so they read no project's settings. */
export function probeWorkFolder(): string {
  return join(kurmisHome(), 'probe', 'cwd')
}

/** The script the Windows logon entry runs to start the daemon without a console window. */
export function windowsAutostartScriptPath(): string {
  return join(kurmisHome(), 'autostart.js')
}

/** Exists while global routing is paused (`kurmis setup --pause`). */
export function pausedFilePath(): string {
  return join(kurmisHome(), 'paused.json')
}

/**
 * The Claude Code settings files `kurmis setup` put kurmis' settings into, so that
 * `setup --pause`, `setup --uninstall-and-logout` and `kurmis status` look at each of them,
 * whatever `CLAUDE_CONFIG_DIR` says in the shell they run in.
 */
export function setupSettingsRecordPath(): string {
  return join(kurmisHome(), 'settings-files.json')
}

/** The folder that holds the folders of the extra logins: `claude/`. */
export function extraLoginsFolder(): string {
  return join(kurmisHome(), 'claude')
}

/**
 * The folder of an extra login: `claude/<id>/`, its `CLAUDE_SECURESTORAGE_CONFIG_DIR`. The id is
 * checked again here, so a slash or `..` can never produce a path. The login of plain claude has
 * no folder here, since it uses `~/.claude`; asking for it is an error.
 */
export function loginFolder(login: LoginRef): string {
  const id = toLoginId(login.id)
  if (login.usedByPlainClaude) {
    throw new Error(`${id} is the login plain claude uses and has no folder in the kurmis data folder.`)
  }
  return join(extraLoginsFolder(), id)
}

/**
 * The lock file that one `kurmis login` or `kurmis logout` of a login holds while it runs
 * (`src/cli/login-lock.ts`): `locks/<id>.lock`. It is outside the login's folder, because the
 * folder is created and deleted under it.
 */
export function loginLockPath(id: string): string {
  return join(kurmisHome(), 'locks', `${toLoginId(id)}.lock`)
}
