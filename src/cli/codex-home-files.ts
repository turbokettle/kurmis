// Preparing an extra Codex login's `CODEX_HOME` before a Codex CLI starts on it, following the
// decisions in `src/core/codex-home.ts` and `src/core/codex-account-config.ts`.
// (Interface only; implemented next.)

export interface PreparedCodexHome {
  /** The `CODEX_HOME` to start codex with, or null for `codex:default`, which keeps the inherited one. */
  codexHome: string | null
  /** Sentences about what could not be prepared, for stderr. Never a secret. */
  warnings: string[]
}

export interface PrepareCodexHomeOptions {
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

export async function prepareCodexHome(id: string, options: PrepareCodexHomeOptions): Promise<PreparedCodexHome> {
  void id
  void options
  throw new Error('prepareCodexHome: not implemented yet')
}
