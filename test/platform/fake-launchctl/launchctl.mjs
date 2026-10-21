// A stand-in for macOS's `/bin/launchctl`, so no test loads a job into a real launchd. It runs
// on every platform through node (`KURMIS_LAUNCHCTL_PROGRAM` names it; test/setup.ts does that
// for every test) and keeps its state in the folder FAKE_LAUNCHCTL_DIR names:
//
//   calls.jsonl   every call's arguments, one JSON array per line
//   state.json    the loaded jobs: { <label>: { plist, pid } }
//   runs.jsonl    with FAKE_LAUNCHCTL_RUN=1, one line per program it started:
//                 { label, pid, program }
//
// It understands the calls kurmis makes, answering with launchctl's exit codes and wording:
//
//   bootstrap gui/<uid> <plist>   loads the job. A job that is already loaded exits 5
//                                 ("Bootstrap failed: 5: Input/output error"), a missing plist
//                                 exits 2. With FAKE_LAUNCHCTL_RUN=1 and RunAtLoad in the plist,
//                                 it starts ProgramArguments detached (its own process group,
//                                 standard streams ignored) in WorkingDirectory, with the plist's
//                                 EnvironmentVariables as its whole environment, as launchd
//                                 would. The only addition is every FAKE_* variable of the
//                                 fake's own environment, so the fakes the job's program starts
//                                 find their state folders.
//   bootout gui/<uid>/<label>     unloads the job; exits 3 ("Boot-out failed: 3: No such
//                                 process") when it is not loaded. It does not end the job's
//                                 process: kurmis' jobs set AbandonProcessGroup.
//   print gui/<uid>/<label>       a loaded job's `path`, `state`, `last exit code` and, while
//                                 its process is alive, `pid`; exits 113 ("Could not find
//                                 service") otherwise.
//   kickstart gui/<uid>/<label>   runs a loaded job's program again (with FAKE_LAUNCHCTL_RUN=1)
//                                 unless its process is alive; exits 113 when it is not loaded.
//
// A domain that is not `gui/<digits>` exits 125, as launchctl answers a domain it cannot use.
// FAKE_LAUNCHCTL_FAIL_BOOTSTRAP=<exit code> makes every bootstrap fail with that code; 125 is
// what launchctl answers when nobody is logged in at the screen. FAKE_LAUNCHCTL_JOB_EXIT=<code>
// makes a job that bootstrap loads run nothing and count as exited with that code, which is
// what `print` then shows as its `last exit code` (launchd answers 78 when it cannot start a
// job's program).
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const argv = process.argv.slice(2)
const dir = process.env.FAKE_LAUNCHCTL_DIR
if (!dir) {
  process.stderr.write('fake launchctl: FAKE_LAUNCHCTL_DIR is not set\n')
  process.exit(2)
}
mkdirSync(dir, { recursive: true })
appendFileSync(join(dir, 'calls.jsonl'), `${JSON.stringify(argv)}\n`, 'utf8')

const stateFile = join(dir, 'state.json')
const lockDir = join(dir, 'state.lock')

/** Runs `work` while holding a lock on the state file, so two calls at once lose no change. */
function locked(work) {
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      mkdirSync(lockDir)
      break
    } catch {
      if (Date.now() > deadline) rmSync(lockDir, { recursive: true, force: true })
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
  }
  try {
    return work()
  } finally {
    rmSync(lockDir, { recursive: true, force: true })
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    return {}
  }
}

function writeState(state) {
  const temp = `${stateFile}.${String(process.pid)}.tmp`
  writeFileSync(temp, JSON.stringify(state, null, 2))
  renameSync(temp, stateFile)
}

function alive(pid) {
  if (typeof pid !== 'number') return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function unescapeXml(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

/**
 * The top-level value after `<key>name</key>` in the plist kurmis writes: a string, true or
 * false, an array of strings, or a dictionary of strings and booleans.
 */
function plistValue(text, name) {
  const marker = `\n  <key>${name}</key>`
  const at = text.indexOf(marker)
  if (at < 0) return undefined
  const rest = text.slice(at + marker.length).trimStart()
  if (rest.startsWith('<string>')) return unescapeXml(rest.slice(8, rest.indexOf('</string>')))
  if (rest.startsWith('<true/>')) return true
  if (rest.startsWith('<false/>')) return false
  if (rest.startsWith('<array>')) {
    const body = rest.slice(0, rest.indexOf('</array>'))
    return [...body.matchAll(/<string>([^<]*)<\/string>/g)].map((match) => unescapeXml(match[1]))
  }
  if (rest.startsWith('<dict>')) {
    const body = rest.slice(0, rest.indexOf('</dict>'))
    const pairs = {}
    for (const match of body.matchAll(/<key>([^<]*)<\/key>\s*(?:<string>([^<]*)<\/string>|<(true|false)\/>)/g)) {
      pairs[unescapeXml(match[1])] = match[3] === undefined ? unescapeXml(match[2]) : match[3] === 'true'
    }
    return pairs
  }
  return undefined
}

/** Starts a job's program the way launchd would, and answers its pid. */
function run(label, text) {
  const program = plistValue(text, 'ProgramArguments') ?? []
  const env = {}
  for (const [name, value] of Object.entries(plistValue(text, 'EnvironmentVariables') ?? {})) {
    if (typeof value === 'string') env[name] = value
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith('FAKE_') && value !== undefined) env[name] = value
  }
  const cwd = plistValue(text, 'WorkingDirectory')
  const child = spawn(program[0], program.slice(1), {
    detached: true,
    stdio: 'ignore',
    env,
    cwd: typeof cwd === 'string' && existsSync(cwd) ? cwd : undefined,
    windowsHide: true
  })
  child.on('error', () => undefined)
  child.unref()
  const pid = child.pid ?? null
  appendFileSync(join(dir, 'runs.jsonl'), `${JSON.stringify({ label, pid, program })}\n`, 'utf8')
  return pid
}

/** The label of a `gui/<uid>/<label>` target, or null when the domain is not one this fake knows. */
function labelOf(target) {
  const match = /^gui\/\d+\/(.+)$/.exec(target ?? '')
  return match === null ? null : match[1]
}

function fail(code, message) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

const UNKNOWN_DOMAIN = 'Domain does not support specified action'
const command = argv[0]

if (command === 'bootstrap' && argv.length === 3) {
  const failWith = Number(process.env.FAKE_LAUNCHCTL_FAIL_BOOTSTRAP)
  if (Number.isInteger(failWith) && failWith > 0) {
    fail(failWith, `Bootstrap failed: ${String(failWith)}: ${failWith === 125 ? UNKNOWN_DOMAIN : 'Input/output error'}`)
  }
  if (!/^gui\/\d+$/.test(argv[1])) fail(125, `Bootstrap failed: 125: ${UNKNOWN_DOMAIN}`)
  if (!existsSync(argv[2])) fail(2, 'Bootstrap failed: 2: No such file or directory')
  const text = readFileSync(argv[2], 'utf8')
  const label = plistValue(text, 'Label')
  if (typeof label !== 'string' || !Array.isArray(plistValue(text, 'ProgramArguments'))) {
    fail(5, 'Bootstrap failed: 5: Input/output error')
  }
  const loaded = locked(() => {
    const state = readState()
    if (state[label] !== undefined) return false
    const exitCode = Number(process.env.FAKE_LAUNCHCTL_JOB_EXIT)
    state[label] = { plist: argv[2], pid: null, ...(process.env.FAKE_LAUNCHCTL_JOB_EXIT && Number.isInteger(exitCode) ? { exitCode } : {}) }
    writeState(state)
    return true
  })
  if (!loaded) fail(5, 'Bootstrap failed: 5: Input/output error\nTry re-running the command as root for richer errors.')
  if (process.env.FAKE_LAUNCHCTL_RUN === '1' && !process.env.FAKE_LAUNCHCTL_JOB_EXIT && plistValue(text, 'RunAtLoad') === true) {
    const pid = run(label, text)
    locked(() => {
      const state = readState()
      if (state[label] !== undefined) state[label].pid = pid
      writeState(state)
    })
  }
  process.exit(0)
} else if (command === 'bootout' && argv.length === 2) {
  const label = labelOf(argv[1])
  if (label === null) fail(125, `Boot-out failed: 125: ${UNKNOWN_DOMAIN}`)
  const was = locked(() => {
    const state = readState()
    if (state[label] === undefined) return false
    delete state[label]
    writeState(state)
    return true
  })
  if (!was) fail(3, 'Boot-out failed: 3: No such process')
  process.exit(0)
} else if (command === 'print' && argv.length === 2) {
  const label = labelOf(argv[1])
  if (label === null) fail(125, `Bad request.\nCould not find domain for ${argv[1]}`)
  const job = readState()[label]
  if (job === undefined) fail(113, `Bad request.\nCould not find service "${label}" in domain for port`)
  const running = alive(job.pid)
  process.stdout.write([
    `${argv[1]} = {`,
    `\tactive count = ${running ? '1' : '0'}`,
    `\tpath = ${job.plist}`,
    '\ttype = LaunchAgent',
    `\tstate = ${running ? 'running' : 'not running'}`,
    '',
    ...(running ? [`\tpid = ${String(job.pid)}`] : []),
    typeof job.exitCode === 'number' ? `\tlast exit code = ${String(job.exitCode)}${job.exitCode === 78 ? ': EX_CONFIG' : ''}` : '\tlast exit code = (never exited)',
    '\tenvironment = {',
    '\t\tXPC_SERVICE_NAME => ' + label,
    '\t}',
    '}',
    ''
  ].join('\n'))
  process.exit(0)
} else if (command === 'kickstart' && argv.length === 2) {
  const label = labelOf(argv[1])
  if (label === null) fail(125, UNKNOWN_DOMAIN)
  const job = readState()[label]
  if (job === undefined) fail(113, `Could not find service "${label}" in domain for port`)
  if (!alive(job.pid) && process.env.FAKE_LAUNCHCTL_RUN === '1') {
    const pid = run(label, readFileSync(job.plist, 'utf8'))
    locked(() => {
      const state = readState()
      if (state[label] !== undefined) state[label].pid = pid
      writeState(state)
    })
  }
  process.exit(0)
} else {
  fail(64, `Unrecognized subcommand: ${argv.join(' ')}`)
}
