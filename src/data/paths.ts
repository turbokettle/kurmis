// Where kurmis keeps its files. Every path is computed when it is asked for, so a test that
// changes KURMIS_HOME or HOME sees the change.
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  isDefaultLoginId,
  nameOfLoginId,
  providerOfLoginId,
  toLoginId,
  type LoginProvider
} from './login-id.ts'

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
 * The config folder (`CLAUDE_CONFIG_DIR`) of the usage probe of `claude:default`. A probe on the
 * user's own `~/.claude` would walk its transcripts and write into `~/.claude.json`, so it gets
 * this folder instead, and its credentials are pointed back at the default place with an empty
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR` (`claudeProbeEnv` in `login-env.ts`). The CLI caches the
 * login's profile in `.claude.json` here, which is where the daemon reads the default login's
 * account uuid.
 */
export function claudeDefaultProbeFolder(): string {
  return join(kurmisHome(), 'probe', 'claude-default')
}

/** An empty folder the usage probes run in, so they read no project's settings. */
export function probeWorkFolder(): string {
  return join(kurmisHome(), 'probe', 'cwd')
}

/**
 * The plists of the short-lived launchd jobs that start the daemon from an ssh login on macOS
 * (`src/platform/launchd.ts`). Each is removed once its job has run.
 */
export function launchdJobFolder(): string {
  return join(kurmisHome(), 'launchd')
}

/** The script the Windows logon entry runs to start the daemon without a console window. */
export function windowsAutostartScriptPath(): string {
  return join(kurmisHome(), 'autostart.vbs')
}

/** The folder that holds the extra logins of one provider: `claude/` or `codex/`. */
export function providerFolder(provider: LoginProvider): string {
  return join(kurmisHome(), provider)
}

/**
 * The folder of an extra login: `claude/<name>/` (its `CLAUDE_SECURESTORAGE_CONFIG_DIR`) or
 * `codex/<name>/` (its `CODEX_HOME`). The id is checked again here, so a name with a slash or
 * `..` in it can never produce a path. The default logins have no folder here, since they use
 * the machine's own `~/.claude` and `~/.codex`; asking for one is an error.
 */
export function loginFolder(id: string): string {
  const checked = toLoginId(id)
  if (isDefaultLoginId(checked)) {
    throw new Error(`${checked} is the machine's own login and has no folder in the kurmis data folder.`)
  }
  return join(providerFolder(providerOfLoginId(checked)), nameOfLoginId(checked))
}
