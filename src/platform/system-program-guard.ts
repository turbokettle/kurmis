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
import { basename } from 'node:path'

export const GUARD_VARIABLE = 'KURMIS_REFUSE_SYSTEM_PROGRAMS'

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
  return `${command} is a real system program, which kurmis does not start while ${GUARD_VARIABLE}=1 (tests)`
}

/** `env` with the guard added when it is on; `env` itself otherwise. */
export function withGuard(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv | undefined {
  if (!guardOn(env)) return env
  return { ...(env ?? process.env), [GUARD_VARIABLE]: '1' }
}
