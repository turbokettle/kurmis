// A program for test/platform/run.test.ts to start. The first argument says what to do:
//
//   echo <args...>     prints its arguments as JSON on stdout, and "to stderr" on stderr
//   exit <code>        prints "failing" on stderr and exits with <code>
//   stdin              reads standard input to its end and prints how many bytes it got
//   env <name>         prints the value of the environment variable <name>
//   hang               never exits on its own
//   flood <bytes>      prints <bytes> bytes of "x" and exits 0
import process from 'node:process'
import { setInterval } from 'node:timers'

const [what, ...rest] = process.argv.slice(2)

if (what === 'echo') {
  process.stdout.write(JSON.stringify(rest))
  process.stderr.write('to stderr')
} else if (what === 'exit') {
  process.stderr.write('failing')
  process.exitCode = Number(rest[0])
} else if (what === 'stdin') {
  let bytes = 0
  process.stdin.on('data', (chunk) => { bytes += chunk.length })
  process.stdin.on('end', () => { process.stdout.write(`stdin ended after ${String(bytes)} bytes`) })
} else if (what === 'env') {
  process.stdout.write(process.env[rest[0] ?? ''] ?? '<unset>')
} else if (what === 'hang') {
  setInterval(() => undefined, 1000)
} else if (what === 'flood') {
  process.stdout.write('x'.repeat(Number(rest[0])))
} else {
  process.stderr.write(`run-child: unknown mode ${String(what)}`)
  process.exitCode = 2
}
