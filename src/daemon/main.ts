// The daemon process: `kurmis daemon run`. (Interface only; implemented next.)

export interface RunDaemonOptions {
  env: NodeJS.ProcessEnv
}

/** Runs the daemon until it is stopped. Resolves with the process exit code. */
export async function runDaemon(options: RunDaemonOptions): Promise<number> {
  void options
  throw new Error('runDaemon: not implemented yet')
}
