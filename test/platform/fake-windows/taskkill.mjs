// A stand-in for Windows' `taskkill.exe` (`KURMIS_TASKKILL_PROGRAM` names it; test/setup.ts does
// that for every test). Each call appends its arguments as a JSON array to `calls.jsonl` in the
// folder FAKE_TASKKILL_DIR names, when it is set.
//
// For `/PID <n> ... /F` it ends that one process with `process.kill`, and exits 0, or 128 as
// taskkill does for a process that is not there. It does not end the process's children, which
// the real `/T` does, so a test of a whole tree being ended needs the real taskkill.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const dir = process.env.FAKE_TASKKILL_DIR
if (dir) {
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'calls.jsonl'), `${JSON.stringify(args)}\n`, 'utf8')
}
const at = args.findIndex((arg) => arg.toUpperCase() === '/PID')
const pid = at === -1 ? NaN : Number(args[at + 1])
if (!Number.isSafeInteger(pid) || pid <= 0) {
  process.stderr.write('ERROR: Invalid syntax.\n')
  process.exit(1)
}
try {
  process.kill(pid, 'SIGKILL')
} catch {
  process.stderr.write(`ERROR: The process "${String(pid)}" not found.\n`)
  process.exit(128)
}
process.stdout.write(`SUCCESS: The process with PID ${String(pid)} has been terminated.\n`)
process.exit(0)
