# kurmis

Kurmis lets one person use several Claude Code and Codex subscription logins on one machine.

- `kurmis claude` starts Claude Code with its requests going through a small background process
  (the daemon). The daemon sends each request on a login that has usage left, and when a login
  hits its usage limit it sends the request again on another one before Claude Code notices.
- `kurmis codex` starts Codex on the login that has the most room, judged the same way.

Each extra login keeps only its credentials apart. Your settings, `CLAUDE.md`, skills, plugins,
MCP servers and transcripts stay the same whichever login a session runs on; the only thing a
login changes is which subscription is billed.

## Requirements

- **Node.js 22 or newer.** Node 22 is the oldest Node line that still gets security fixes, and
  the bundle is built for it.
- **git**, and ssh access to the `turbokettle/kurmis` repository on GitHub, because npm clones it.
- Claude Code (`claude`) and/or Codex (`codex`) installed as usual and on your `PATH`.
- macOS or Windows. Linux should work but is not tested.
- A machine only you use. The daemon listens on a fixed local port, and another user's program
  that took that port first would receive kurmis' key and, after `kurmis setup`, Claude Code's
  sign-in token.

## Install

```sh
npm i -g git+ssh://git@github.com/turbokettle/kurmis.git
```

To install a given release or branch, add it after `#`:

```sh
npm i -g "git+ssh://git@github.com/turbokettle/kurmis.git#v0.1.0"
npm i -g "git+ssh://git@github.com/turbokettle/kurmis.git#main"
```

The repository holds the built program (`dist/kurmis.cjs`), so the install runs no build step
and installs no other packages. Run the same command again to update. Check it with
`kurmis --version`.

## Getting started

Your machine's own logins are always there as `claude:default` and `codex:default`: whatever
`claude` and `codex` are signed in to now. Add the other subscriptions with `kurmis login`:

```sh
kurmis login claude                 # adds claude:2 and opens the browser to sign in
kurmis login claude --name work     # the same, named claude:work
kurmis login codex --name side      # a Codex login, codex:side
kurmis list                         # every login and its settings
```

Then use `kurmis claude` and `kurmis codex` where you used `claude` and `codex`:

```sh
kurmis claude                       # an interactive session, routed
kurmis claude -p "explain this"     # every claude argument works as before
kurmis codex                        # Codex on the login with the most room
kurmis status                       # how much each login has used
```

The daemon starts by itself the first time a command needs it.

## Commands

`kurmis help <command>` shows every option of a command.

### `kurmis login`

```sh
kurmis login claude|codex [--name <name>] [--label <text>]
kurmis login <id> [--label <text>]
```

The first form adds a new login and signs it in with `claude auth login` or `codex login`, which
open the browser. Without `--name` the login gets the first free number: `claude:2`,
`claude:3`, ... A name is 1 to 32 lowercase letters, digits, `-` or `_`.

The second form signs an existing login in again, for example after it was signed out:
`kurmis login claude:work`, or `kurmis login claude:default` for the machine's own.

Kurmis prints the email the login signed in with. It keeps no email itself: the label shown in
lists is the name unless you give `--label`. If the sign-in fails, nothing is added. Only one
`kurmis login` or `kurmis logout` of the same login runs at a time; a second one stops and says
so.

### `kurmis claude`

```sh
kurmis claude [--login <id>] [--] [claude arguments...]
```

Starts Claude Code with the terminal attached and exits with its exit code. Every argument after
kurmis' own options goes to `claude` unchanged, so `kurmis claude --resume` or
`kurmis claude mcp list` work as usual. `kurmis claude -- --help` shows claude's own help.

- **Auto** (no `--login`): each request goes to a login that is opted in to routing and is
  under its limits. A login marked "use first" is taken first. Otherwise a new session goes to
  the login whose weekly usage resets soonest, and a session stays on the login that served it
  for as long as that login has room, because switching makes the next request rebuild the
  prompt cache.
- **`--login <id>`** keeps the session on one login whatever its limits say: `--login work`
  means `claude:work`.

If you pass your own `--settings`, kurmis adds its settings to yours; your file is not changed.
The combined copy is kept in kurmis' data folder, readable only by you, and deleted when
`kurmis claude` ends, so a background session Claude Code starts after that cannot read it. Your
own `ENABLE_TOOL_SEARCH` or `CLAUDE_CODE_MAX_RETRIES`, wherever you set it, is left as it is.

A `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) in your shell would make claude sign its
requests with that token instead of a kurmis login, so `kurmis claude` starts claude without it
and says so. One in the `env` of your `--settings` or of `~/.claude/settings.json` is set to an
empty value for that claude, which Claude Code reads as unset, also with a note.

### `kurmis codex`

```sh
kurmis codex [--login <id>] [--] [codex arguments...]
```

Starts Codex on the login that ranks first by the same rules as Claude's Auto, or on the one
named with `--login`. Codex has no per-request routing, so the choice is made when it starts.
When every login is at its limit, kurmis starts on the one that gets its usage back first and
says when. Each extra Codex login has its own Codex home folder, which kurmis fills from
`~/.codex` before every start: your `config.toml` (without secrets), `AGENTS.md` and
`AGENTS.override.md`, and links to your other folders. Your sign-in (`auth.json`) is never
copied, and the Windows sandbox's `.sandbox` folders stay separate for each login. A
`cli_auth_credentials_store` setting in your `config.toml` reaches every login too, so with
`"keyring"` each login keeps its own sign-in in the Keychain or Credential Manager.

What Codex writes into a login's own `config.toml`, such as a `/model` choice, a dismissed
notice or a folder you trusted, stays there, and so does a setting removed from it: it stays
removed until `~/.codex/config.toml` changes that setting. A setting you change or remove in
`~/.codex/config.toml` is changed or removed in every login at its next start, and an MCP server
you remove there goes from every login whole, with what the login added to it. Secrets
(environment and header tables, tokens, passwords, API keys) are never copied; a login that
needs one keeps its own in its `config.toml`, and kurmis says when the default home has one the
login lacks.

### `kurmis status`

```sh
kurmis status [--json]
```

Shows each login's five-hour and weekly usage with the time until each resets, its limits,
whether routing may use it and how many sessions it serves. A line starting with "passed over"
says why Auto, or `kurmis codex`, would skip that login now (signed out, at its limit, cooling
down after a usage-limit answer). The last line says which login `kurmis codex` would start on.
`--json` prints the same as JSON, in a shape that stays stable (see `docs/architecture.md`).

### `kurmis list`

```sh
kurmis list [--json]
```

Lists the logins with their settings and whether credentials are on this machine. It does not
need the daemon and does not check that the credentials still work; `kurmis status` does. For a
Codex login whose `config.toml` keeps the sign-in in the Keychain or Credential Manager
(`cli_auth_credentials_store = "keyring"` or `"auto"`), it asks `codex login status`.

### `kurmis set`

```sh
kurmis set <id> [--auto on|off] [--five-hour <1-100>] [--weekly <1-100>] [--use-first on|off] [--label <text>]
```

Changes how routing treats a login:

- `--auto off` takes the login out of Auto routing (it still works with `--login`).
- `--five-hour 90` stops Auto using the login once its five-hour window is at 90%; `--weekly`
  does the same for the weekly window. Both default to 100.
- `--use-first on` makes Auto take this login before the others while it has room.
- `--label` sets the name shown in lists.

For example `kurmis set claude:work --weekly 80 --use-first on`. A running daemon picks up the
change at once.

### `kurmis logout`

```sh
kurmis logout <id>
```

Removes a login: it signs the login out with `claude auth logout` or `codex logout` (on macOS this
is what removes its Keychain item, on Windows its Windows Credential Manager record; kurmis warns
when it could not), removes it from kurmis' settings and deletes its folder. Links in a Codex
login's folder are removed, never what they point to, and so is kurmis' record of what it merged
into that folder. The machine's own `claude:default` and `codex:default` cannot be removed; sign
them out with `claude auth logout` or `codex logout` if you want to.

### `kurmis setup` (route every Claude Code)

```sh
kurmis setup
kurmis setup --pause
kurmis setup --uninstall-and-logout
```

Without setup, only Claude Code started through `kurmis claude` is routed. `kurmis setup` makes
a plain `claude`, and the Claude Code extensions in your editor, use kurmis too:

- it starts the daemon, and changes nothing when it cannot;
- it adds kurmis' four settings (`ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`,
  `ENABLE_TOOL_SEARCH`, `CLAUDE_CODE_MAX_RETRIES`) to the `env` block of
  `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json` when you set that variable),
  leaving everything else in the file as it was. Because the file then holds kurmis' key, setup
  makes it readable only by you (on macOS and Linux);
- it saves a copy of the file as `settings.json.kurmis-backup` before it adds kurmis' settings
  (a later setup that only updates them keeps that copy);
- it makes the daemon start when you log in (a launch agent on macOS, a logon entry on
  Windows). On Linux there is no start at login; the next kurmis command starts the daemon.

A plain `claude` then runs on Auto. Restart Claude Code sessions and editors that were already
open. If the file already points `ANTHROPIC_BASE_URL` at another proxy, setup stops and changes
nothing.

`claude:default` is the login in `~/.claude`. When you run setup with `CLAUDE_CONFIG_DIR` set,
it writes `$CLAUDE_CONFIG_DIR/settings.json`, which only a `claude` with that variable reads.
Such a `claude` signs in with the login in that folder, which kurmis does not know, so kurmis
never signs its requests as `claude:default`: they go to your extra logins only. A `claude` with
`CLAUDE_CONFIG_DIR` naming `~/.claude` itself, after a setup run without the variable, reads
`~/.claude/settings.json` and counts as a plain `claude` on `claude:default` (see "Known
limits" in [docs/architecture.md](docs/architecture.md)); unset the variable for it.
`kurmis claude` is not affected; it always starts claude on the login it names,
`claude:default` included.

On macOS and Windows, setup stops when `CLAUDE_CONFIG_DIR` names `~/.claude` itself: Claude
Code keeps separate credentials for a `claude` started with the variable set, even to that
folder, and both kinds of `claude` read `~/.claude/settings.json`. On every platform it also
stops when `$CLAUDE_CONFIG_DIR/settings.json` is a link to `~/.claude/settings.json`, for the
same reason. Unset the variable and run setup again.

Setup also warns when the file's `env` sets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, which make a plain
`claude` sign with that key or token, and leaves them.

`kurmis setup --pause` takes kurmis' settings out of the file again; a value you changed
yourself is left and reported. A plain `claude` and the editor extensions then no longer go
through kurmis. The daemon, its start at login, your logins and the backup copy stay, so
`kurmis claude` keeps working. `kurmis setup` turns global routing on again.

`kurmis setup --uninstall-and-logout` removes everything kurmis set up; see "Uninstall" below.

Claude Code sessions and editors that are already open keep the settings they started with, so
restart them after any of these.

**Working over ssh.** On macOS, a daemon started from an ssh login cannot read the login
Keychain, so the logins whose token is in the Keychain are not routed. `kurmis status` shows
them without a token. Run `kurmis setup` in a terminal at the screen: the daemon then runs in
your desktop session, starts again at each login, and kurmis commands over ssh use it. Without
setup, run any kurmis command once in a terminal at the screen before you work over ssh. When a
daemon started from ssh already runs, `kurmis daemon restart` at the screen replaces it. After
an update, the first kurmis command replaces the older daemon with one started from where that
command runs, so run it at the screen too.

On Windows, a daemon started from an ssh session ends when that session ends, and the next
kurmis command starts it again. After `kurmis setup`, the daemon started at logon keeps running
and ssh sessions use it.

On macOS, launchd may not be able to start the login item when Node, kurmis or the kurmis data
folder is on an external volume. Then the daemon does not start at login, and the next kurmis
command starts it.

### `kurmis daemon`

```sh
kurmis daemon start|stop|restart|status|run
```

You seldom need these: the other commands start the daemon when they need it, and a newer
kurmis replaces an older daemon by itself. `kurmis daemon status` shows whether it runs, its pid
and port; `stop` stops it after it finishes the requests it has open, waiting at most 30
seconds for them; `stop --now` stops it at once and cuts those requests, and an open Claude
session then sees a dropped connection and retries the request; `restart` stops it and starts a
new one; `run` runs it in the terminal, which helps when looking into a problem.

## Uninstall

```sh
kurmis setup --uninstall-and-logout
npm uninstall -g kurmis
```

`kurmis setup --uninstall-and-logout` lists what it will remove and asks before it removes
anything; `--yes` skips the question, and without a terminal it needs `--yes`. It removes:

- kurmis' settings in your Claude Code settings file, and the backup copy setup made;
- the daemon's start at login;
- every login you added to kurmis. Each is signed out first, which removes its Keychain item
  on macOS or its Windows Credential Manager record;
- the daemon, which it stops;
- the kurmis data folder, `~/.kurmis` (`%USERPROFILE%\.kurmis` on Windows). Links in a Codex
  login's folder are removed, never what they point to, and files in the folder that kurmis did
  not write are left.

Your own Claude Code and Codex sign-ins are not signed out, so a plain `claude` and `codex` keep
working. When a login cannot be signed out or the daemon cannot be stopped, the command says
which, keeps the data folder, and exits 1; run it again once that is fixed. Its last line tells
you to run `npm uninstall -g kurmis`.

## Troubleshooting

- **What is the daemon doing?** Its log is `~/.kurmis/daemon.log` (the previous one is
  `daemon.log.1`). It names logins, status codes and timings, never tokens, request contents or
  emails. `kurmis status` shows what it knows about each login.
- **Restarting the daemon.** `kurmis daemon restart`. Claude Code sessions that are open retry their
  requests for a few minutes and carry on once it is back.
- **The daemon cannot start because its port is in use.** Another program has kurmis' port (28411
  unless you changed it). Pick a free one by adding `"port": 28412` (any number from 1024 to 65535)
  to `~/.kurmis/config.json`, then run `kurmis daemon restart`. If you ran `kurmis setup`, run it
  again so `settings.json` names the new port.
- **"Not logged in" in Claude Code, or a login shown as signed out.** Sign it in again with
  `kurmis login <id>`, for example `kurmis login claude:work`.
- **macOS asks whether `security` may use a Keychain item.** That is the daemon reading a
  login's token, which the macOS `security` program fetches. Choose "Always Allow" so it does
  not ask again for that login.
- **Working over ssh on a Mac.** See "Working over ssh" under `kurmis setup`.
- **"kurmis was started by the program it started".** The `claude` or `codex` that kurmis found
  on your `PATH` is a script or alias that runs kurmis again. Take it off `PATH`, or set
  `KURMIS_CLAUDE_BIN` (or `KURMIS_CODEX_BIN`) to the full path of the real program.
- **Windows: PowerShell says running `kurmis.ps1` is disabled on this system.** PowerShell's
  default execution policy blocks the `kurmis.ps1` script npm installs next to `kurmis.cmd`.
  Run `kurmis.cmd` instead (it takes the same arguments), or allow local scripts for your user
  with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. This is how every program installed
  with npm behaves on Windows.
- **Windows: "Terminate batch job (Y/N)?" after Ctrl-C.** In `cmd.exe`, `kurmis` runs through
  npm's `kurmis.cmd`, and `cmd.exe` asks this whenever a batch file was interrupted. It asks
  once kurmis has finished, so either answer just ends the batch file. This is standard for
  programs installed with npm.
- **Windows: setup says the logon entry was not written because of Windows Script Host.** The
  logon entry starts the daemon without a console window through `wscript.exe`. When Windows
  Script Host is missing or turned off, setup writes no entry, warns and still exits 0; the next
  kurmis command starts the daemon anyway.
- **"Could not lock …config.json.lock".** Another kurmis command is changing the settings right
  now; try again. If no kurmis command is running, delete `~/.kurmis/config.json.lock`.
- **A command says the daemon could not be reached.** Look at the end of `daemon.log`, or run
  `kurmis daemon run` to see it start in the terminal.

## More

[docs/scope.md](docs/scope.md) says what kurmis does and leaves out, and
[docs/architecture.md](docs/architecture.md) how it works.
[docs/manual-testing.md](docs/manual-testing.md) lists the checks that need a real machine.

## Development

`pnpm install`, then `pnpm test`, `pnpm check` (type check and lint) and `pnpm bundle` (writes
`dist/kurmis.cjs`, which is committed together with the change that produced it).
