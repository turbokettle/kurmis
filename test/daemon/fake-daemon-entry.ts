// The entry of a test bundle (`bundle.ts`): `daemon run` runs the daemon's lifecycle around the
// fake request handling in `fake-app.ts`, and any other command runs the real CLI, so
// `kurmis daemon start|stop|status` can be tested against a fake daemon in its own process.
import { runCli } from '../../src/cli/dispatch.ts'
import { runDaemon } from '../../src/daemon/main.ts'
import { createFakeDaemonApp } from './fake-app.ts'

/** How long the process may stay after `runDaemon` resolved before it is ended anyway. */
const EXIT_FALLBACK_MS = 2_000

const args = process.argv.slice(2)

function exitWith(code: number): void {
  process.exitCode = code
  // Something left running (a timer, a socket) would keep the process alive; this ends it.
  setTimeout(() => process.exit(code), EXIT_FALLBACK_MS).unref()
}

function fail(error: unknown): void {
  process.stderr.write(`kurmis: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

if (args.length === 2 && args[0] === 'daemon' && args[1] === 'run') {
  runDaemon({
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    createApp: (options) => createFakeDaemonApp(options)
  }).then(exitWith, (error: unknown) => {
    fail(error)
    exitWith(1)
  })
} else {
  runCli(args, { stdout: process.stdout, stderr: process.stderr, env: process.env }).then((code) => {
    process.exitCode = code
  }, fail)
}
