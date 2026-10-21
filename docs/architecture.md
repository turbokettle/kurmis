# Architecture

Kurmis is TypeScript on Node. It is installed with `npm i -g` from git, and the built bundle is
committed so the install runs no build step. [scope.md](scope.md) says what it does. This file
says how the parts fit together.

`package.json` must have no `build`, `prepare`, `prepack`, `preinstall`, `install` or
`postinstall` script. When a git dependency has one of those, npm first runs `npm install` with
the dev dependencies in a temporary clone. In a global install that nested run inherits the
global flag and links the package to the temporary clone, which npm then deletes, so `kurmis`
ends up a broken link (seen with npm 11.9). This is why the script that writes the bundle is
called `bundle`.

Much of the routing logic is copied from the original router together with its tests. A copied module
keeps the original router's behaviour unless this file or `scope.md` says otherwise. Code that exists only
for the original router features kurmis leaves out (lending logins between machines, script runs, sessions
that run as another user, the UI) is deleted, not stubbed.

## The data folder

Everything kurmis keeps is in one folder: `~/.kurmis`, or `%USERPROFILE%\.kurmis` on Windows.
`KURMIS_HOME` moves it, and every test runs with it set to a temporary folder. The code is in
`src/data/`.

- `config.json` holds the daemon's port and the logins with their settings: id, provider, label,
  opt-in, the two limits and use-first. The CLI writes it, and the daemon reloads it when its
  contents change (`configStamp`, a hash of the file).
- `claude/<name>/` is the config folder of the extra Claude login `claude:<name>`. On Windows
  it holds the login's `.credentials.json`. On macOS the CLI keeps the secret in the Keychain,
  under a name derived from this folder's path (`keychainService` in
  `src/core/keychain-service.ts`).
- `codex/<name>/` is the `CODEX_HOME` of the extra Codex login `codex:<name>`.
- `daemon.json` holds the running daemon's pid, port, version and start time. The daemon writes
  it once it has its port and removes it as the last step of stopping, only while the file still
  names its own pid, so a replaced daemon never removes its successor's file. The CLI removes a
  `daemon.json` whose pid no longer exists, and one that is damaged.
- `launchd/` holds the plists of the short-lived launchd jobs that start the daemon from an ssh
  login on macOS. Each is removed once its job has run.
- `autostart.vbs` is the script the Windows logon entry runs (see "Starting at login").
- `key` holds the secret every proxied and control request carries. It is created once and
  kept, because a running Claude CLI and, in global mode, `~/.claude/settings.json` hold a copy
  of it and must keep working after the daemon restarts. Only the user can read it.
- `state.json` holds the daemon's usage snapshots, cooldowns and which login each session is on,
  so a daemon restart keeps them.
- `daemon.log` is the daemon's log. It never holds a token, a request body or an email. At 5 MB
  it is renamed to `daemon.log.1`, replacing the previous one.

The machine's own logins are `claude:default` and `codex:default`. They are always listed and
cannot be removed, and they have no folder here. A CLI on them runs with the environment left as
it was inherited, apart from the routing variables.

**Login ids** are `claude:<name>` and `codex:<name>`. A name is 1 to 32 lowercase letters,
digits, `-` and `_`, starting with a letter or digit, and not a Windows device name such as
`con` or `nul`. So a name is always a safe folder name, and the path functions check it again.

**Writing files.** Every JSON file is written to a temp file in the same folder, flushed to the
disk and renamed over the old one, so a reader sees the old file or the new one, never half of
each. On Windows a rename fails while another program has the file open, so it is retried for
about a second. On macOS and Linux the data folder is created with mode 0700, and `key`,
`daemon.json` and `daemon.log` with 0600. Windows ignores those modes; there the files are
protected by the access list they inherit from `%USERPROFILE%`, which only lets in the user,
SYSTEM and Administrators.

**Reading files.** A missing `config.json` means the defaults. A `config.json` that is not JSON,
has a wrong field or has a `version` newer than this kurmis is an error that names the file and
the field. A damaged `state.json` never stops the daemon: an entry that does not check out is
dropped and the rest is kept, and a file that is not JSON reads as empty.

```json
// config.json
{
  "version": 1,
  "port": 28411,
  "logins": [
    { "id": "claude:default", "provider": "claude", "label": "default", "routing": true,
      "fiveHourLimit": 100, "weeklyLimit": 100, "useFirst": false },
    { "id": "claude:work", "provider": "claude", "label": "Work", "routing": true,
      "fiveHourLimit": 90, "weeklyLimit": 100, "useFirst": true }
  ]
}

// state.json; a cooldown of null means "until further notice" (Infinity in memory)
{
  "version": 1,
  "usage": { "claude:work": { "accountId": "claude:work", "provider": "claude", "...": "AccountUsage" } },
  "cooldowns": { "claude:work": 1768489200000, "claude:default": null },
  "sessions": { "0b7c0a52-1111-4222-8333-944445555666": { "login": "claude:work", "lastUsed": 1768478400000 } }
}

// daemon.json
{ "pid": 4242, "port": 28411, "version": "0.1.0", "startedAt": 1768478400000 }

// key: 64 hex characters on one line
```

Session placements are dropped after 7 days without a request, and beyond the newest 2000. The
daemon saves `state.json` through `createCoalescedWriter`, which writes at most once per
interval however often the state changes.

## The daemon

One daemon per user. It serves the proxy and the control API on one `127.0.0.1` port. The port
is fixed so that `settings.json` can name it. It is `port` in `config.json`, 28411 when that is
not set, and a busy port is an error that says how to change it. 28411 is below the range every
OS hands out for outgoing connections (32768 and up on Linux, 49152 and up on macOS and Windows),
and no common tool uses it. Starting it again replaces a daemon of an
older version, after that daemon finishes the requests it has open.

- **What the daemon answers itself.** `HEAD` and `GET /api/hello` get a 200 without the key,
  because the CLI checks the base URL with it before its first request and without its custom
  headers. A path that is neither the control API nor one of the routed Anthropic paths
  (`ROUTE_PATHS` in `src/core/proxy-rules.ts`) is a 404. The code is `src/daemon/app.ts`.
- **The control API** is on paths under `/_kurmis/` (`src/daemon/control.ts`). It lets the CLI
  read status, ask for a usage probe, reload config and stop the daemon. The paths and their
  answers are in `src/core/control-api.ts`. Every request needs the secret from `key`, in the
  header `x-kurmis-key`; without it the answer is 403 with no body. `status` also gives each
  Claude login's email from its profile file (`src/data/identity.ts`), for `kurmis status` and
  `list` on the person's own terminal; the email is never logged.
- **The proxy** is every other routed path (`src/daemon/proxy.ts`). A request needs the header
  `x-kurmis-key: <secret>`, which reaches the CLI through `ANTHROPIC_CUSTOM_HEADERS`, else it gets
  403 with no body. It may also carry `x-kurmis-login: claude:<name>`, which pins it to that
  login, and `x-kurmis-started-on: claude:<name>`, the login the CLI was started on. Either one
  naming no Claude login is a 400. None of them is forwarded upstream. The body is read whole
  (at most 64 MB), because a request may have to be sent more than once.
- **Choosing a login** follows the order in the header of `src/core/proxy-rules.ts`. Logins
  whose usage reading belongs to a window that has ended are probed first. A login whose token
  is about to expire is chosen as if it were fresh and then renewed by a usage probe; on Auto,
  when another login could take the request, the request waits at most 5 s
  (`RENEWAL_WAIT_MS`) for that and then goes to the other login. A login whose record has no
  refresh token is never renewed: it just becomes unusable when its token is about to expire.
- **Signing.** The proxy signs with `Bearer <token>` for the token it read for the chosen login.
  When the chosen login is the one the CLI was started on and no token was read for it, the
  CLI's own `authorization` header is forwarded instead. No other login is ever signed with the
  CLI's header. A 401 on a token the proxy read makes it read the token again, renew it once
  through a probe when the record has a refresh token, and send the request again.
- **Sessions** are told apart by the `X-Claude-Code-Session-Id` header the CLI sends. That is
  what a session stays on its login by. The CLI's subagents and small-model requests share it.
  Requests without one share a single placement, stored under the key `:no-session`. A session
  is placed on a login only once an answer under 400 from it is passed on.
- **Usage limits.** A usage-limit 429 starts the login's cooldown until the reset it names. On
  Auto the request is then sent on the next login before the CLI sees anything. When no login is
  left, the CLI gets the real 429 of the login that is back first, so it behaves exactly as with
  one exhausted account. The proxy answers its own 429 (`poolLimitAnswer`) instead when it holds
  no real one (logins skipped for limits it already knew about), or when a login it did not try
  is back earlier than every one that refused. A pinned session gets its login's 429 as it is.
- **No capacity.** A 529, or a 429 without usage-limit headers, puts that login into the
  session's backoff (`CapacityCooling` in `src/core/capacity-hold.ts`) and the request goes to
  another login at once when the session may use one that is not cooling. Otherwise it waits for
  the first login to come out of its backoff, for any change in the logins (usage, cooldown,
  config), or for the client to close the request. After `CAPACITY_HOLD_MS` (two minutes) the
  proxy answers 529 itself, and the CLI sends the request again.
- **Moving a session back.** When an Auto session has just moved to another login and that login
  answers 400, the request is sent again on the login that served the session before, and the
  session stays on that login from then on. Some conversations cannot be continued on another
  login. "From then on" lasts until the daemon restarts: `state.json` keeps only the login each
  session was last on.
- **No login can sign** (none signed in, no token readable and no header of the CLI's own for
  the login it was started on): the proxy's own 599 (`noSignerAnswer`), which the CLI retries.
- **The upstream connection** (`src/daemon/upstream.ts`) uses `node:https`, not `fetch`, because
  `fetch` gives up after 300 s waiting for headers or between two chunks, which a long thinking
  turn can exceed. There is no limit on the whole request: the CLI aborts its request when it
  gives up, and that aborts the upstream request at once. A connection that carries no data in
  either direction for 20 minutes fails; a new connection must be ready within 30 s; TCP
  keep-alive probes start after 30 s of silence; idle connections are kept for reuse for 30 s,
  and a request that meets a reset on a reused connection before any answer is sent once more.
  Answers are passed on byte for byte as they arrive, with backpressure: a CLI that reads slowly
  pauses the upstream connection. The daemon's HTTP client decodes nothing, so
  `content-encoding` is passed on with the body.
- **Usage** is probed every 15 minutes for each signed-in login (and each login not probed
  yet), and on demand: the control API's `probe`, a stale reading, a token renewal, and a login
  added to `config.json`. One probe per login runs at a time; a second request waits for it. A
  failed probe keeps the previous windows and records the error on the snapshot. The daemon also
  updates usage from the rate-limit headers of every answer it forwards. The code is
  `src/daemon/usage-poller.ts`, with the probes in `claude-probe.ts` and `codex-probe.ts`.
  A Claude probe is `claude -p` in stream-json mode, sending `initialize` and `get_usage`, with
  `claudeProbeEnv`, `--setting-sources=` (no settings file, so no `env` block or hook of the
  person's reaches it), no MCP servers, no saved session, `DISABLE_AUTOUPDATER=1`, and the empty
  folder `probe/cwd` as its working folder. A Codex probe is `codex app-server` with
  `codexLoginEnv`, sending `initialize`, `account/read` and `account/rateLimits/read`. Each probe
  has 30 s from start to exit and is killed with its child processes after that, or when the
  daemon closes (`src/platform/frame-process.ts`). After its answer the probe closes the CLI's
  input and waits for it to exit, so a token the CLI renewed is on disk when the probe ends.
- **Tokens** (`src/daemon/tokens.ts`). On macOS the login's Keychain item comes first
  (`/usr/bin/security`, with stdin closed and a deadline), and its `.credentials.json` is read
  when the Keychain gives no token: the CLI falls back to the file when it cannot use the
  Keychain, for example in an ssh session. On Windows and Linux only the file is read. An extra
  login's file is in its folder, the default login's is `~/.claude/.credentials.json`. A
  Keychain answer is kept for a minute; the file is read again when its size or modification
  time changes. Tokens are never written anywhere. Only whether a record has a refresh token is
  kept, never the refresh token itself.
- **Config reload.** The daemon reads `config.json` again on the control API's `reload`, and when
  a request finds its contents changed (`configStamp`, checked at most every 2 s). A file that
  does not read leaves the config the daemon has.
- **Test hooks.** `KURMIS_UPSTREAM_URL` replaces the Anthropic API origin
  (`https://api.anthropic.com`) and `KURMIS_SECURITY_PROGRAM` the `security` program
  (`/usr/bin/security`). They exist so the tests can use the fakes in `test/fakes/` and
  `test/daemon/fake-security/`. `createDaemonApp`'s `tuning` option shortens the daemon's
  timings for tests in the same way.

### Starting and stopping

The code is `src/daemon/main.ts` (the process), `src/daemon/lifecycle.ts` (what the CLI and the
daemon both need: a keyed control request, who holds a port, version comparison),
`src/cli/daemon-client.ts` (finding, starting and stopping it from the CLI) and
`src/platform/detach.ts`, `launchd.ts`, `autostart.ts`, `windows-autostart.ts`.

**`kurmis daemon run`** reads or creates `key`, reads `port` from `config.json` and opens
`daemon.log`. Then it listens on `127.0.0.1:<port>`. The port is the lock that keeps one daemon
per user. When the port is busy, the daemon asks the holder for its status with the key:

- a kurmis daemon of an older version is replaced (below);
- a kurmis daemon of the same or a newer version, or of a version that cannot be compared
  (`dev`, which code run from the source tree reports), keeps the port, and the new process
  prints that it already runs and exits 0. Two CLIs that start a daemon at the same moment rely
  on this: the bind decides, and both CLIs connect to the one that won;
- any other program is an error, exit 1, that says to set `"port"` in `config.json` (1024 to
  65535).

Only after the bind does the daemon write `daemon.json` and start the request handling, which
reads `state.json`, so a daemon that loses the bind never touches the state. Requests that
arrive while the request handling starts wait for it.

**Stopping.** On SIGTERM, SIGINT, SIGHUP or a control `stop`, the daemon:

1. stops accepting at once, which frees the port;
2. closes idle keep-alive connections, again every second, and marks its answers
   `connection: close`, so a CLI's next request opens a connection to whatever holds the port
   next;
3. waits for its open proxied requests, for at most 15 minutes. A Claude CLI waits at most
   `API_TIMEOUT_MS` (600 s by default) for the headers of an answer; that a streamed answer
   that has started ends within the rest of the 15 minutes is an assumption. A second stop
   signal ends the wait;
4. writes `state.json`, closes the remaining connections, removes `daemon.json` and exits 0.

An uncaught error is logged by its error code only, and the daemon stops without waiting for its
requests and exits 1. The next kurmis command starts a new one.

**Version handover.** A CLI that finds a daemon of an older version starts a new daemon, and the
new daemon does the handover: it sends the old one a control `stop` and tries the bind every
100 ms for up to 10 seconds. The old daemon frees the port as soon as it has answered, and
finishes its open requests in the background while the new one serves. A routed Claude CLI
retries a request that finds no daemon (`CLAUDE_CODE_MAX_RETRIES=15`), which covers the moment
in between. Versions are compared numerically (`0.10.0` is newer than `0.9.1`), and an older
kurmis never replaces a newer daemon. A daemon on another port than `config.json` names is asked
to stop by the CLI before the new one starts.

**Finding it.** The CLI reads `daemon.json` and counts the daemon as running only when it
answers a status request with the key. A `daemon.json` whose pid exists but that does not answer
is left alone, since that daemon may be finishing its requests before it stops. When
`daemon.json` finds nothing, the CLI also asks the configured port, since a daemon that has just
bound may not have written `daemon.json` yet.

**Starting it from the CLI** (`ensureDaemon`, `kurmis daemon start`): when none answers, the CLI
starts `<node> <bundle> daemon run` and waits up to 15 seconds for a daemon of its version or a
newer one to answer (30 seconds through launchd or WMI). The bundle is the one running now, with
symlinks resolved. The daemon does not inherit `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS` or `CLAUDE_SECURESTORAGE_CONFIG_DIR`, which a
CLI started inside a routed session has. It runs in the home folder, so it holds no project
folder open. How it is started:

- **Directly, detached**, everywhere except the two cases below. On macOS and Linux
  `detached: true` puts it in a new session, so the terminal's hangup does not reach it, and its
  standard streams go to `/dev/null`; the daemon writes its own log. On Windows
  `detached: true` gives it no console and a process group of its own, and `windowsHide` keeps
  any window hidden.
- **Through launchd, on macOS from an ssh login** (`SSH_CONNECTION`, `SSH_CLIENT` or `SSH_TTY`
  set) or wherever `security show-keychain-info login.keychain` fails. A process started from
  an ssh login is in the ssh session's audit session and cannot read the login Keychain, and
  neither can its children, so such a daemon would sign nothing. The design follows TK
  the original router's one-shot job. The CLI writes `launchd/kurmis.start.<random>.plist` (mode 0600)
  whose program is `<node> <bundle> daemon start --no-launchd`, with `RunAtLoad` and
  `AbandonProcessGroup`, no `KeepAlive`, and output to `/dev/null`, and loads it with
  `launchctl bootstrap gui/<uid> <plist>`. That `daemon start` runs in the user's GUI session,
  starts the daemon detached in its own session and process group, and exits. Once the daemon
  answers, the CLI runs `launchctl bootout gui/<uid>/<label>` and deletes the plist; unloading
  the job does not end the daemon. The job's environment is only `HOME`, the caller's `PATH` (so
  the daemon finds `claude` and `codex`), `KURMIS_HOME` as an absolute path, and the program
  variables and test hooks when they are set; never an `ANTHROPIC_*`, `SSH_*` or `CLAUDE_*`
  variable. The GUI domain exists only while the user is logged in at the screen (or through
  Screen Sharing). Without it `bootstrap` fails, and the CLI starts the daemon directly with a
  warning that Keychain logins will not be routed. Plists older than 10 minutes that a killed
  CLI left behind are removed at the next start. `--no-launchd` starts the daemon directly.
- **Through WMI, on Windows from an ssh login.** Windows' OpenSSH server puts each session in a
  job object and ends every process in it when the session closes, detached ones included, and
  Node cannot ask for `CREATE_BREAKAWAY_FROM_JOB`. So the CLI runs PowerShell with
  `Invoke-CimMethod Win32_Process Create`, every value in a single-quoted PowerShell string. WMI's
  own host process becomes the daemon's parent, outside the session's job. Measured with TK
  the original router on Windows 10: such a process outlives the ssh session. The process gets the user's
  own environment from Windows, not the CLI's, so a `KURMIS_HOME` set only in the ssh session
  does not reach it. When WMI refuses, the daemon is started directly with a warning that it
  ends with the session.

Terminals that put their children in a kill-on-close job (some IDE terminals) are not detected;
a daemon started from one ends with it, and the next kurmis command starts it again.

**Stopping it from the CLI** (`kurmis daemon stop`) sends the control `stop` and waits up to 30
seconds for the pid to exit. Then it sends SIGTERM, which, as the second stop signal, ends the
daemon's wait for its open requests. Only a pid that answered the keyed status request as the
daemon's own is ever signalled. `kurmis daemon restart` sends `stop`, waits until the port is
free, and starts a new daemon at once, so the old one finishes its requests in the background.
It refuses to replace a daemon of a newer version.

### Starting at login

`kurmis setup` registers `<node> <bundle> daemon start --no-launchd` to run when the user logs
in, and `setup --undo` removes it. That command starts the daemon detached and exits, so
removing the entry never ends a running daemon. Both are idempotent: what is already there is
compared first. The Node is the first `node` on PATH when it is the same file as the running one,
since `process.execPath` names a versioned folder that a Homebrew upgrade removes.

- **macOS:** `~/Library/LaunchAgents/kurmis.daemon.plist`, the same shape as the one-shot job
  (mode 0644; it holds no secret). It is written only when its content differs, then loaded
  with `launchctl bootstrap`, which also runs it once; one loaded with old content is unloaded
  first, since launchd keeps what it read at load time. When loading fails (nobody at the
  screen), the plist stays and a warning says it starts at the next login. `setup --undo` runs
  `bootout`, ignoring "not loaded", and deletes the plist.
- **Windows:** the `REG_SZ` value `kurmis` under
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, set, read and removed with `reg.exe`
  through `runProgram` (no shell). It needs no admin rights and shows in Task Manager's Startup
  tab. Its data is `<SystemRoot>\System32\wscript.exe //B //Nologo "<data folder>\autostart.vbs"`
  with full paths. node.exe is a console program and would flash a console window at logon, so
  the script, UTF-16 with a byte order mark, sets the kurmis variables and the start folder and
  starts node hidden without waiting (`WScript.Shell.Run "<command line>", 0, False`). `//B`
  stops error dialogs at logon.
- **Other platforms:** a warning; the next kurmis command starts the daemon.

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

**Kurmis' own options come first.** `kurmis claude` and `kurmis codex` read their options
(`--login <id>`, `--help`) from the front of the argument list and stop at the first argument
they do not know. That argument and everything after it go to the CLI unchanged. `--` also ends
kurmis' options and is dropped, so `kurmis claude -- --help` shows claude's own help, while
`kurmis claude --help` shows kurmis'. `--login` takes a full id or just the name, so
`--login work` means `claude:work` under `kurmis claude`. The code is `src/cli/wrapper-args.ts`.

On Auto, the CLI is started on a login that has credentials here, normally `claude:default`.
The proxy signs each request with the login it picks. When that is the login the CLI was
started on, the proxy forwards the CLI's own `Authorization` header.

**Global mode** is `kurmis setup`. It puts the same variables in the `env` block of
`~/.claude/settings.json`, so a plain `claude` and the IDE extensions are routed too. It also
registers the daemon to start at login: a launchd agent on macOS, and a logon entry on Windows.
`kurmis setup --undo` removes both.

**The `env` of `settings.json` beats the process environment, and the `--settings` flag beats
`settings.json`.** Measured with Claude Code 2.1.301 against two local servers. In global mode
a variable the wrapper puts in the process environment is therefore ignored, so the wrapper
passes its routing variables in a `--settings` argument instead. When the user's own arguments
already carry `--settings`, the wrapper merges its `env` into that one.

Before its first request the CLI sends `HEAD /api/hello` to the base URL, without the custom
headers. The proxy answers that path itself.

## Codex

There is no proxy for Codex. `kurmis codex …` picks a login when it starts, or uses the one named
with `--login`, prepares that login's `CODEX_HOME` and starts `codex` with it. The choice uses
the same ranking as Claude's Auto. `codex:default` runs with `CODEX_HOME` as it was inherited.

**Preparing a login's home.** Before every start on an extra login, `prepareCodexHome`
(`src/cli/codex-home-files.ts`) prepares `codex/<name>/` from the default Codex home: `CODEX_HOME`
of the starting environment, or `~/.codex`. A `CODEX_HOME` inside kurmis' own `codex/` folder is
a login's home, inherited by a `kurmis codex` run from inside a session on that login; it is
ignored and `~/.codex` is used. The decisions are the pure functions of `src/core/codex-home.ts`:

- Each real folder of the default home is linked into the login's home, except scratch folders
  (`tmp`, `.tmp`), links, and names that say they hold a credential or a database.
- `AGENTS.md` is copied, and `config.toml` is merged without its secrets
  (`src/core/codex-account-config.ts`). Both are read through a link, so a file that is a
  symlink into a dotfiles folder still counts.
- `auth.json` and every other file stay out, so each login keeps its own sign-in.

A real folder, or a link to somewhere else, where a link should go is left as it is, with a
warning. Every step that fails adds a warning to stderr and the start goes on. Only a home that
cannot be created stops it. A login's `config.toml` that is not valid TOML is left as it is,
because it may hold the login's own secrets.

The login's `config.toml` is written to a temporary file beside it, and the file is read again
just before the rename. When a Codex process changed it in the meantime, the merge is made
again from the new contents, up to three times in all (`CODEX_CONFIG_MERGE_ATTEMPTS`); after
that the file is left alone until the next start. The home is created with mode 0700 and
`config.toml` written with 0600, because it may hold the login's own secrets.

**Hook and folder trust.** Codex keeps trust in the `config.toml` of the home it runs with:
`hooks.state."<hook key>"` (`trusted_hash`, `enabled`) for a hook and `projects."<folder>"`
(`trust_level`) for a folder. A session on a login asks for trust and Codex writes it into
that login's file. The merge keeps those values across refreshes; the default home's values
fill in the fields the login has not set. Where both have a value for the same hook or folder,
`enabled = false` beats `true` and `"untrusted"` beats any other `trust_level`. For
`trusted_hash` the login's own hash stays: a hash trusts exactly the version of the hook that
hashes to it, so neither hash trusts more than the other. Taking the default home's would undo
the login's own approval on every refresh, and dropping both would last only until the next
refresh filled the default home's hash in.

This differs from the original router, which drops trust the login's file widened, because a model in a
session could have written it. Kurmis has no window in which a person gives trust, and a model
that can write a login's `config.toml` could as well write `~/.codex/config.toml`, whose trust
reaches every login. One consequence: a folder marked untrusted or a hook switched off in a
login's file stays so after the default home trusts it again. It has to be trusted again in a
session on that login.

Removing a login's home must unlink its links first. A recursive delete that followed one
would delete the folder of `~/.codex` it points to.

## Windows

- **Never start a `.cmd` or `.bat` shim.** Node will not start one without a shell, and
  through `cmd.exe` the user's arguments can be changed or run. Kurmis finds the real program
  behind the shim instead (below).
- **Directory junctions** link the Codex folders (`src/platform/links.ts`). They need no admin
  rights or Developer Mode, but they need an absolute target on a local NTFS volume. Where a
  junction cannot be made (a FAT or exFAT drive, a target on a network share), kurmis tries a
  directory symlink instead, which works with Developer Mode on or as an administrator; when
  that fails too, that folder is not shared and a warning says so. A junction's target is read
  back without the `\\?\` prefix some Node versions add, and paths are compared ignoring case.
  On macOS and Linux links are directory symlinks and paths are compared exactly.
- **Ctrl-C** goes to every process on the console. The wrapper ignores it and waits for the
  child to exit.
- **The daemon** is started detached with no console, through WMI from an ssh login, and at
  logon through a hidden `wscript` script ("Starting and stopping", "Starting at login").

**Finding `claude` and `codex`** (`src/platform/programs.ts`). `KURMIS_CLAUDE_BIN` /
`KURMIS_CODEX_BIN` name the program explicitly (a `.js` path runs through Node). Otherwise
kurmis searches PATH. On Windows it tries each PATH folder with each extension in PATHEXT, in
order, as `cmd.exe` does, and reads `Path` and `PATHEXT` whatever the case of their names. The
current folder and relative PATH entries are skipped on every OS. An `.exe` or `.com` is started
directly. A `.cmd` or `.bat` is read as a package manager's shim and its target is started.
`.ps1` and extensionless shims are never used. When nothing is found, Claude Code is looked for
where its native installer puts it: `%USERPROFILE%\.local\bin\claude.exe`
(`~/.local/bin/claude` on macOS and Linux). On macOS and Linux a PATH hit that is a symlink to a
`.js` file (Homebrew's `codex`) runs that file through Node, so a PATH without `node` on it
still works.

**Reading npm, pnpm and yarn shims** (`src/platform/npm-shim.ts`). Each generator writes a line
that ends in the quoted target path, relative to `%~dp0` or `%dp0%` (the shim's own folder),
followed by `%*`. Kurmis finds that line, resolves the folder variables against the shim's
folder, and refuses anything else (other variables, relative paths, pipes, redirections). It
reads npm's cmd-shim 2 to 8 and pnpm's `@zkochan/cmd-shim`; yarn 1 wrote the same form as
npm's cmd-shim 2. A `.js` target runs through the `node.exe` next to the shim if there is one,
otherwise through the Node that runs kurmis. An `.exe` target is started directly. A shim
kurmis cannot read is skipped and the search goes on; the not-found message lists every skipped
shim and why. The fixtures in `test/platform/fixtures/` were generated by running npm's and
pnpm's generators, except the older npm forms, which are written by hand from their source.

**What the packages contain.** `@anthropic-ai/claude-code`'s bin is `bin/claude.exe`; its
postinstall step replaces a placeholder script with the native program. When that step did
not run, the file does not start with `MZ`, and kurmis runs the package's `cli-wrapper.cjs`
through Node instead. Older versions had `cli.js`, which runs through Node. `@openai/codex`'s
bin is `bin/codex.js`, which kurmis runs through Node, so the launcher still sets its
`CODEX_MANAGED_BY_*` variables. Kurmis does not take over the `NODE_PATH` that pnpm's shims
set, because Node finds a package's dependencies from its real folder.

## Test hooks

Environment variables that exist only so tests can point kurmis at stand-ins. A person never
needs them.

- `KURMIS_HOME` moves the data folder; every test sets it to a temporary folder.
- `KURMIS_CLAUDE_BIN`, `KURMIS_CODEX_BIN` name the programs (also usable by a person).
  `test/setup.ts` points both at `test/no-real-program.mjs`, which only fails, so no test can
  start the real CLIs from PATH by accident; a test that needs a CLI names a fake, and a test of
  the PATH search removes them from the environment it passes.
- `KURMIS_UPSTREAM_URL` is Anthropic's API base URL, `https://api.anthropic.com` by default.
- `KURMIS_SECURITY_PROGRAM` is macOS's `security`, `/usr/bin/security` by default.
- `KURMIS_ENTRY` names the bundle a daemon is started from, for tests that run the CLI from the
  source tree, where there is no bundle to start.
- `KURMIS_LAUNCHCTL_PROGRAM` is `launchctl`, `/bin/launchctl` by default. `test/setup.ts` points
  it at `test/platform/fake-launchctl/launchctl.mjs`, which records its calls in
  `$FAKE_LAUNCHCTL_DIR` and answers bootstrap, bootout, print and kickstart with launchctl's exit
  codes. `FAKE_LAUNCHCTL_RUN=1` makes it run a loaded job's program with only the plist's
  environment, as launchd would; `FAKE_LAUNCHCTL_FAIL_BOOTSTRAP=<code>` makes every bootstrap
  fail.
- `KURMIS_REG_PROGRAM` is `reg.exe`, `<SystemRoot>\System32\reg.exe` by default. `test/setup.ts`
  points it at `test/platform/fake-reg/reg.mjs`, which keeps values in `$FAKE_REG_DIR`;
  `FAKE_REG_FAIL=1` makes every call fail.

**Testing the daemon process.** `test/daemon/bundle.ts` bundles kurmis into a temporary folder as
`scripts/build.mjs` does, with a version the test chooses. `entry: 'real'` is the real CLI;
`entry: 'fake'` runs `daemon run` around a small fake request handler
(`test/daemon/fake-app.ts`) and the real CLI for every other command. An older daemon is a
bundle built with an older version, so no variable is needed to fake one. In-process tests pass
`runDaemon` a fake app, an EventEmitter in place of `process`, and a `version`.

## Code layout

- `src/data/` holds the data folder: its paths, login ids, the JSON file helpers, the stores for
  `config.json`, `state.json` and `daemon.json`, and the log writer. Both the CLI and the daemon
  use it.
- `src/core/` holds pure logic with no I/O: routing, usage parsing, limits, the TOML merge. It
  holds most of the code copied from the original router.
  - `accounts.ts`: login ids and the defaults for a new login (both limits 100%, opted in).
  - `account-router.ts`: which login serves a request, the 429 and 400 handling, and when the
    pool can serve again.
  - `proxy-rules.ts`: the proxy's pure decisions: which paths it routes, the headers it sends
    and drops, the account uuid in the body, and the answers it gives when no login can serve.
  - `capacity-hold.ts`: how long a request waits when Anthropic has no capacity (529).
  - `route-headers.ts`: the `x-kurmis-*` headers and `ANTHROPIC_CUSTOM_HEADERS`.
  - `control-api.ts`: the control API's paths and answers, shared by the CLI and the daemon.
  - `routed-env.ts`: the environment a routed Claude CLI is started with.
  - `claude-usage.ts`, `usage.ts`, `usage-rules.ts`, `countdown.ts`: the usage snapshot, the
    `get_usage` parser and the rules over the windows.
  - `codex-protocol.ts`, `codex-usage.ts`, `codex-account.ts`: the Codex app-server's
    `account/rateLimits/read` and `account/read` answers.
  - `codex-account-config.ts`, `codex-home.ts`: the `config.toml` merge and what preparing an
    extra Codex home has to do.
  - `credentials.ts`, `keychain-service.ts`: the `.credentials.json` format and the Keychain
    item name.
- `src/daemon/` holds the proxy, the control API, the token readers (`credentials.ts` for the
  file, `keychain.ts` for the macOS Keychain), the usage probes and the daemon's lifecycle.
- `src/cli/` holds the commands and the wrapper. `main.ts` is the bundle's entry and
  `dispatch.ts` picks the command and handles `--help`, `--version` and `help <command>`. Each
  command is one module in `src/cli/commands/` exporting a `Command`: its name, a one-line
  summary, its help text and `run(args, context)`, which returns the exit code (0 done, 1
  failed, 2 wrong command line). The commands are `claude`, `codex`, `status [--json]`,
  `list [--json]`, `login <id>`, `logout <id>`, `setup [--undo]` and
  `daemon start|stop|restart|status|run`, where `daemon run` runs the daemon in the foreground
  and is what `daemon start` launches in the background. `daemon status` exits 1 when no daemon
  runs.
- `src/version.ts` holds the version, which the build takes from `package.json`.
- `src/platform/` holds what differs per OS: finding programs and reading npm shims (`programs.ts`,
  `npm-shim.ts`), folder links (`links.ts`), detaching and WMI starts (`detach.ts`), launchd jobs
  (`launchd.ts`), autostart (`autostart.ts`, `windows-autostart.ts`), and the file rename retry and
  file modes (`files.ts`). Every short-lived program kurmis starts goes through `runProgram` in
  `run.ts`: no shell, stdin closed, a deadline and a cap on the output. The usage probes, whose
  stdin carries JSON frames, go through `startFrameProcess` in `frame-process.ts`: no shell, a
  deadline, a cap on each frame and on all output, and a kill that takes the program's child
  processes with it (its process group on macOS and Linux, `taskkill /T /F` on Windows).
- `test/` mirrors `src/`. `test/fakes/` holds stand-ins for `claude`, `codex app-server` and
  Anthropic's API. `test/daemon/fake-security/` stands in for macOS's `security` program, with
  its Keychain items in a temporary folder. No test reaches the network or the user's real
  `~/.claude`, `~/.codex` or Keychain.
