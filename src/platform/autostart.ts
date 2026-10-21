// Starting the daemon when the user logs in, for `kurmis setup`: a launchd agent on macOS and a
// per-user logon entry on Windows. (Interface only; implemented next.)

export interface AutostartOptions {
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

export interface AutostartResult {
  /** Whether anything was changed. */
  changed: boolean
  /** Where the entry is (a file path or a registry value), for the person to see. */
  where: string | null
  /** A sentence when it could not be done; the rest of `setup` goes on. */
  warning?: string
}

export async function registerAutostart(options: AutostartOptions): Promise<AutostartResult> {
  void options
  throw new Error('registerAutostart: not implemented yet')
}

export async function unregisterAutostart(options: AutostartOptions): Promise<AutostartResult> {
  void options
  throw new Error('unregisterAutostart: not implemented yet')
}
