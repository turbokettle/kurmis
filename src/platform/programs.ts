// Finding the real program behind `claude` and `codex`. (The PATH search and the Windows shim
// resolution are implemented next; only the explicit variables work so far.)
//
// `KURMIS_CLAUDE_BIN` / `KURMIS_CODEX_BIN` name the program explicitly, which is also how tests
// point kurmis at the fakes on every OS. Otherwise PATH is searched (with PATHEXT on Windows).
// On Windows a `.cmd`/`.bat` npm shim is never started: it is resolved to the real target
// (`claude.exe` for Claude Code, `node <entry>.js` for Codex).

import { invocationFor } from './run.ts'

export type ToolName = 'claude' | 'codex'

/** How to start a tool: `command` with `args` in front of the caller's own arguments. */
export interface ResolvedProgram {
  command: string
  args: string[]
  /** Where it was found, for messages and `kurmis status`. */
  source: 'env' | 'path' | 'npm-shim' | 'native-installer'
}

export class ProgramNotFoundError extends Error {
  constructor(readonly tool: ToolName, message: string) {
    super(message)
    this.name = 'ProgramNotFoundError'
  }
}

export interface FindProgramOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** The Node that runs a `.js` entry. Defaults to `process.execPath`. */
  nodePath?: string
}

/** The program to start for `tool`. Throws `ProgramNotFoundError` with a sentence a person can act on. */
export function findProgram(tool: ToolName, options: FindProgramOptions = {}): ResolvedProgram {
  const env = options.env ?? process.env
  const named = env[PROGRAM_VARIABLES[tool]]
  if (named !== undefined && named !== '') {
    const invocation = invocationFor(named, [], options.nodePath)
    if ('refused' in invocation) throw new ProgramNotFoundError(tool, `${PROGRAM_VARIABLES[tool]}: ${invocation.refused}`)
    return { command: invocation.command, args: invocation.args, source: 'env' }
  }
  throw new ProgramNotFoundError(tool, 'findProgram: the PATH search is not implemented yet')
}

/** The variables that name each tool's program explicitly. */
export const PROGRAM_VARIABLES: Readonly<Record<ToolName, string>> = {
  claude: 'KURMIS_CLAUDE_BIN',
  codex: 'KURMIS_CODEX_BIN'
}
