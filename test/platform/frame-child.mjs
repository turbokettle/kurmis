// A program for test/platform/frame-process.test.ts to start. The first argument says what to do:
//
//   echo               answers every JSON line on stdin with {"echo": <value>}, prints one line
//                      that is not JSON first, and exits 0 when stdin ends
//   split              prints one frame in three pieces, with pauses between them, and a CRLF end
//   exit <code>        exits with <code> at once
//   hang               never exits on its own, and ignores the end of stdin
//   grandchild         starts a copy of itself in `hang` mode, prints {"grandchild": <pid>}, then hangs
//   longline <bytes>   prints <bytes> bytes of "x" with no newline, then hangs
//   env <name>         prints {"value": <the variable's value or null>} and exits
import { spawn } from 'node:child_process'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { setInterval, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

const [what, ...rest] = process.argv.slice(2)
const hang = () => setInterval(() => undefined, 1000)

if (what === 'echo') {
  process.stdout.write('this line is not JSON\n')
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  lines.on('line', (line) => process.stdout.write(`${JSON.stringify({ echo: JSON.parse(line) })}\n`))
  lines.on('close', () => { process.exitCode = 0 })
} else if (what === 'split') {
  process.stdout.write('{"par')
  setTimeout(() => process.stdout.write('ts": ["one", '), 50)
  setTimeout(() => process.stdout.write('"two"]}\r\n'), 100)
} else if (what === 'exit') {
  process.exit(Number(rest[0]))
} else if (what === 'hang') {
  process.stdin.on('data', () => undefined)
  process.stdin.on('end', () => undefined)
  hang()
} else if (what === 'grandchild') {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'hang'], { stdio: 'ignore' })
  process.stdout.write(`${JSON.stringify({ grandchild: child.pid })}\n`)
  hang()
} else if (what === 'longline') {
  process.stdout.write('x'.repeat(Number(rest[0])))
  hang()
} else if (what === 'env') {
  process.stdout.write(`${JSON.stringify({ value: process.env[rest[0] ?? ''] ?? null })}\n`)
} else {
  process.stderr.write(`frame-child: unknown mode ${String(what)}\n`)
  process.exitCode = 2
}
