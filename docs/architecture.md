# Architecture

Kurmis is TypeScript on Node. It is installed with `npm i -g` from git, and the built bundle is
committed so the install runs no build step. [scope.md](scope.md) says what it does. This file
says how the parts fit together.

Much of the routing logic is copied from the original router together with its tests. A copied module
keeps the original router's behaviour unless this file or `scope.md` says otherwise. Code that exists only
for the original router features kurmis leaves out (lending logins between machines, script runs, sessions
that run as another user, the UI) is deleted, not stubbed.

## The data folder

Everything kurmis keeps is in one folder: `~/.kurmis`, or `%USERPROFILE%\.kurmis` on Windows.
`KURMIS_HOME` moves it, and every test runs with it set to a temporary folder.

- `config.json` holds the logins and their settings: id, provider, label, opt-in, the two limits
  and use-first. The CLI writes it, and the daemon reloads it when it changes.
- `claude/<id>/` is the config folder of an extra Claude login. On Windows it holds the
  login's `.credentials.json`. On macOS the CLI keeps the secret in the Keychain, under a name
  derived from this folder's path.
- `codex/<id>/` is the `CODEX_HOME` of an extra Codex login.
- `daemon.json` holds the running daemon's pid, port, version and the secret clients send.
  Only the user can read it.
- `state.json` holds the daemon's usage snapshots, cooldowns and which login each session is on,
  so a daemon restart keeps them.
- `daemon.log` is the daemon's log. It never holds a token, a request body or an email.

The machine's own logins are `claude:default` and `codex:default`. They are always listed and
cannot be removed. A CLI on them runs with the environment left as it was inherited, apart from
the routing variables.

## The daemon

One daemon per user. It serves the proxy and the control API on one `127.0.0.1` port. The port
is fixed so that `settings.json` can name it. It defaults to a value set in `config.json`, and
a busy port is an error that says how to change it. Starting it again replaces a daemon of an
older version, after that daemon finishes the requests it has open.

- **The control API** is on paths under `/_kurmis/`. It lets the CLI read status, ask for a
  usage probe, reload config and stop the daemon. Every request needs the secret from
  `daemon.json`.
- **The proxy** is every other path. A request needs the header `x-kurmis-key: <secret>`, which
  reaches the CLI through `ANTHROPIC_CUSTOM_HEADERS`. A request may also carry
  `x-kurmis-login: <id>`, which pins it to that login. Neither header is forwarded upstream.
- **Sessions** are told apart by the `X-Claude-Code-Session-Id` header the CLI sends. That is
  what a session stays on its login by. The CLI's subagents and small-model requests share it.
- **Usage** is probed every 15 minutes for each signed-in login, and on demand. The daemon also
  updates it from the rate-limit headers of every answer it forwards.
- **Tokens** come from the Keychain (`/usr/bin/security`, with stdin closed and a deadline) or
  from `.credentials.json`. They are cached for a minute and never written anywhere. A token
  that is about to expire is renewed by running a usage probe on that login, because the probe's
  CLI renews it.
- **Starting.** The CLI starts the daemon when it is not running, detached from the terminal. On
  macOS a daemon started from an ssh login cannot read the login Keychain, so where that matters
  it is started through launchd. On Windows the daemon must survive the terminal closing even
  when the terminal runs its children in a job that is killed on close.

## How a Claude CLI reaches the daemon

`kurmis claude …` starts `claude` with:

- `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`;
- `ANTHROPIC_CUSTOM_HEADERS` carrying the key, and the login when one was named;
- `ENABLE_TOOL_SEARCH=true`, because the CLI turns tool search off for any base URL that is not
  Anthropic's, and the proxy passes it through;
- `CLAUDE_CODE_MAX_RETRIES=15`, so a request outlasts a daemon restart;
- `CLAUDE_SECURESTORAGE_CONFIG_DIR` naming the login's folder when a login other than the
  default was named;
- `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` removed, because a key would sign the requests
  itself and no subscription would be billed.

On Auto, the CLI is started on a login that has credentials here, normally `claude:default`.
The proxy signs each request with the login it picks. When that is the login the CLI was
started on, the proxy forwards the CLI's own `Authorization` header.

**Global mode** is `kurmis setup`. It puts the same variables in the `env` block of
`~/.claude/settings.json`, so a plain `claude` and the IDE extensions are routed too. It also
registers the daemon to start at login: a launchd agent on macOS, and a logon entry on Windows.
`kurmis setup --undo` removes both. Whether a process variable overrides the `env` of
`settings.json` decides how `kurmis claude --login <id>` pins a session in global mode. That has
to be measured before it is built.

## Codex

There is no proxy for Codex. `kurmis codex …` picks a login when it starts, or uses the one named
with `--login`, prepares that login's `CODEX_HOME` and starts `codex` with it. The choice uses
the same ranking as Claude's Auto. `codex:default` runs with `CODEX_HOME` as it was inherited.

## Windows

- **Never start a `.cmd` or `.bat` shim.** Node will not start one without a shell, and
  through `cmd.exe` the user's arguments can be changed or run. Kurmis finds the real program
  behind the npm shim instead: `claude.exe` for Claude, and `node <entry>.js` for Codex.
- **Directory junctions** link the Codex folders. They need no admin rights.
- **Ctrl-C** goes to every process on the console. The wrapper ignores it and waits for the
  child to exit.

## Code layout

- `src/core/` holds pure logic with no I/O: routing, usage parsing, limits, the TOML merge. It
  holds most of the code copied from the original router.
- `src/daemon/` holds the proxy, the control API, the token readers, the usage probes and the
  daemon's lifecycle.
- `src/cli/` holds the commands and the wrapper.
- `src/platform/` holds what differs per OS: finding programs, junctions, detaching, autostart.
- `test/` mirrors `src/`. `test/fakes/` holds stand-ins for `claude`, `codex app-server` and
  Anthropic's API. No test reaches the network or the user's real `~/.claude`, `~/.codex` or
  Keychain.
