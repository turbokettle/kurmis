// Writes a small launcher that starts one of the fake CLI scripts with the Node that runs
// the tests, so a fake can be found on PATH under the real program's name.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface InstalledFake {
  /** The launcher that was written: `<binDir>/<name>` on POSIX, `<binDir>\<name>.cmd` on Windows. */
  path: string
  /** The fake's script. */
  script: string
  /** The fake as a command with no launcher: `[process.execPath, script]`. Append the arguments. */
  command: readonly [string, string]
}

/**
 * Writes `<binDir>/<name>` (POSIX shell script) or `<binDir>\<name>.cmd` (Windows) that runs
 * `script` with `process.execPath` and passes every argument on.
 *
 * On Windows the `.cmd` file is only good for a test that starts it through `cmd.exe` itself.
 * Kurmis refuses to start `.cmd` shims and looks for `claude.exe` (docs/architecture.md,
 * "Windows"), so a Windows test of kurmis has to hand kurmis `command` instead. See
 * test/fakes/README.md.
 */
export function installLauncher(binDir: string, name: string, script: string, platform: NodeJS.Platform = process.platform): InstalledFake {
  mkdirSync(binDir, { recursive: true })
  const command = [process.execPath, script] as const
  if (platform === 'win32') {
    const path = join(binDir, `${name}.cmd`)
    // `%*` passes the arguments on as cmd.exe received them.
    writeFileSync(path, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
    return { path, script, command }
  }
  const path = join(binDir, name)
  writeFileSync(path, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(script)} "$@"\n`)
  chmodSync(path, 0o755)
  return { path, script, command }
}

/** Quotes a value for a POSIX shell: single quotes, with each `'` written as `'\''`. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
