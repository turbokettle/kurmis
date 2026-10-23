# kurmis

Kurmis lets one person use several Claude Code subscription logins on one machine.

`kurmis claude` starts Claude Code with its requests going through a small background process
(the daemon). The daemon sends each request on a login that has usage left, and when a login hits
its usage limit it sends the request again on another one before Claude Code notices.

Each extra login keeps only its credentials apart. Your settings, `CLAUDE.md`, skills, plugins,
MCP servers and transcripts stay the same whichever login a session runs on; the only thing a
login changes is which subscription is billed.

## Requirements

- **Node.js 22 or newer.** The bundle is built for Node 22.
- **git**, and ssh access to the `turbokettle/kurmis` repository on GitHub, because npm clones it.
- Claude Code (`claude`) installed as usual and on your `PATH`.
- macOS or Windows. Linux should work but is not tested.
- A machine only you use. The daemon listens on a fixed local port, and another user's program
  that took that port first would receive kurmis' key and, after `kurmis setup`, Claude Code's
  sign-in token.

## Install

```sh
npm i -g git+ssh://git@github.com/turbokettle/kurmis.git
```

To install a given commit, tag or branch, add it after `#`:

```sh
npm i -g "git+ssh://git@github.com/turbokettle/kurmis.git#main"
```

The repository holds the built program (`dist/kurmis.cjs`), so the install runs no build step
and installs no other packages. Run the same command again to update. Check it with
`kurmis --version`.

## Getting started

One login is always there: the login plain `claude` uses, which is whatever `claude` run without
kurmis is signed in to. Add the other subscriptions with `kurmis login`:

```sh
kurmis login                        # opens the browser to sign in a new login
kurmis login --alias side           # the same, with the alias side
kurmis status                       # every login, its settings and its usage
```

Each login has a random id, such as `k3v9q2m7xa`, and an alias, which is the name you see and
type. Kurmis makes the alias from the account's email: `work@example.com` gives `work-example`.
Until kurmis knows the email, the alias is the id.

Then use `kurmis claude` where you used `claude`:

```sh
kurmis claude                       # an interactive session, routed
kurmis claude -p "explain this"     # claude's own arguments go after "claude"
```

`kurmis claude` starts the daemon when it is not running.

## Commands

`kurmis help <command>` shows every option of a command.

### `kurmis login`

```sh
kurmis login [--alias <alias>]
kurmis login <login> [--alias <alias>]
```

The first form adds a new login and signs it in with `claude auth login`, which opens the
browser. The second form signs an existing login in again, for example after it was signed out:
`kurmis login work-example`. This works for the login plain `claude` uses too.

**Naming a login.** Every command takes a login by its alias or its id, and upper and lower
case count the same.

**The alias.** Kurmis names a login after its account's email: `work@example.com` gives
`work-example`. When another login has that name already, the new one gets `-2`, `-3`, and so
on. The login plain `claude` uses gets its alias when the daemon first reads its usage. The
alias follows the email when the account changes. Kurmis keeps no email in its files.

`--alias` sets an alias of your own instead: 1 to 32 lowercase letters, digits, `-` or `_`,
starting with a letter or digit, and not the alias or id of another login.
`kurmis set <login> --alias <alias>` changes it. Kurmis never replaces an alias you set.

**An account that is already a login.** Signing in to an account that is already a kurmis
login, the login plain `claude` uses included, adds nothing: kurmis signs the new sign-in out
again and says which login the account is. When `kurmis login <login>` signs an existing login
in to an account that another login already has, kurmis warns that the two logins are now the
same account.

An account is its email together with its organization. One email can have a personal plan and
a seat in a Team or Enterprise organization. Those are two subscriptions, so they become two
logins, and the second one's alias gets `-2` at the end (`work-example-2`). When the
organization of either login is not recorded, the email alone decides.

If the sign-in fails, nothing is added.

### `kurmis claude`

```sh
kurmis [--login <login>] claude [<claude arguments...>]
```

Starts Claude Code with the terminal attached and exits with its exit code. kurmis' options go
before `claude`, and claude's arguments after it, as in `kurmis claude --resume` or
`kurmis --login work-example claude mcp list`. Claude's arguments are passed on unchanged,
except a `--settings` of yours, which kurmis merges with its own (below). `kurmis help claude`
shows kurmis' help; `kurmis claude --help` shows claude's. To use kurmis every time you run
claude, add `alias claude='kurmis claude'` to your shell.

- **Auto** (no `--login`): each request goes to a login that is opted in to routing and is
  under its limits. Logins marked "use first" are taken before the others whenever one has room,
  even by a session that was running on an unmarked login. Otherwise a new session goes to the
  login whose weekly usage resets soonest, and a session stays on the login that served it for
  as long as that login has room, because switching makes the next request rebuild the prompt
  cache. When no login is opted in to routing, Auto sends every request with the login plain
  `claude` uses.
- **`--login <login>`** sends every request of the session with one login, even when it
  is out of usage, for example `--login work-example`.

claude needs a signed-in login of its own to start, even though the daemon re-signs every
request. On Auto, kurmis starts it on the login plain `claude` uses, or, when that login is
signed out, on another signed-in login, and says so. This does not change where the requests
go.

If you pass your own `--settings`, kurmis adds its settings to yours; your file is not changed.
The combined copy is kept in kurmis' data folder, readable only by you, and deleted when
`kurmis claude` ends, so a background session Claude Code starts after that cannot read it. Your
own `ENABLE_TOOL_SEARCH` or `CLAUDE_CODE_MAX_RETRIES`, wherever you set it, is left as it is.

A `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) in your shell would make claude sign its
requests with that token instead of a kurmis login, so `kurmis claude` starts claude without it
and says so. One in the `env` of your `--settings` or of `~/.claude/settings.json` is set to an
empty value for that claude, which Claude Code reads as unset, also with a note.

### `kurmis status`

```sh
kurmis status [--json]
```

Shows every login by its alias, with its id (when the alias is not the id), its settings and
its usage, whether the daemon is running, and whether global routing (`kurmis setup`) is on,
paused or off, with the command that changes it. It does not start the daemon, and it exits 0
whether the daemon runs or not.

The login plain `claude` uses is marked as such. A warning at the top says when two logins are
the same account, because both then use one subscription. Another warning says when global
routing is on but the daemon is not running, because a plain `claude` then cannot reach
Anthropic.

While the daemon runs, the status comes from it. For each login it shows the account's email,
whether the login is signed in, the five-hour and weekly usage with the time until each resets,
and the number of sessions placed on it in the last 7 days (kurmis keeps at most 2000). A line
starting with "passed over" says why Auto would skip that login now (signed out, at its limit,
cooling down after a usage-limit answer). When the daemon runs an older kurmis than the one you
run, `status` says so: the next command that starts the daemon replaces it. When the daemon is
newer, `status` says that too, and when this kurmis cannot read its status it says what to do.

While the daemon is not running, the first line says so and names the commands that start it:
`kurmis claude`, `kurmis setup` and `kurmis daemon start`. The logins and their settings come
from `~/.kurmis/config.json`, and the usage is the last the daemon read, with how long ago it
read it. Kurmis cannot tell then whether a login is signed in, so it shows whether the login's
token is on this machine, or `unknown` when it cannot check. That does not show that the token
still works. The same goes when the daemon runs but does not answer; a note on stderr says so.

`--json` prints the same as JSON (see `docs/architecture.md` for its shape).

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

Removes a login: it signs the login out with `claude auth logout` (on macOS this is what
removes its Keychain item, on Windows its Windows Credential Manager record; kurmis warns when it
could not), removes it from kurmis' settings and deletes its folder. The login plain `claude`
uses cannot be removed; sign it out with `claude auth logout` if you want to.

`kurmis logout <id>` of an id that is not in `~/.kurmis/config.json` but has a folder in the
kurmis data folder, for example after a removal that stopped half-way, signs it out and deletes
that folder.

### `kurmis setup` (global routing)

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
  (a later setup that only updates them keeps that copy), and adds the file to a list in the
  data folder, so `--pause` and `--uninstall-and-logout` find it whatever `CLAUDE_CONFIG_DIR` is
  set to when you run them;
- it makes the daemon start when you log in (a launch agent on macOS, a logon entry on
  Windows). On Linux there is no start at login; the next `kurmis claude` starts the daemon.

A plain `claude` then runs on Auto. If the file already points `ANTHROPIC_BASE_URL` at another
proxy, setup stops and changes nothing.

The login plain `claude` uses is the login in `~/.claude`. When you run setup with
`CLAUDE_CONFIG_DIR` set, it writes `$CLAUDE_CONFIG_DIR/settings.json`. A `claude` that reads
that file signs in with the login in that folder, which kurmis does not know, so kurmis sends
its requests only to your extra logins. Setup stops when `CLAUDE_CONFIG_DIR` names `~/.claude`
itself (on macOS and Windows), or when `$CLAUDE_CONFIG_DIR/settings.json` is a link to
`~/.claude/settings.json`. Claude Code keeps separate credentials for a `claude` started with
the variable set, and both kinds of `claude` would read one settings file. Unset the variable
and run setup again. After a setup without the variable, do not run a plain `claude` with
`CLAUDE_CONFIG_DIR` naming `~/.claude` (see "Known limits" in
[docs/architecture.md](docs/architecture.md)).

Setup also warns when the file's `env` sets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, which take the place of
a login in a plain `claude`, and leaves them as they are.

`kurmis setup --pause` takes kurmis' settings out of every settings file setup changed; a value
you changed yourself is left and reported. A plain `claude` and the editor extensions then send
their requests to Anthropic directly. The daemon, its start at login, your logins and the backup
copy stay, so `kurmis claude` keeps working, and `kurmis status` shows global routing as paused.
`kurmis setup` turns global routing on again.

`kurmis setup --uninstall-and-logout` removes everything kurmis set up; see "Uninstall" below.

Claude Code sessions and editors that are already open keep the settings they started with, so
restart them after any of these.

**Working over ssh.** On macOS, a daemon started from an ssh login cannot read the login
Keychain, so the logins whose token is in the Keychain are not routed. `kurmis status` shows
them without a token. Run `kurmis setup` in a terminal at the screen: the daemon then runs in
your desktop session, starts again at each login, and kurmis commands over ssh use it. Without
setup, run `kurmis daemon start` once in a terminal at the screen before you work over ssh. When
a daemon started from ssh already runs, `kurmis daemon restart` at the screen replaces it. After
an update, the first command that starts the daemon (`kurmis claude`, `kurmis setup` or
`kurmis daemon start`) replaces the older daemon with one started from where that command runs,
so run it at the screen too.

On Windows, a daemon started from an ssh session ends when that session ends, and the next
`kurmis claude` starts it again. After `kurmis setup`, the daemon started at logon keeps running
and ssh sessions use it.

On macOS, launchd may not be able to start the login item when Node, kurmis or the kurmis data
folder is on an external volume. Then the daemon does not start at login, and the next
`kurmis claude` starts it.

### `kurmis daemon`

```sh
kurmis daemon start|stop|restart|status|run
```

You seldom need these: `kurmis claude` and `kurmis setup` start the daemon when they need it,
and replace a daemon of an older kurmis. `kurmis daemon status` shows whether it runs, its pid
and port; `stop` stops it after it finishes the requests it has open, waiting at most 30
seconds for them; `stop --now` stops it at once and cuts those requests, and an open Claude
session then sees a dropped connection and retries the request; `restart` starts a new daemon
at once, while the old one finishes its open requests in the background; `run` runs it in the
terminal, which helps when looking into a problem.

A daemon is older when it comes from an earlier build of kurmis, so updating kurmis replaces the
running daemon at the next command that starts it. A newer daemon is never replaced. When this
kurmis cannot use it, `kurmis claude`, `kurmis setup` and `kurmis daemon start` say so; update
kurmis, or run `kurmis daemon stop` and then the command again.

## Uninstall

```sh
kurmis setup --uninstall-and-logout
npm uninstall -g kurmis
```

`kurmis setup --uninstall-and-logout` lists what it will remove and asks before it removes
anything; `--yes` skips the question, and without a terminal it needs `--yes`. It removes:

- kurmis' settings in every Claude Code settings file setup changed, and the backup copies
  setup made;
- the daemon's start at login;
- every login you added to kurmis. Each is signed out first, which removes its Keychain item
  on macOS or its Windows Credential Manager record;
- the daemon, which it stops;
- the kurmis data folder, `~/.kurmis` (`%USERPROFILE%\.kurmis` on Windows). Kurmis deletes the
  files and folders it knows by name, with everything in them. Other entries at the top of the
  data folder are left, and then so is the folder.

The login plain `claude` uses is not signed out, so a plain `claude` keeps working. When a step
fails, the command says which and what to do, keeps the data folder and exits 1; run it again
once that is fixed. When every step worked, the command's last line tells you to run
`npm uninstall -g kurmis`.

## Troubleshooting

- **What is the daemon doing?** Its log is `~/.kurmis/daemon.log` (the previous one is
  `daemon.log.1`). It holds login ids, status codes and timings, never tokens, request contents,
  aliases or emails. `kurmis status` shows what it knows about each login, with its alias and id.
- **Restarting the daemon.** `kurmis daemon restart`. Claude Code sessions that are open retry
  their requests for a few minutes and carry on once it is back.
- **The daemon cannot start because its port is in use.** Another program has kurmis' port
  (28411 unless you changed it). Pick a free one by adding `"port": 28412` (any number from 1024
  to 65535) to `~/.kurmis/config.json`, then run `kurmis daemon restart`. If you ran
  `kurmis setup`, run it again so `settings.json` names the new port.
- **"Not logged in" in Claude Code, or a login shown as signed out.** Sign it in again with
  `kurmis login <login>`, for example `kurmis login work-example`.
- **macOS asks whether `security` may use a Keychain item.** That is the daemon reading a
  login's token, which the macOS `security` program fetches. Choose "Always Allow" so it does
  not ask again for that login.
- **Working over ssh on a Mac.** See "Working over ssh" under `kurmis setup`.
- **"kurmis was started by the program it started".** The `claude` that kurmis found on your
  `PATH` is a script or alias that runs kurmis again. Take it off `PATH`, or set
  `KURMIS_CLAUDE_BIN` to the full path of the real program.
- **Windows: PowerShell says running `kurmis.ps1` is disabled on this system.** PowerShell's
  default execution policy blocks the `kurmis.ps1` script npm installs next to `kurmis.cmd`.
  Run `kurmis.cmd` instead (it takes the same arguments), or allow local scripts for your user
  with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. This is how every program installed
  with npm behaves on Windows.
- **Windows: "Terminate batch job (Y/N)?" after Ctrl-C.** In `cmd.exe`, `kurmis` runs through
  npm's `kurmis.cmd`, and `cmd.exe` asks this whenever a batch file was interrupted. It asks
  once kurmis has finished, so either answer just ends the batch file.
- **Windows: setup says the logon entry was not written because of Windows Script Host.** The
  logon entry starts the daemon without a console window through `wscript.exe`. When Windows
  Script Host is missing or turned off, setup writes no entry, warns and still exits 0;
  `kurmis claude` starts the daemon anyway.
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
