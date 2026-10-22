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

Two logins are always there: the login plain `claude` uses, which is whatever `claude` run without
kurmis is signed in to, and the login plain `codex` uses, the same for `codex`. Add the other
subscriptions with `kurmis login`:

```sh
kurmis login claude                 # opens the browser to sign in a new Claude login
kurmis login claude --alias side    # the same, with the alias side
kurmis login codex                  # a new Codex login
kurmis status                       # every login, its settings and its usage
```

Each login has a random id, such as `k3v9q2m7xa`, and an alias, which is the name you see and
type. Kurmis makes the alias from the account's email: `work@example.com` gives `work-example`.
Until kurmis knows the email, the alias is the id.

Then use `kurmis claude` and `kurmis codex` where you used `claude` and `codex`:

```sh
kurmis claude                       # an interactive session, routed
kurmis claude -p "explain this"     # every claude argument works as before
kurmis codex                        # Codex on the login with the most room
```

`kurmis claude` and `kurmis codex` start the daemon when it is not running.

## Commands

`kurmis help <command>` shows every option of a command.

### `kurmis login`

```sh
kurmis login claude|codex [--alias <alias>]
kurmis login <login> [--alias <alias>]
```

The first form adds a new login and signs it in with `claude auth login` or `codex login`, which
open the browser. The second form signs an existing login in again, for example after it was
signed out: `kurmis login work-example`. This works for the logins plain `claude` and plain
`codex` use too.

**Naming a login.** Every command takes a login by its alias or its id, and upper and lower
case count the same. When a Claude login and a Codex login have the same alias, `kurmis login`,
`set` and `logout` need `claude:` or `codex:` in front, for example `claude:work-example`.
`kurmis claude --login` and `kurmis codex --login` look only at their own provider's logins,
so they never need it.

**The alias.** Right after the sign-in, kurmis prints the account's email and gives the login
the alias made from it: the email without its top-level domain, in lowercase, with every run of
other characters than letters and digits turned into `-`, at most 32 characters. When another
login of the same provider has that alias already, the new one gets `-2`, `-3`, and so on. The
logins plain `claude` and plain `codex` use get their alias when the daemon first reads their
usage. The alias follows
the email when the account changes. While kurmis cannot read the email, the login keeps the
alias it has. Kurmis keeps no email in its files.

`--alias` sets an alias of your own instead. It is 1 to 32 lowercase letters, digits, `-` or
`_`, starts with a letter or digit, and is not `claude` or `codex`. No other login of the same
provider may have it, and it may not be another login's id. `kurmis set <login> --alias <alias>`
changes it. Kurmis never replaces an alias you set, and no command makes it follow the email
again.

**An account that is already a login.** When you sign in to an account that is already a kurmis
login of the same provider, the login plain `claude` or plain `codex` uses included, kurmis signs
the new sign-in out again, adds nothing, and says which login the account is. `kurmis login <that
login>` signs that login in again. A `--alias` you gave is then not used, and kurmis says so.
When `kurmis login <login>` signs an existing login in to an account that another login of the
same provider already has, kurmis warns that the two logins are now the same account. It signs
neither of them out.

A Claude account is its email together with its organization, which Claude Code records in its
profile. One email can have a personal plan and a seat in a Team or Enterprise organization;
those are two subscriptions, so `kurmis login claude` adds the second as a login of its own, and
its alias gets `-2` at the end (`work-example-2`). When the organization of either login is not
recorded, the email alone decides. A Codex account is its email.

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
- **`--login <login>`** sends every request of the session with one Claude login, even when it
  is out of usage, for example `--login work-example`.

claude needs a signed-in login of its own to start, even though the daemon re-signs every
request. On Auto, kurmis starts it on the login plain `claude` uses, or, when that login is
signed out, on another signed-in login, and says so. This does not change where the requests
go. Right after the daemon starts, it may not know yet whether the
login plain `claude` uses is signed in; then `kurmis claude` waits up to 15 seconds for the
daemon's first usage probe before it decides.

When `~/.kurmis/config.json` cannot be read, `--login` is an error. Without `--login`, kurmis
says why and starts claude on the login plain `claude` uses, as `kurmis codex` starts on the
login plain `codex` uses.

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

Shows every login by its alias, with its id (when the alias is not the id), its settings and
its usage, whether the daemon is running, and whether global routing (`kurmis setup`) is on,
paused or off, with the command that changes it. It never starts the daemon, and it exits 0
whether the daemon runs or not. Like every other command, it gives the logins plain `claude` and
plain `codex` use their ids in `~/.kurmis/config.json` when the file has none yet; it changes no
other file.

The login plain `claude` uses and the login plain `codex` uses are marked as such. A warning at the top says when
two Claude logins, or two Codex logins, are the same account, because both then use one
subscription. Another warning says when global routing is on but the daemon is not running,
because a plain `claude` then cannot reach Anthropic.

While the daemon runs, the status comes from it. For each login it shows the account's email,
whether the login is signed in, the five-hour and weekly usage with the time until each resets,
its limits, whether routing may use it and how many sessions it serves. A line starting with
"passed over" says why Auto, or `kurmis codex`, would skip that login now (signed out, at its
limit, cooling down after a usage-limit answer). The last line says which login `kurmis codex`
would start on. When the daemon runs an older kurmis than the one you run, `status` says so: the
next command that starts the daemon replaces it. When the daemon is newer, `status` says that too,
and when this kurmis cannot read its status it says what to do.

While the daemon is not running, the first line says so and names the commands that start it:
`kurmis claude`, `kurmis codex` without `--login`, `kurmis setup` and `kurmis daemon start`. The
logins and their settings come from `~/.kurmis/config.json`. The usage is the last the daemon
read, with how long ago it read it. Kurmis cannot tell then whether a login is signed in, so it
shows whether the login's credentials are on this machine instead. For a Claude login that is
its token: in its `.credentials.json`, or else in the macOS Keychain or Windows Credential
Manager, which kurmis asks whether the item exists without reading it. For a Codex login it is
its `auth.json`, and for one whose `config.toml` keeps the sign-in in the Keychain or Credential
Manager (`cli_auth_credentials_store = "keyring"` or `"auto"`), what `codex login status` says.
The check does not show that the credentials still work. When it cannot run, the login shows
`credentials on this machine: unknown`. Codex logins show no email then, so the warning about
one subscription covers Claude logins only. The same goes when the daemon runs but does not
answer the status request; a note on stderr says so.

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

Removes a login: it signs the login out with `claude auth logout` or `codex logout` (on macOS this
is what removes its Keychain item, on Windows its Windows Credential Manager record; kurmis warns
when it could not), removes it from kurmis' settings and deletes its folder. Links in a Codex
login's folder are removed, never what they point to, and so is kurmis' record of what it merged
into that folder. The logins plain `claude` and plain `codex` use cannot be removed; sign them out
with `claude auth logout` or `codex logout` if you want to.

`kurmis logout <id>` of an id that is not in `~/.kurmis/config.json` but has a folder in the
kurmis data folder, for example after a removal that stopped half-way, signs it out and deletes
that folder.

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
  (a later setup that only updates them keeps that copy), and adds the file to a list in the
  data folder, so `--pause` and `--uninstall-and-logout` find it whatever `CLAUDE_CONFIG_DIR` is
  set to when you run them;
- it makes the daemon start when you log in (a launch agent on macOS, a logon entry on
  Windows). On Linux there is no start at login; the next `kurmis claude` or `kurmis codex`
  starts the daemon.

A plain `claude` then runs on Auto. Restart Claude Code sessions and editors that were already
open. If the file already points `ANTHROPIC_BASE_URL` at another proxy, setup stops and changes
nothing.

The login plain `claude` uses is the login in `~/.claude`. When you run setup with
`CLAUDE_CONFIG_DIR` set, it writes `$CLAUDE_CONFIG_DIR/settings.json`, which only a `claude`
with that variable reads. Such a `claude` signs in with the login in that folder, which kurmis
does not know, so kurmis never signs its requests as the login plain `claude` uses: they go to
your extra logins only. A `claude` with `CLAUDE_CONFIG_DIR` naming `~/.claude` itself, after a
setup run without the variable, reads `~/.claude/settings.json` and counts as a plain `claude`
on the login plain `claude` uses (see "Known limits" in
[docs/architecture.md](docs/architecture.md)); unset the variable for it. `kurmis claude` is
not affected; it always starts claude on the login it names, the one plain `claude` uses
included.

On macOS and Windows, setup stops when `CLAUDE_CONFIG_DIR` names `~/.claude` itself: Claude
Code keeps separate credentials for a `claude` started with the variable set, even to that
folder, and both kinds of `claude` read `~/.claude/settings.json`. On every platform it also
stops when `$CLAUDE_CONFIG_DIR/settings.json` is a link to `~/.claude/settings.json`, for the
same reason. Unset the variable and run setup again.

Setup also warns when the file's `env` sets `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, which make a plain
`claude` sign with that key or token, and leaves them.

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
an update, the first command that starts the daemon (`kurmis claude`, `kurmis codex`,
`kurmis setup` or `kurmis daemon start`) replaces the older daemon with one started from where
that command runs, so run it at the screen too.

On Windows, a daemon started from an ssh session ends when that session ends, and the next
`kurmis claude` or `kurmis codex` starts it again. After `kurmis setup`, the daemon started at
logon keeps running and ssh sessions use it.

On macOS, launchd may not be able to start the login item when Node, kurmis or the kurmis data
folder is on an external volume. Then the daemon does not start at login, and the next
`kurmis claude` or `kurmis codex` starts it.

### `kurmis daemon`

```sh
kurmis daemon start|stop|restart|status|run
```

You seldom need these: `kurmis claude`, `kurmis codex` and `kurmis setup` start the daemon when
they need it, and replace a daemon of an older kurmis. `kurmis daemon status` shows whether it runs, its pid
and port; `stop` stops it after it finishes the requests it has open, waiting at most 30
seconds for them; `stop --now` stops it at once and cuts those requests, and an open Claude
session then sees a dropped connection and retries the request; `restart` stops it and starts a
new one; `run` runs it in the terminal, which helps when looking into a problem.

A daemon is older when its kurmis version is lower, or when the version is the same and its
control API version (the version of the requests the commands send it) is lower. A newer daemon
is never replaced. When its control API version is not the one this kurmis speaks, this kurmis
cannot use it. `kurmis claude`, `kurmis setup` and `kurmis daemon start` then stop, and
`kurmis codex` starts on the login plain `codex` uses; each says that a newer daemon runs. Update
this kurmis, or run `kurmis daemon stop` and then the command again, which starts a daemon of
this kurmis.

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
- the kurmis data folder, `~/.kurmis` (`%USERPROFILE%\.kurmis` on Windows). Links in a Codex
  login's folder are removed, never what they point to, and files in the folder that kurmis did
  not write are left.

The logins plain `claude` and plain `codex` use are not signed out, so a plain `claude` and `codex`
keep working. When a login cannot be signed out, the start at login cannot be removed or the
daemon cannot be stopped, the command says which, keeps the data folder, and exits 1; run it again
once that is fixed. A login that cannot be signed out stays in kurmis with its folder. When its
sign-out can never work (for example, `claude` is no longer installed), `kurmis logout <id>`
removes it without signing it out; on macOS its Keychain item, and on Windows its Credential
Manager record, may then be left, and the message names it. When every step worked, the
command's last line tells you to run `npm uninstall -g kurmis`.

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
  Script Host is missing or turned off, setup writes no entry, warns and still exits 0;
  `kurmis claude` and `kurmis codex` start the daemon anyway.
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
