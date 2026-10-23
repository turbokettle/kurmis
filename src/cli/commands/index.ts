// Every `kurmis` command, in the order `kurmis --help` lists them.
import type { Command } from '../command.ts'
import { claudeCommand } from './claude.ts'
import { daemonCommand } from './daemon.ts'
import { loginCommand } from './login.ts'
import { logoutCommand } from './logout.ts'
import { setCommand } from './set.ts'
import { setupCommand } from './setup.ts'
import { statusCommand } from './status.ts'

export const COMMANDS: readonly Command[] = [
  claudeCommand,
  statusCommand,
  setCommand,
  loginCommand,
  logoutCommand,
  setupCommand,
  daemonCommand
]

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((command) => command.name === name)
}
