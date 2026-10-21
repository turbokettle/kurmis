// A stand-in for Windows' `powershell.exe`, so no test runs a real PowerShell script. It runs on
// every platform through node (`KURMIS_POWERSHELL_PROGRAM` names it; test/setup.ts does that
// for every test). Each call appends one line to `calls.jsonl` in the folder
// FAKE_POWERSHELL_DIR names: `{ args, script }`, where `script` is the decoded
// `-EncodedCommand` text (UTF-16LE base64), or null.
//
// It answers only the Credential Manager listing of `src/platform/windows-credentials.ts`
// (`credEnumScript`), from the folder FAKE_POWERSHELL_DIR names:
//
//   credentials/<encodeURIComponent(name)>   one generic credential each, the file being its blob
//   mode                                     optional; `fail` makes every call exit 1
//
// With no such folder Credential Manager is empty. It prints what the real script prints: for
// each filter `<i> + <base64 name> <base64 blob>` per credential (without the blob when the
// script asks for names only), then `<i> . <count>`. Any other script runs nothing and exits 1.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
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

const failing = dir !== undefined && dir !== '' && existsSync(join(dir, 'mode')) && readFileSync(join(dir, 'mode'), 'utf8').trim() === 'fail'
const listing = script === null ? null : /\[KurmisCredEnum\]::List\(\$filters\[\$i\],\$(true|false)\)/.exec(script)
const filterList = script === null ? null : /^\$filters=@\((.*)\)$/m.exec(script)

if (failing || listing === null || filterList === null) {
  process.stderr.write('fake powershell: this stand-in runs no script\n')
  process.exit(1)
}

// The filters are PowerShell single-quoted strings, each quote inside doubled.
const filters = [...(filterList[1] ?? '').matchAll(/'((?:[^'‘’‚‛]|['‘’‚‛]{2})*)'/g)]
  .map((match) => (match[1] ?? '').replace(/(['‘’‚‛])\1/g, '$1'))
const blobs = listing[1] === 'true'
const store = dir ? join(dir, 'credentials') : null
const names = store !== null && existsSync(store) ? readdirSync(store).map((file) => decodeURIComponent(file)) : []
const base64 = (bytes) => Buffer.from(bytes).toString('base64')
const lines = []
filters.forEach((filter, index) => {
  const prefix = filter.replace(/\*$/, '').toLowerCase()
  const found = names.filter((name) => name.toLowerCase().startsWith(prefix))
  for (const name of found) {
    const blob = blobs ? ` ${base64(readFileSync(join(store, encodeURIComponent(name))))}` : ''
    lines.push(`${String(index)} + ${base64(name)}${blob}`)
  }
  lines.push(`${String(index)} . ${String(found.length)}`)
})
process.stdout.write(`${lines.join('\r\n')}\r\n`)
