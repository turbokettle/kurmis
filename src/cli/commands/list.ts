import { ConfigError, loadConfig, type LoginSettings } from '../../data/config.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, writeLine, type Command } from '../command.ts'

/** The logins as a table with a header row, columns padded to their widest cell. */
export function formatLoginTable(logins: readonly LoginSettings[]): string {
  const rows = [
    ['ID', 'LABEL', 'ROUTING', '5H LIMIT', 'WEEKLY LIMIT', 'USE FIRST'],
    ...logins.map((login) => [
      login.id,
      login.label,
      login.routing ? 'on' : 'off',
      `${String(login.fiveHourLimit)}%`,
      `${String(login.weeklyLimit)}%`,
      login.useFirst ? 'yes' : 'no'
    ])
  ]
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)))
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd()).join('\n')
}

export const listCommand: Command = {
  name: 'list',
  summary: 'List the logins and their routing settings',
  usage: `Usage: kurmis list [--json]

Lists every login kurmis knows, the machine's own claude:default and codex:default first, with
whether routing may use it, its five-hour and weekly limits, and whether it is used first.

Options:
  --json       Print the logins as JSON.
  -h, --help   Show this help.`,
  run(args, context) {
    const parsed = parseCommandArgs('list', args, { json: { type: 'boolean' } }, context)
    if (typeof parsed === 'number') return parsed
    let logins: LoginSettings[]
    try {
      logins = loadConfig().logins
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error
      writeLine(context.stderr, `kurmis list: ${error.message}`)
      return EXIT_FAILURE
    }
    writeLine(context.stdout, parsed.values.json === true ? JSON.stringify(logins, null, 2) : formatLoginTable(logins))
    return EXIT_OK
  }
}
