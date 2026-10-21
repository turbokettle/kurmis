// A guard that keeps the tests from starting real system programs.
//
// `test/setup.ts` and the integration harness set `KURMIS_REFUSE_SYSTEM_PROGRAMS=1`. While it is
// set, every place kurmis starts a program (`runProgram`, `startFrameProcess`, `spawnDetached`,
// the wrapper) refuses:
// - a program whose file name, or the file name its links lead to, is one of `GUARDED_PROGRAMS`:
//   the macOS and Windows programs that change the machine or read secrets, `cmd`, and the real
//   Claude and Codex CLIs;
// - a program inside the Claude Code or Codex npm packages or the folder Claude Code's native
//   installer keeps its versions in (`REAL_CLI_PATHS`);
// - Node running a script that is one of those, such as `node .../@openai/codex/bin/codex.js`,
//   which is how a `codex` on PATH that links to a `.js` file is started (`programs.ts`).
// Stand-ins are `.js` or `.mjs` files with other names, run through Node, so they still start.
//
// The guard is read from this process's environment and from the environment a program is
// given, and while it is on it is added to the environment of every program kurmis starts,
// together with `TEST_HOME_VARIABLES` when that environment lacks them. So a kurmis process that
// a test starts with an environment of its own (a daemon, a launchd job's command) keeps the
// guard, uses the test's temporary home rather than the real one, and finds the fake or failing
// `claude` and `codex` that `test/setup.ts` names. A person never sets it.
//
// Refusing is the last line of defence: the stand-ins of `system-programs.ts` are meant to be
// reached first. So each refusal is also written, as the program's path on a line of its own,
// to the file `KURMIS_REFUSED_PROGRAMS_LOG` names, which `test/setup.ts` sets and checks after
// every test: a test whose code reached a real program fails, even when the refusal let it pass.
import { appendFileSync, realpathSync } from 'node:fs'
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
  'cmd',
  'claude',
  'codex'
])

/** Whether the guard is on, in this process's environment or in `env`. */
export function guardOn(env?: NodeJS.ProcessEnv): boolean {
  return process.env[GUARD_VARIABLE] === '1' || env?.[GUARD_VARIABLE] === '1'
}

/**
 * Paths, with `/` as the separator and in lower case, that hold the real Claude Code or Codex:
 * their npm packages (also the per-platform ones such as `@openai/codex-darwin-arm64`) and the
 * folder of Claude Code's native installer (`~/.local/share/claude/versions/<version>`).
 */
export const REAL_CLI_PATHS: readonly RegExp[] = [
  /\/@anthropic-ai\/claude-code[^/]*\//,
  /\/@openai\/codex[^/]*\//,
  /\/\.local\/share\/claude\/versions\//
]

/**
 * Variables a program started while the guard is on gets from this process's environment when
 * its own environment lacks them: the test's temporary home (`test/setup.ts`), the programs
 * kurmis runs as `claude` and `codex`, and the API address that stands in for Anthropic's, so
 * a daemon a test starts with an environment of its own never reaches the network.
 */
export const TEST_HOME_VARIABLES: readonly string[] = ['HOME', 'USERPROFILE', 'KURMIS_HOME', 'KURMIS_CLAUDE_BIN', 'KURMIS_CODEX_BIN',
  'KURMIS_UPSTREAM_URL']

/**
 * Why `command` with `args` may not be started, or null when it may. `args` matter when
 * `command` is Node: then its script is checked as well.
 */
export function refusedByGuard(command: string, env?: NodeJS.ProcessEnv, args: readonly string[] = []): string | null {
  if (!guardOn(env)) return null
  let refused = isRealProgram(command)
  if (!refused && isNode(command)) {
    const script = args.find((arg) => !arg.startsWith('-'))
    refused = script !== undefined && isRealProgram(script)
  }
  if (!refused) return null
  const shown = isRealProgram(command) ? command : `${command} ${args.join(' ')}`
  recordRefusal(shown, env)
  return `${shown} is a real system program, which kurmis does not start while ${GUARD_VARIABLE}=1 (tests)`
}

/** The path and the path its links lead to, with `/` as the separator. */
function pathsOf(path: string): string[] {
  const paths = [path.replaceAll('\\', '/')]
  try {
    const real = realpathSync(path).replaceAll('\\', '/')
    if (real !== paths[0]) paths.push(real)
  } catch {
    // A path that does not exist, or a made-up Windows path in a test, is checked as it is.
  }
  return paths
}

function isRealProgram(path: string): boolean {
  return pathsOf(path).some((each) => {
    const name = basename(each).toLowerCase().replace(/\.exe$/, '')
    const lower = each.toLowerCase()
    return GUARDED_PROGRAMS.has(name) || REAL_CLI_PATHS.some((pattern) => pattern.test(lower))
  })
}

function isNode(command: string): boolean {
  if (command === process.execPath) return true
  return pathsOf(command).some((each) => /^node(\.exe)?$/i.test(basename(each)))
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

/**
 * `env` with the guard (and the refusal log, when set) added when it is on, and with
 * `TEST_HOME_VARIABLES` from this process's environment where `env` lacks them; `env` itself
 * when the guard is off.
 */
export function withGuard(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv | undefined {
  if (!guardOn(env)) return env
  const log = refusalLog(env)
  const out: NodeJS.ProcessEnv = { ...(env ?? process.env), [GUARD_VARIABLE]: '1', ...(log === undefined ? {} : { [REFUSAL_LOG_VARIABLE]: log }) }
  for (const name of TEST_HOME_VARIABLES) {
    const value = process.env[name]
    if (!hasVariable(out, name) && value !== undefined && value !== '') out[name] = value
  }
  return out
}

/** Whether `env` has `name`, matched without regard to case as Windows does, even with an empty value. */
export function hasVariable(env: NodeJS.ProcessEnv, name: string): boolean {
  const upper = name.toUpperCase()
  return Object.keys(env).some((key) => key.toUpperCase() === upper && env[key] !== undefined)
}
