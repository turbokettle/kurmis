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

Your machine's own logins are always there: one for whatever `claude` is signed in to and one
for whatever `codex` is signed in to. Add the other subscriptions with `kurmis login`:

```sh
kurmis login claude                 # opens the browser to sign in a new Claude login
kurmis login claude --alias side    # the same, with the alias side
kurmis login codex                  # a new Codex login
kurmis list                         # every login and its settings
```

Each login has a random id, such as `k3v9q2m7xa`, and an alias, which is the name you see and
type. Kurmis makes the alias from the account's email: `work@example.com` gives `work-example`.
Until kurmis knows the email, the alias is the id.

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
kurmis login claude|codex [--alias <alias>]
kurmis login <login> [--alias <alias>]
```

The first form adds a new login and signs it in with `claude auth login` or `codex login`, which
open the browser. The second form signs an existing login in again, for example after it was
signed out: `kurmis login work-example`. This works for the machine's own logins too.

**Naming a login.** Every command takes a login by its alias or its id, and upper and lower
case count the same. When a Claude login and a Codex login have the same alias, `kurmis login`,
`set` and `logout` need `claude:` or `codex:` in front, for example `claude:work-example`.
`kurmis claude --login` and `kurmis codex --login` look only at their own provider's logins,
so they never need it.

**The alias.** Right after the sign-in, kurmis prints the account's email and gives the login
the alias made from it: the email without its top-level domain, in lowercase, with every run of
other characters than letters and digits turned into `-`, at most 32 characters. When another
login of the same provider has that alias already, the new one gets `-2`, `-3`, and so on. The
machine's own logins get their alias when the daemon first reads their usage. The alias follows
the email when the account changes. While kurmis cannot read the email, the login keeps the
alias it has. Kurmis keeps no email in its files.

`--alias` sets an alias of your own instead. It is 1 to 32 lowercase letters, digits, `-` or
`_`, starts with a letter or digit, and is not `claude` or `codex`. No other login of the same
provider may have it, and it may not be another login's id. `kurmis set <login> --alias <alias>`
changes it. Kurmis never replaces an alias you set, and no command makes it follow the email
again.

**An account that is already a login.** When you sign in to an account that is already a kurmis
login of the same provider, the machine's own login included, kurmis signs the new sign-in out
again, adds nothing, and says which login the account is. `kurmis login <that login>` signs that
login in again.

If the sign-in fails, nothing is added. Only one `kurmis login` or `kurmis logout` of the same
login runs at a time; a second one stops and says so.

### `kurmis claude`

```sh
kurmis claude [--login <login>] [--] [claude arguments...]
```

Starts Claude Code with the terminal attached and exits with its exit code. Every argument after
kurmis' own options goes to `claude` unchanged, so `kurmis claude --resume` or
`kurmis claude mcp list` work as usual. `kurmis claude -- --help` shows claude's own help.

- **Auto** (no `--login`): each request goes to a login that is opted in to routing and is
  under its limits. A login marked "use first" is taken first. Otherwise a new session goes to
  the login whose weekly usage resets soonest, and a session stays on the login that served it
  for as long as that login has room, because switching makes the next request rebuild the
  prompt cache.
- **`--login <login>`** keeps the session on one Claude login whatever its limits say, for
  example `--login work-example`.

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
kurmis codex [--login <login>] [--] [codex arguments...]
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

Shows each login by its alias, with its id and the account's email when the daemon knows it.
The machine's own logins are marked as such. For each login it shows the five-hour and weekly
usage with the time until each resets, its limits, whether routing may use it and how many
sessions it serves. A line starting with "passed over" says why Auto, or `kurmis codex`, would
skip that login now (signed out, at its limit, cooling down after a usage-limit answer). The
last line says which login `kurmis codex` would start on. A warning at the top says when an
extra login is the same account as the machine's own login of its provider, because both then
use one subscription. `--json` prints the same as JSON, in a shape that stays stable (see
`docs/architecture.md`).

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
kurmis set <login> [--auto on|off] [--five-hour <1-100>] [--weekly <1-100>] [--use-first on|off] [--alias <alias>]
```

Changes how routing treats a login:

- `--auto off` takes the login out of Auto routing (it still works with `--login`).
- `--five-hour 90` stops Auto using the login once its five-hour window is at 90%; `--weekly`
  does the same for the weekly window. Both default to 100.
- `--use-first on` makes Auto take this login before the others while it has room.
- `--alias` sets the login's alias, by the rules under `kurmis login`. Kurmis keeps it when the
  email changes.

For example `kurmis set work-example --weekly 80 --use-first on`. A running daemon picks up the
change at once.

### `kurmis logout`

```sh
kurmis logout <login>
```

Removes a login: it signs the login out with `claude auth logout` or `codex logout` (on macOS this
is what removes its Keychain item, on Windows its Windows Credential Manager record; kurmis warns
when it could not), removes it from kurmis' settings and deletes its folder. Links in a Codex
login's folder are removed, never what they point to, and so is kurmis' record of what it merged
into that folder. The machine's own logins cannot be removed; sign them out with
`claude auth logout` or `codex logout` if you want to.

`kurmis logout <id>` of an id that is not in kurmis' settings but has a folder there, for
example after a removal that stopped half-way, deletes that folder.

### `kurmis setup` (route every Claude Code)

```sh
kurmis setup
kurmis setup --undo
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

The machine's own Claude login is the login in `~/.claude`. When you run setup with
`CLAUDE_CONFIG_DIR` set, it writes `$CLAUDE_CONFIG_DIR/settings.json`, which only a `claude`
with that variable reads. Such a `claude` signs in with the login in that folder, which kurmis
does not know, so kurmis never signs its requests as the machine's own Claude login: they go to
your extra logins only. A `claude` with `CLAUDE_CONFIG_DIR` naming `~/.claude` itself, after a
setup run without the variable, reads `~/.claude/settings.json` and counts as a plain `claude`
on the machine's own Claude login (see "Known limits" in
[docs/architecture.md](docs/architecture.md)); unset the variable for it. `kurmis claude` is
not affected; it always starts claude on the login it names, the machine's own included.

On macOS and Windows, setup stops when `CLAUDE_CONFIG_DIR` names `~/.claude` itself: Claude
Code keeps separate credentials for a `claude` started with the variable set, even to that
folder, and both kinds of `claude` read `~/.claude/settings.json`. On every platform it also
stops when `$CLAUDE_CONFIG_DIR/settings.json` is a link to `~/.claude/settings.json`, for the
same reason. Unset the variable and run setup again.

Setup also warns when the file's `env` sets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, which make a plain
`claude` sign with that key or token, and leaves them.

`kurmis setup --undo` removes kurmis' settings again (a value you changed yourself is left and
reported) and the start at login. The daemon keeps running until you stop it, because
`kurmis claude` still uses it.

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
seconds for them; `restart` stops it and starts a new one; `run` runs it in the terminal, which
helps when looking into a problem.

## Uninstall

```sh
kurmis setup --undo      # only if you ran "kurmis setup"
kurmis logout <login>    # for each extra login, to remove its credentials
kurmis daemon stop
npm uninstall -g kurmis
```

Kurmis keeps its data in `~/.kurmis` (`%USERPROFILE%\.kurmis` on Windows). Uninstalling leaves
that folder; delete it to remove the extra logins' settings too. On macOS an extra Claude login's
credentials are in the Keychain; `kurmis logout <login>` removes them, deleting the folder does
not.

## Troubleshooting

- **What is the daemon doing?** Its log is `~/.kurmis/daemon.log` (the previous one is
  `daemon.log.1`). It holds login ids, status codes and timings, never tokens, request contents,
  aliases or emails. `kurmis status` shows what it knows about each login, with its alias and id.
- **Restarting the daemon.** `kurmis daemon restart`. Claude Code sessions that are open retry their
  requests for a few minutes and carry on once it is back.
- **The daemon cannot start because its port is in use.** Another program has kurmis' port (28411
  unless you changed it). Pick a free one by adding `"port": 28412` (any number from 1024 to 65535)
  to `~/.kurmis/config.json`, then run `kurmis daemon restart`. If you ran `kurmis setup`, run it
  again so `settings.json` names the new port.
- **"Not logged in" in Claude Code, or a login shown as signed out.** Sign it in again with
  `kurmis login <login>`, for example `kurmis login work-example`.
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
- **"config.json … was written by an older kurmis (config version 1)".** This kurmis reads only
  version 2 of `config.json`. Delete `~/.kurmis/config.json`, then add the extra logins again
  with `kurmis login claude` and `kurmis login codex`.
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
