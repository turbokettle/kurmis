// A stand-in for macOS's `/usr/bin/security`, so no test reads a real Keychain. It runs on every
// platform through node, and keeps its state in the folder FAKE_SECURITY_DIR names:
//
//   items/<encodeURIComponent(service)>   the secret of each item it holds
//   mode                                  optional; what to do instead of answering:
//                                           locked    prints what `security` prints when it may
//                                                     not use the Keychain, and exits 36
//                                           prompt    never answers, the way a Keychain dialog
//                                                     nobody answers looks from outside
//                                           oversize  prints half a megabyte and exits 0
//   calls.jsonl                           every call's arguments are appended here
//
// Only `find-generic-password -w -s <service>` and `show-keychain-info <keychain>` are
// understood. An item it does not hold exits 44, as `security` does. `show-keychain-info`
// answers that the Keychain is readable unless the mode says otherwise.
// `fake-keychain.ts` beside this file writes the folder.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { setInterval } from 'node:timers'

const argv = process.argv.slice(2)
const dir = process.env.FAKE_SECURITY_DIR
if (!dir) {
  process.stderr.write('fake security: FAKE_SECURITY_DIR is not set\n')
  process.exit(2)
}

appendFileSync(join(dir, 'calls.jsonl'), `${JSON.stringify(argv)}\n`, 'utf8')

const modeFile = join(dir, 'mode')
const mode = existsSync(modeFile) ? readFileSync(modeFile, 'utf8').trim() : ''

if (mode === 'prompt') {
  setInterval(() => undefined, 1000)
} else if (mode === 'oversize') {
  process.stdout.write('x'.repeat(512 * 1024))
} else if (mode === 'locked') {
  process.stderr.write('security: SecKeychainSearchCopyNext: User interaction is not allowed.\n')
  process.exit(36)
} else if (argv[0] === 'show-keychain-info') {
  process.stdout.write(`Keychain "${argv[1] ?? 'login.keychain'}" lock-on-sleep timeout=21600s\n`)
} else if (argv[0] !== 'find-generic-password' || !argv.includes('-w') || argv.indexOf('-s') < 0) {
  process.stderr.write(`security: unknown command "${argv.join(' ')}"\n`)
  process.exit(2)
} else {
  const service = argv[argv.indexOf('-s') + 1] ?? ''
  const item = join(dir, 'items', encodeURIComponent(service))
  if (existsSync(item)) {
    process.stdout.write(`${readFileSync(item, 'utf8')}\n`)
  } else {
    process.stderr.write('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n')
    process.exit(44)
  }
}
