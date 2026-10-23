// The program the pseudo-terminal test runs: the wrapper with the real `process`, starting the
// child named in a JSON file (`ChildSpec`). The test bundles it with esbuild first, because
// Node 22 cannot run a `.ts` file without a flag.
import { readFileSync } from 'node:fs'
import { finishLikeChild, runInteractive, type ChildSpec } from '../../src/cli/wrapper.ts'

const spec = JSON.parse(readFileSync(process.argv[2] as string, 'utf8')) as ChildSpec
const end = await runInteractive(spec)
process.exitCode = finishLikeChild(end, { stderr: process.stderr })
