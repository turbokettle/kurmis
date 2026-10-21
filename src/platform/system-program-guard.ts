// A guard that keeps the tests from starting real system programs.
//
// `test/setup.ts` and the integration harness set `KURMIS_REFUSE_SYSTEM_PROGRAMS=1`. While it is
// set, every place kurmis starts a program (`runProgram`, `startFrameProcess`, `spawnDetached`,
// the wrapper) refuses a program whose file name is one of `GUARDED_PROGRAMS`: the macOS and
// Windows programs that change the machine or read secrets, and the real Claude and Codex
// CLIs. Stand-ins are `.js` or `.mjs` files run through Node, so they still start. The guard
// is read from this process's environment and from the environment a program is given, and it
// is added to the environment of every program started while it is on, so a kurmis process
// that a test starts with an environment of its own (a daemon, a launchd job's command) keeps
// it. A person never sets it.
//
// Refusing is the last line of defence: the stand-ins of `system-programs.ts` are meant to be
// reached first. So each refusal is also written, as the program's path on a line of its own,
// to the file `KURMIS_REFUSED_PROGRAMS_LOG` names, which `test/setup.ts` sets and checks after
// every test: a test whose code reached a real program fails, even when the refusal let it pass.
import { appendFileSync } from 'node:fs'
import { basename } from 'node:path'

export const GUARD_VARIABLE = 'KURMIS_REFUSE_SYSTEM_PROGRAMS'

/** The file each refusal is recorded in, when set. */
export const REFUSAL_LOG_VARIABLE = 'KURMIS_REFUSED_PROGRAMS_LOG'

/** File names, lowercase and without `.exe`, that are refused while the guard is on. */
export const GUARDED_PROGRAMS: ReadonlySet<string> = new Set([
  'launchctl',
  'security',
  'powershell',
  'pwsh',
  'reg',
  'taskkill',
  'wscript',
  'cscript',
  'wmic',
  'schtasks',
  'claude',
  'codex'
])

/** Whether the guard is on, in this process's environment or in `env`. */
export function guardOn(env?: NodeJS.ProcessEnv): boolean {
  return process.env[GUARD_VARIABLE] === '1' || env?.[GUARD_VARIABLE] === '1'
}

/** Why `command` may not be started, or null when it may. */
export function refusedByGuard(command: string, env?: NodeJS.ProcessEnv): string | null {
  if (!guardOn(env)) return null
  const name = basename(command.replaceAll('\\', '/')).toLowerCase().replace(/\.exe$/, '')
  if (!GUARDED_PROGRAMS.has(name)) return null
  recordRefusal(command, env)
  return `${command} is a real system program, which kurmis does not start while ${GUARD_VARIABLE}=1 (tests)`
}

function refusalLog(env?: NodeJS.ProcessEnv): string | undefined {
  const named = env?.[REFUSAL_LOG_VARIABLE] || process.env[REFUSAL_LOG_VARIABLE]
  return named === undefined || named === '' ? undefined : named
}

function recordRefusal(command: string, env?: NodeJS.ProcessEnv): void {
  const log = refusalLog(env)
  if (log === undefined) return
  try {
    appendFileSync(log, `${command}\n`, 'utf8')
  } catch {
    // The test's temporary folder is gone; the refusal itself still stands.
  }
}

/** `env` with the guard (and the refusal log, when set) added when it is on; `env` itself otherwise. */
export function withGuard(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv | undefined {
  if (!guardOn(env)) return env
  const log = refusalLog(env)
  return { ...(env ?? process.env), [GUARD_VARIABLE]: '1', ...(log === undefined ? {} : { [REFUSAL_LOG_VARIABLE]: log }) }
}
