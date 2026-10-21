// A stand-in for Windows' `powershell.exe`, so no test runs a real PowerShell script. It runs on
// every platform through node (`KURMIS_POWERSHELL_PROGRAM` names it; test/setup.ts does that
// for every test). Each call appends one line to `calls.jsonl` in the folder
// FAKE_POWERSHELL_DIR names: `{ args, script }`, where `script` is the decoded
// `-EncodedCommand` text (UTF-16LE base64), or null. It runs nothing and exits 1.
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
process.stderr.write('fake powershell: this stand-in runs no script\n')
process.exit(1)
