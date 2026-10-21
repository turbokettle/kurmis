// A program for the wrapper tests to start. The first argument says what to do:
//
//   exit <code>            exits with <code>
//   write <file>           writes its other arguments, WRAPPER_TEST_ONE and its working folder
//                          to <file> as JSON, exits 0
//   hold <ready-file>      writes <ready-file>, then waits up to 20 s; SIGTERM exits 143
//   hold-default <ready>   writes <ready>, then waits up to 20 s with no signal handler, so a
//                          signal ends it with the signal's default action
//
// A waiting mode given "-" instead of a file prints "ready" on stdout once it is waiting, for the
// pseudo-terminal test, which reads the terminal instead of a file.
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { setTimeout } from 'node:timers'

const [what, file, ...rest] = process.argv.slice(2)

if (what === 'exit') {
  process.exitCode = Number(file)
} else if (what === 'write') {
  writeFileSync(file, JSON.stringify({ args: rest, one: process.env.WRAPPER_TEST_ONE ?? null, cwd: process.cwd() }))
} else if (what === 'hold' || what === 'hold-default') {
  if (what === 'hold') process.on('SIGTERM', () => process.exit(143))
  setTimeout(() => process.exit(0), 20_000)
  if (file === undefined || file === '-') process.stdout.write('ready\n')
  else writeFileSync(file, 'ready')
} else {
  process.stderr.write(`wrapper-child: unknown mode ${String(what)}\n`)
  process.exitCode = 2
}
