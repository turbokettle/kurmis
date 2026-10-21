// The daemons a test started, and how the test stops them when it ends without signalling a
// process that is not one of them.
//
// A test learns daemon pids from `daemon.json` and from the `daemon_started` lines of
// `daemon.log`. By the time the test ends such a process may have exited, and Windows hands a
// freed pid to a new process soon, so the pid may name another program. So a pid is signalled
// only when it is shown to be a daemon of the test's data folder:
//
// - a keyed status request to a port the test's daemons used, with a key the data folder held,
//   answers with that pid. The key is random per data folder, so no other daemon has it;
// - on macOS and Linux, `ps` shows that the process runs `<bundle> daemon run` (or another
//   command) of a bundle the test built. Each test bundle is in a temporary folder of its own.
//
// On Windows, without `ps`, a daemon that no longer listens cannot be shown to be the test's.
// `stop` then waits for it to exit by itself (it is stopping, or lost the bind), so the test's
// folders are not in use when the test removes them.
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { readDaemonFile, readKey } from '../../src/data/daemon-file.ts'
import { portHolder, processExists } from '../../src/daemon/lifecycle.ts'

/** The pids in the `daemon_started` lines of `daemon.log` and `daemon.log.1` in `dataFolder`. */
export function loggedDaemonPids(dataFolder: string): number[] {
  const pids: number[] = []
  for (const name of ['daemon.log.1', 'daemon.log']) {
    let text: string
    try {
      text = readFileSync(join(dataFolder, name), 'utf8')
    } catch {
      continue
    }
    for (const match of text.matchAll(/ daemon_started .*?\bpid=(\d+)/g)) pids.push(Number(match[1]))
  }
  return pids
}

/** The full command lines of every process, by pid; empty on Windows, which has no `ps`. */
function commandLines(): Map<number, string> {
  const lines = new Map<number, string>()
  if (process.platform === 'win32') return lines
  const listed = spawnSync('ps', ['-ax', '-ww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout
  for (const line of listed.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (match !== null) lines.set(Number(match[1]), match[2] ?? '')
  }
  return lines
}

function realOrSame(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export class OwnDaemons {
  private readonly pids = new Set<number>()
  private readonly ports = new Set<number>()
  private readonly keys = new Set<string>()
  private readonly bundles = new Set<string>()

  constructor(readonly dataFolder: string, bundles: Iterable<string> = []) {
    for (const bundle of bundles) this.addBundle(bundle)
    this.note()
  }

  /** A bundle the test runs kurmis from; its daemons count as the test's. */
  addBundle(bundle: string): void {
    this.bundles.add(bundle)
    this.bundles.add(realOrSame(bundle))
  }

  /** A pid the test knows to be one of its daemons, or to have been one. */
  notePid(pid: number): void {
    if (pid !== process.pid) this.pids.add(pid)
  }

  /**
   * Notes what the data folder names now: the pid and port in `daemon.json`, the port in
   * `config.json`, the key, and the pids `daemon.log` names. Call it while the test runs too, so
   * a key or port the test changes later is still known.
   */
  note(): void {
    const read = readDaemonFile(join(this.dataFolder, 'daemon.json'))
    if (read.status === 'ok') {
      this.notePid(read.info.pid)
      this.ports.add(read.info.port)
    }
    try {
      const config = JSON.parse(readFileSync(join(this.dataFolder, 'config.json'), 'utf8')) as { port?: unknown }
      if (typeof config.port === 'number') this.ports.add(config.port)
    } catch { /* No config.json, or a test wrote a damaged one. */ }
    try {
      const key = readKey(join(this.dataFolder, 'key'))
      if (key !== null) this.keys.add(key)
    } catch { /* Unreadable. */ }
    for (const pid of loggedDaemonPids(this.dataFolder)) this.notePid(pid)
  }

  /** Whether any pid has been seen. */
  get seen(): boolean {
    return this.pids.size > 0
  }

  /** The pids that are shown to be a daemon of this data folder now (see the header). */
  async provenPids(): Promise<Set<number>> {
    const proven = new Set<number>()
    for (const port of this.ports) {
      for (const key of this.keys) {
        const holder = await portHolder(port, key, 2_000)
        if (holder.kind === 'kurmis') {
          proven.add(holder.status.pid)
          break
        }
        if (holder.kind === 'free') break
      }
    }
    const names = [...this.bundles]
    for (const [pid, command] of commandLines()) {
      if (pid !== process.pid && names.some((name) => command.includes(`${name} `))) proven.add(pid)
    }
    return proven
  }

  /**
   * Kills every daemon shown to be this data folder's and waits for it to exit. A pid that was
   * seen and still exists but cannot be shown to be one (only on Windows) is waited for up to
   * `waitMs` without a signal, and checked again meanwhile, since a daemon that was starting
   * may bind the port after the test's `daemon stop` freed it.
   */
  async stop(waitMs = 10_000): Promise<void> {
    this.note()
    const deadline = Date.now() + waitMs
    for (;;) {
      const proven = await this.provenPids()
      for (const pid of proven) {
        this.notePid(pid)
        try {
          process.kill(pid, 'SIGKILL')
        } catch { /* Gone already. */ }
      }
      const until = Date.now() + 5_000
      while ([...proven].some(processExists) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20))
      this.note()
      const waiting = [...this.pids].filter((pid) => !proven.has(pid) && processExists(pid))
      if (process.platform !== 'win32' || waiting.length === 0 || Date.now() > deadline) return
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
}
