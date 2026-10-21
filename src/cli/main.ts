// The program `dist/kurmis.cjs` runs. Everything it does is in `dispatch.ts`, which tests
// import without starting the program.
import { runCli } from './dispatch.ts'

runCli(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, env: process.env }).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    process.stderr.write(`kurmis: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
)
