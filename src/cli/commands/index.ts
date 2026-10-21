// Every `kurmis` command, in the order `kurmis --help` lists them.
import type { Command } from '../command.ts'
import { claudeCommand } from './claude.ts'
import { codexCommand } from './codex.ts'
import { daemonCommand } from './daemon.ts'
import { listCommand } from './list.ts'
import { loginCommand } from './login.ts'
import { logoutCommand } from './logout.ts'
import { setupCommand } from './setup.ts'
import { statusCommand } from './status.ts'

export const COMMANDS: readonly Command[] = [
  claudeCommand,
  codexCommand,
  statusCommand,
  listCommand,
  loginCommand,
  logoutCommand,
  setupCommand,
  daemonCommand
]

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((command) => command.name === name)
}
