// A stand-in for Windows' `reg.exe`, so no test writes the real registry. It runs on every
// platform through node (`KURMIS_REG_PROGRAM` names it; test/setup.ts does that for every test)
// and keeps its state in the folder FAKE_REG_DIR names:
//
//   calls.jsonl   every call's arguments, one JSON array per line
//   values.json   the values it holds: { <key, upper case, HKCU spelled out>: { <name, lower
//                 case>: { name, type, data } } }
//
// It understands the calls kurmis makes, with reg.exe's output and exit codes:
//
//   add <key> /v <name> /t <type> /d <data> /f   sets the value; prints "The operation
//                                                completed successfully." Without /f an
//                                                existing value is not replaced and it exits 1.
//   delete <key> /v <name> /f                    removes the value; exits 1 with reg.exe's
//                                                "unable to find" error when there is none.
//   query <key> /v <name>                        prints the key and the value line
//                                                (`    <name>    <type>    <data>`); exits 1
//                                                when there is none.
//   query <key>                                  prints the key and a line for each of its
//                                                values; exits 1 for a key that does not
//                                                exist. The Run key exists from the start,
//                                                as on Windows; another key exists once a
//                                                value was added to it.
//
// FAKE_REG_FAIL=1 makes every call fail with "ERROR: Access is denied." and exit 1. A list of
// commands instead (FAKE_REG_FAIL=delete or FAKE_REG_FAIL=query,delete) makes only those fail.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const argv = process.argv.slice(2)
const dir = process.env.FAKE_REG_DIR
if (!dir) {
  process.stderr.write('fake reg: FAKE_REG_DIR is not set\n')
  process.exit(2)
}
mkdirSync(dir, { recursive: true })
appendFileSync(join(dir, 'calls.jsonl'), `${JSON.stringify(argv)}\n`, 'utf8')

const valuesFile = join(dir, 'values.json')
const NOT_FOUND = 'ERROR: The system was unable to find the specified registry key or value.'

function fail(message) {
  process.stderr.write(`${message}\r\n`)
  process.exit(1)
}

function readValues() {
  try {
    return JSON.parse(readFileSync(valuesFile, 'utf8'))
  } catch {
    return {}
  }
}

function writeValues(values) {
  const temp = `${valuesFile}.${String(process.pid)}.tmp`
  writeFileSync(temp, JSON.stringify(values, null, 2))
  renameSync(temp, valuesFile)
}

/** A key with its root spelled out the way `reg query` prints it, in upper case for lookups. */
function fullKey(key) {
  return key.replace(/^HKCU(?=\\|$)/i, 'HKEY_CURRENT_USER').replace(/^HKLM(?=\\|$)/i, 'HKEY_LOCAL_MACHINE')
}

/** The value after `flag`, case-insensitive, or undefined. */
function option(flag) {
  const at = argv.findIndex((arg) => arg.toLowerCase() === flag)
  return at < 0 ? undefined : argv[at + 1]
}

const has = (flag) => argv.some((arg) => arg.toLowerCase() === flag)

const command = (argv[0] ?? '').toLowerCase()
const failing = (process.env.FAKE_REG_FAIL ?? '').toLowerCase().split(',')
if (failing.includes('1') || failing.includes(command)) fail('ERROR: Access is denied.')

const key = argv[1]
const name = option('/v')
if (!['add', 'delete', 'query'].includes(command) || key === undefined || (name === undefined && command !== 'query')) {
  fail(`ERROR: Invalid syntax.\r\nType "REG ${argv[0] ?? ''} /?" for usage.`)
}
const keyId = fullKey(key).toUpperCase()
const values = readValues()

if (command === 'query' && name === undefined) {
  const runKey = 'HKEY_CURRENT_USER\\SOFTWARE\\MICROSOFT\\WINDOWS\\CURRENTVERSION\\RUN'
  if (values[keyId] === undefined && keyId !== runKey) fail(NOT_FOUND)
  const held = Object.values(values[keyId] ?? {})
  const lines = held.map((value) => `    ${value.name}    ${value.type}    ${value.data}\r\n`).join('')
  process.stdout.write(`\r\n${fullKey(key)}\r\n${lines}\r\n`)
  process.exit(0)
}
const nameId = name.toLowerCase()

if (command === 'add') {
  const type = option('/t') ?? 'REG_SZ'
  const data = option('/d') ?? ''
  if (!['REG_SZ', 'REG_EXPAND_SZ'].includes(type.toUpperCase())) fail('ERROR: Invalid syntax.')
  if (values[keyId]?.[nameId] !== undefined && !has('/f')) fail(`Value ${name} exists, overwrite(Yes/No)? ERROR: Invalid syntax.`)
  values[keyId] = { ...(values[keyId] ?? {}), [nameId]: { name, type: type.toUpperCase(), data } }
  writeValues(values)
  process.stdout.write('The operation completed successfully.\r\n')
} else if (command === 'delete') {
  if (values[keyId]?.[nameId] === undefined) fail(NOT_FOUND)
  delete values[keyId][nameId]
  writeValues(values)
  process.stdout.write('The operation completed successfully.\r\n')
} else {
  const value = values[keyId]?.[nameId]
  if (value === undefined) fail(NOT_FOUND)
  process.stdout.write(`\r\n${fullKey(key)}\r\n    ${value.name}    ${value.type}    ${value.data}\r\n\r\n`)
}
