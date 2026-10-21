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
lists is the name unless you give `--label`. If the sign-in fails, nothing is added.

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

### `kurmis codex`

```sh
kurmis codex [--login <id>] [--] [codex arguments...]
```

Starts Codex on the login that ranks first by the same rules as Claude's Auto, or on the one
named with `--login`. Codex has no per-request routing, so the choice is made when it starts.
When every login is at its limit, kurmis starts on the one that gets its usage back first and
says when. Each extra Codex login has its own Codex home folder, which kurmis fills from
`~/.codex` before every start: your `config.toml` (without secrets), `AGENTS.md`, and links to
your other folders. Your sign-in (`auth.json`) is never copied.

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
need the daemon and does not check that the credentials still work; `kurmis status` does.

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

Removes a login: it signs the login out with `claude auth logout` or `codex logout` (on macOS
this is what removes its Keychain item; kurmis warns when it could not), removes it from
kurmis' settings and deletes its folder. Links
in a Codex login's folder are removed, never what they point to. The machine's own
`claude:default` and `codex:default` cannot be removed; sign them out with `claude auth logout`
or `codex logout` if you want to.

### `kurmis setup` (route every Claude Code)

```sh
kurmis setup
kurmis setup --undo
```

Without setup, only Claude Code started through `kurmis claude` is routed. `kurmis setup` makes
a plain `claude`, and the Claude Code extensions in your editor, use kurmis too:

- it adds kurmis' four settings (`ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`,
  `ENABLE_TOOL_SEARCH`, `CLAUDE_CODE_MAX_RETRIES`) to the `env` block of
  `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json` when you set that variable),
  leaving everything else in the file as it was. Because the file then holds kurmis' key, setup
  makes it readable only by you (on macOS and Linux);
- it saves a copy of the file as `settings.json.kurmis-backup` before its first change;
- it makes the daemon start when you log in (a launch agent on macOS, a logon entry on Windows)
  and starts it now.

A plain `claude` then runs on Auto. Restart Claude Code sessions and editors that were already
open. If the file already points `ANTHROPIC_BASE_URL` at another proxy, setup stops and changes
nothing.

`claude:default` is the login in `~/.claude`. When `CLAUDE_CONFIG_DIR` is set, a plain `claude`
signs in with the login in that folder instead, which kurmis does not know, so kurmis never
signs its requests as `claude:default`: they go to your extra logins only. `kurmis claude` is
not affected; it always starts claude on the login it names, `claude:default` included.

`kurmis setup --undo` removes kurmis' settings again (a value you changed yourself is left and
reported) and the start at login. The daemon keeps running until you stop it, because
`kurmis claude` still uses it.

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
kurmis logout <id>       # for each extra login, to remove its credentials
kurmis daemon stop
npm uninstall -g kurmis
```

Kurmis keeps its data in `~/.kurmis` (`%USERPROFILE%\.kurmis` on Windows). Uninstalling leaves
that folder; delete it to remove the extra logins' settings too. On macOS an extra Claude login's
credentials are in the Keychain; `kurmis logout <id>` removes them, deleting the folder does not.

## Troubleshooting

- **What is the daemon doing?** Its log is `~/.kurmis/daemon.log` (the previous one is
  `daemon.log.1`). It names logins, status codes and timings, never tokens, request contents or
  emails. `kurmis status` shows what it knows about each login.
- **Restarting the daemon.** `kurmis daemon restart`. Claude Code
  sessions that are open retry their requests for a few minutes and carry on once it is back.
- **The daemon cannot start because its port is in use.** Another program has kurmis' port
  (28411 unless you changed it). Pick a free one by adding
  `"port": 28412` (any number from 1024 to 65535) to `~/.kurmis/config.json`, then run
  `kurmis daemon restart`. If you ran `kurmis setup`, run it again so
  `settings.json` names the new port.
- **"Not logged in" in Claude Code, or a login shown as signed out.** Sign it in again with
  `kurmis login <id>`, for example `kurmis login claude:work`.
- **macOS asks whether `security` may use a Keychain item.** That is the daemon reading a
  login's token, which the macOS `security` program fetches. Choose "Always Allow" so it does
  not ask again for that login.
- **Working over ssh on a Mac.** A program started from an ssh session cannot read the login
  Keychain, which is where Claude Code keeps its tokens on macOS. So when kurmis has to start the
  daemon from an ssh session, it starts it through launchd in your desktop session instead,
  which works while you are logged in at the Mac. If nobody is logged
  in at the Mac, start the daemon there once, or run `kurmis setup` there so it starts at login;
  `kurmis claude` over ssh then uses that daemon.
- **"Could not lock …config.json.lock".** Another kurmis command is changing the settings right
  now; try again. If no kurmis command is running, delete `~/.kurmis/config.json.lock`.
- **A command says the daemon could not be reached.** Look at the end of `daemon.log`, or run
  `kurmis daemon run` to see it start in the terminal.

## More

[docs/scope.md](docs/scope.md) says what kurmis does and leaves out, and
[docs/architecture.md](docs/architecture.md) how it works.

## Development

`pnpm install`, then `pnpm test`, `pnpm check` (type check and lint) and `pnpm bundle` (writes
`dist/kurmis.cjs`, which is committed together with the change that produced it).
