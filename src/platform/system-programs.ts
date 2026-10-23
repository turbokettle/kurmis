// Where the operating system's own programs that kurmis runs are, and the test hooks that name
// stand-ins for them.
//
// Each program has a variable that names a stand-in (`SYSTEM_PROGRAM_VARIABLES`). The variable
// is looked up in the environment the caller passes, and when it is not set there, in this
// process's own environment. So a test that builds an environment of its own, or passes an empty
// one, still gets the stand-in that `test/setup.ts` put in `process.env`, never the real program.
// A person never sets these variables; without them the real program's full path is used, so a
// program of the same name earlier on PATH is never what runs.
//
// Every test also runs with `KURMIS_REFUSE_SYSTEM_PROGRAMS=1` (`system-program-guard.ts`), which
// refuses the real programs if a path here is ever missed.
import { GUARD_VARIABLE, REFUSAL_LOG_VARIABLE, TEST_HOME_VARIABLES } from './system-program-guard.ts'

/** The system programs kurmis runs, or names in a logon entry. */
export type SystemProgram = 'launchctl' | 'security' | 'powershell' | 'reg' | 'taskkill' | 'wscript'

/** The test hook naming a stand-in for each program. */
export const SYSTEM_PROGRAM_VARIABLES: Readonly<Record<SystemProgram, string>> = {
  launchctl: 'KURMIS_LAUNCHCTL_PROGRAM',
  security: 'KURMIS_SECURITY_PROGRAM',
  powershell: 'KURMIS_POWERSHELL_PROGRAM',
  reg: 'KURMIS_REG_PROGRAM',
  taskkill: 'KURMIS_TASKKILL_PROGRAM',
  wscript: 'KURMIS_WSCRIPT_PROGRAM'
}

/** A variable by name; Windows names are matched without regard to case, and an empty value counts as unset. */
function lookup(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const exact = env[name]
  if (exact !== undefined && exact !== '') return exact
  const upper = name.toUpperCase()
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === upper && value !== undefined && value !== '') return value
  }
  return undefined
}

/** The Windows folder: `SystemRoot`, else `windir`, else `C:\Windows`, without a trailing backslash. */
export function systemRoot(env: NodeJS.ProcessEnv = process.env): string {
  const value = lookup(env, 'SystemRoot') ?? lookup(env, 'windir')
  return value === undefined ? 'C:\\Windows' : value.replace(/[\\/]+$/, '')
}

/** The real program's full path. The Windows ones are in the Windows folder `env` names. */
export function realSystemProgram(program: SystemProgram, env: NodeJS.ProcessEnv = process.env): string {
  switch (program) {
    case 'launchctl':
      return '/bin/launchctl'
    case 'security':
      return '/usr/bin/security'
    case 'powershell':
      return `${systemRoot(env)}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    case 'reg':
      return `${systemRoot(env)}\\System32\\reg.exe`
    case 'taskkill':
      return `${systemRoot(env)}\\System32\\taskkill.exe`
    case 'wscript':
      return `${systemRoot(env)}\\System32\\wscript.exe`
  }
}

/**
 * The program to run: the stand-in its variable names in `env`, else the one it names in
 * `processEnv` (this process's environment), else the real program.
 */
export function systemProgram(
  program: SystemProgram,
  env: NodeJS.ProcessEnv = process.env,
  processEnv: NodeJS.ProcessEnv = process.env
): string {
  const variable = SYSTEM_PROGRAM_VARIABLES[program]
  return lookup(env, variable) ?? lookup(processEnv, variable) ?? realSystemProgram(program, env)
}

/**
 * The stand-in variables, the guard and its refusal log (`system-program-guard.ts`) that are set
 * in `processEnv` but missing from `env`, and while the guard is on also the test's home and
 * the `claude` it names (`TEST_HOME_VARIABLES`). Kurmis adds these to the environment
 * of a daemon it starts, and to the login items setup writes, so a daemon a test starts
 * with an environment of its own still uses the stand-ins and the temporary home. Empty outside
 * the tests.
 */
export function inheritedTestHooks(env: NodeJS.ProcessEnv, processEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  const guarded = lookup(env, GUARD_VARIABLE) === '1' || lookup(processEnv, GUARD_VARIABLE) === '1'
  const names = [...Object.values(SYSTEM_PROGRAM_VARIABLES), GUARD_VARIABLE, REFUSAL_LOG_VARIABLE, ...(guarded ? TEST_HOME_VARIABLES : [])]
  for (const name of names) {
    if (lookup(env, name) !== undefined) continue
    const value = lookup(processEnv, name)
    if (value !== undefined) out[name] = value
  }
  return out
}
