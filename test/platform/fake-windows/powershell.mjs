// A stand-in for Windows' `powershell.exe`, so no test creates a real process through WMI. It
// runs on every platform through node (`KURMIS_POWERSHELL_PROGRAM` names it; test/setup.ts does
// that for every test). Each call appends one line to `calls.jsonl` in the folder
// FAKE_POWERSHELL_DIR names: `{ args, script }`, where `script` is the decoded
// `-EncodedCommand` text (UTF-16LE base64), or null.
//
// It runs nothing. Without FAKE_POWERSHELL_PID it fails with exit 1, so a start through WMI falls
// back to a direct start. With FAKE_POWERSHELL_PID=<n> it prints `pid <n>` and exits 0, which is
// what kurmis' WMI script prints when Win32_Process.Create succeeded.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const encodedAt = args.findIndex((arg) => arg.toLowerCase() === '-encodedcommand')
const encoded = encodedAt === -1 ? undefined : args[encodedAt + 1]
const script = encoded === undefined ? null : Buffer.from(encoded, 'base64').toString('utf16le')
const dir = process.env.FAKE_POWERSHELL_DIR
if (dir) {
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'calls.jsonl'), `${JSON.stringify({ args, script })}\n`, 'utf8')
}
const pid = process.env.FAKE_POWERSHELL_PID
if (pid !== undefined && /^[1-9]\d*$/.test(pid)) {
  process.stdout.write(`pid ${pid}\r\n`)
  process.exit(0)
}
process.stderr.write('fake powershell: this stand-in creates no process (set FAKE_POWERSHELL_PID to answer a pid)\n')
process.exit(1)
