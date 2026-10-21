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
- `config.json.lock` exists while a command changes `config.json` (`changeConfig` in
  `src/data/config.ts`, `src/data/lock.ts`). It is created with exclusive create and holds
  `{pid, createdAt, token}`. Another command waits for it, up to 15 seconds, and then fails
  with a message naming the pid that holds it. A lock whose pid is dead, or that is older than
  10 seconds, is stale and is removed; `config.json.lock.break` exists for a moment while that
  happens, so two waiters never remove each other's new lock. A lock is released only by the
  process whose token it holds.
- `settings/` holds the settings files `kurmis claude` passes to claude with `--settings`
  (below), mode 0600. One that holds only kurmis' variables is named after a hash of its
  contents and removed once no start has used it for 30 days. One that holds a copy of the
  person's own `--settings` is `run-<pid>-<random>.json`, deleted when that wrapper ends; one a
  killed wrapper left is removed by the next start once its pid no longer runs (or after 30
  days, in case the pid was reused).
- `claude/<name>/` is the config folder of the extra Claude login `claude:<name>`. On Windows
  it holds the login's `.credentials.json`. On macOS the CLI keeps the secret in the Keychain,
  under a name derived from this folder's path (`keychainService` in
  `src/core/keychain-service.ts`).
- `codex/<name>/` is the `CODEX_HOME` of the extra Codex login `codex:<name>`.
- `locks/<provider>-<name>.lock` (`locks/claude-work.lock`) exists while a `kurmis login` or
  `kurmis logout` of that login runs (`src/cli/login-lock.ts`). It is the lock file of
  `src/data/lock.ts`, held for the whole command, because a sign-in can take minutes. A second
  run for the same login stops at once with a message naming the pid that holds it. A lock whose
  pid no longer runs, or that is older than 24 hours, is taken over.
- `codex-merged/<name>.json` records what was last merged and copied into that home from the
  default Codex home (see "Codex").
- `daemon.json` holds the running daemon's pid, port, version and start time. The daemon writes
  it once it has its port and removes it as the last step of stopping, only while the file still
  names its own pid, so a replaced daemon never removes its successor's file. The file is renamed
  aside and checked again there before it is deleted, and one that names another pid by then is
  linked back, so a file written between the check and the removal is kept. The CLI removes a
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
cannot be removed, and they have no folder here. `claude:default` is the login in `~/.claude`:
`~/.claude/.credentials.json` and the Keychain item with the plain name, whatever
`CLAUDE_CONFIG_DIR` says (see "`claude:default` and `CLAUDE_CONFIG_DIR`" below). A CLI on a
default login runs with the environment left as it was inherited, apart from the routing
variables and, for Claude, `CLAUDE_SECURESTORAGE_CONFIG_DIR`.

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
  `list` on the person's own terminal; the email is never logged. A request body may be at most
  64 KB (`MAX_CONTROL_BODY_BYTES`). A larger one is answered 413 with the control API's error
  answer (`{ "ok": false, "error": "…" }`) as soon as the size is known, from `content-length` or
  while reading. The daemon then goes on reading the rest of the body and throws it away, for at
  most 30 seconds, instead of closing the connection: a connection closed while the client is
  still sending is reset, and the reset can lose the answer before the client reads it.
- **The proxy** is every other routed path (`src/daemon/proxy.ts`). A request needs the header
  `x-kurmis-key: <secret>`, which reaches the CLI through `ANTHROPIC_CUSTOM_HEADERS`, else it gets
  403 with no body. It may also carry `x-kurmis-login: claude:<name>`, which pins it to that
  login, and `x-kurmis-started-on: claude:<name>`, the login the CLI was started on, or
  `x-kurmis-started-on: none`, which says the CLI's credentials are no kurmis login's (below,
  "`claude:default` and `CLAUDE_CONFIG_DIR`"). Either one naming no Claude login, `none` aside,
  is a 400. None of them is forwarded upstream. The body is read whole
  (at most 64 MB), because a request may have to be sent more than once. A body that is not JSON
  is a 400. Otherwise it goes upstream as the bytes that came, except for the account uuid in
  `metadata.user_id`, which is set to the chosen login's (`outgoingBody` in
  `src/core/proxy-rules.ts`): only that string is replaced in the text, so key order, white space
  and integers above 2^53 reach Anthropic as the CLI sent them. A larger body gets a
  413 with an error in the shape of Anthropic's own (`request_too_large`), which the CLI does
  not retry. The proxy then goes on reading the rest of the body and throws it away, for at most
  5 s after the answer (`TOO_LARGE_LINGER_MS`), and closes the connection, for the same reason
  as the control API above.
- **Choosing a login** follows the order in the header of `src/core/proxy-rules.ts`. Logins
  whose usage reading belongs to a window that has ended are probed first. Such a probe of a
  login is not started again within a minute of the last one (`STALE_PROBE_INTERVAL_MS` in
  `usage-poller.ts`), by any request, so a probe that keeps failing does not run before every
  request; meanwhile the stale reading counts as empty, as it does anyway. A login whose token
  is about to expire is chosen as if it were fresh. Its token is then read again, past the
  minute a Keychain answer is kept, since the CLI may have renewed it, and only a token that is
  still about to expire is renewed by a usage probe; on Auto,
  when another login could take the request, the request waits at most 5 s
  (`RENEWAL_WAIT_MS`) for that and then goes to the other login. A login whose record has no
  refresh token is never renewed: it just becomes unusable when its token is about to expire.
- **Signing.** The proxy signs with `Bearer <token>` for the token it read for the chosen login.
  When the chosen login is the one the CLI was started on and no token was read for it, the
  CLI's own `authorization` header is forwarded instead. No other login is ever signed with the
  CLI's header. A request with `x-kurmis-started-on: none` is never signed with the CLI's header,
  and `claude:default` is left out of its pool, because the CLI is signed in to another account
  than `claude:default`'s; when no other login can take it, the proxy's 599 says so. A 401 is
  handled this way:
  - A 401 on the CLI's own header goes to the CLI as it is: the CLI owns that token.
  - A 401 on a token the proxy read makes it read the token again. When the record has a
    refresh token, the proxy renews it once through a probe (the probe's CLI renews a refused
    token) and sends the request again on the same login. A record without a refresh token is
    not renewed.
  - When that login still answers 401, or could not be renewed, the 401 goes to the CLI only if
    the login is the one the CLI was started on (the CLI can sign it in again) or the session
    is pinned to it with `x-kurmis-login`. Otherwise the request goes on to the next login, and
    Auto treats the login as signed out (`markRefused` in `logins.ts`, in memory only) until a
    usage probe of it succeeds and finds it signed in, at the latest the next 15-minute poll.
    With no login left, the CLI gets the proxy's own 599 below, never that 401.
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
  The body of a 429 the proxy keeps to pass on later, and of the 400 before a move back (below),
  is read for at most 5 s (`KEPT_ANSWER_TIMEOUT_MS`), so a body that stalls does not hold the
  request back from the next login; what came by then is what the CLI gets.
- **No capacity.** A 529, or a 429 without usage-limit headers, puts that login into the
  session's backoff (`CapacityCooling` in `src/core/capacity-hold.ts`) and the request goes to
  another login at once when the session may use one that is not cooling. Otherwise it waits for
  the first login to come out of its backoff, for any change in the logins (usage, cooldown,
  config), or for the client to close the request. After `CAPACITY_HOLD_MS` (two minutes) the
  proxy answers 529 itself, and the CLI sends the request again. The two minutes also end the
  wait for the headers of a request sent during the hold, but only until the headers arrive:
  the body of an answer that started within the hold is passed on to its end.
- **Moving a session back.** When an Auto session has just moved to another login and that login
  answers 400, the request is sent again on the login that served the session before, whatever
  that login's usage, and the session is held to that login for its later requests. Some
  conversations cannot be continued on another login. The login that answered 400 is not tried
  again for this request; when the previous login cannot take the request either, the CLI gets
  that 400. The hold lasts while the held login can serve. It ends, and the request is routed on
  Auto, when the held login is signed out, has no token the proxy can sign with, is cooling down
  after a usage limit, or has a window at 100% (the held login is measured like a pinned one,
  not to its own limits), or when it answers a usage-limit 429, which is then sent again on
  another login as on Auto. The hold is kept in memory only, so a daemon restart ends it too:
  `state.json` keeps only the login each session was last on. A hold unused for 7 days, and any
  beyond the 2000 most recently used, is dropped, the same bounds as session placements.
- **No login can sign** (none signed in, no token readable and no header of the CLI's own for
  the login it was started on): the proxy's own 599 (`noSignerAnswer`), which the CLI retries.
- **The upstream connection** (`src/daemon/upstream.ts`) uses `node:https`, not `fetch`, because
  `fetch` gives up after 300 s waiting for headers or between two chunks, which a long thinking
  turn can exceed. There is no limit on the whole request: the CLI aborts its request when it
  gives up, and that aborts the upstream request at once. The only other end set on a request is
  the capacity hold's, and only until the answer's headers arrive. A connection that carries no
  data in either direction for 20 minutes fails; a new connection must be ready within 30 s; TCP
  keep-alive probes start after 30 s of silence; idle connections are kept for reuse for 30 s.
  A request that meets a reset on a reused connection before any answer is sent once more, but
  only when the reset came while the request was being written or within 2 s after
  (`RESEND_WINDOW_MS`): that is a connection the server closed while it was idle. A later reset
  may follow a request the server worked on, and goes to the CLI as a 502 instead.
  Answers are passed on byte for byte as they arrive, with backpressure: a CLI that reads slowly
  pauses the upstream connection. The daemon's HTTP client decodes nothing, so
  `content-encoding` is passed on with the body.
- **Usage** is probed every 15 minutes for each signed-in login (and each login not probed
  yet), and on demand: the control API's `probe`, a stale reading, a token renewal, and a login
  added to `config.json`. One probe per login runs at a time; a second request waits for it. A
  failed probe keeps the previous windows and records the error on the snapshot. The daemon also
  updates usage from the rate-limit headers of every answer it forwards. A probe describes the
  login as it was when the probe started, so what an answer said after that wins: the last
  answer's rate-limit headers are applied again on top of the probe's snapshot, and a cooldown
  or a refused token recorded after the probe started is not ended by it. The code is
  `src/daemon/usage-poller.ts`, with the probes in `claude-probe.ts` and `codex-probe.ts`.
  A Claude probe is `claude -p` in stream-json mode, sending `initialize` and `get_usage`, with
  `claudeProbeEnv`, `--setting-sources=` (no settings file, so no `env` block or hook of the
  person's reaches it), no MCP servers, no saved session, `DISABLE_AUTOUPDATER=1`, and the empty
  folder `probe/cwd` as its working folder. A Codex probe is `codex app-server` with
  `codexLoginEnv`, sending `initialize`, `account/read` and `account/rateLimits/read`. Each probe
  has 30 s from start to exit and is killed with its child processes after that, or when the
  daemon closes (`src/platform/frame-process.ts`). After its answer the probe closes the CLI's
  input and waits for it to exit, so a token the CLI renewed is on disk when the probe ends. The
  daemon finds `claude` and `codex` on the PATH it was started with, so a CLI installed or put on
  PATH later is found only after a `kurmis daemon restart` from a shell that finds it; the error
  a probe records when the program is missing says that.
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

A bind that fails with EACCES or EADDRNOTAVAIL is an error, exit 1, with the same advice and
the command that lists the port ranges Windows reserves (`netsh int ipv4 show excludedportrange
protocol=tcp`): on Windows a port inside such a range (Hyper-V, WSL and Docker reserve them) is
refused with EACCES although nothing listens on it.

Only after the bind does the daemon write `daemon.json` and start the request handling, which
reads `state.json`, so a daemon that loses the bind never touches the state. Requests that
arrive while the request handling starts wait for it.

**Stopping.** On SIGTERM, SIGINT, SIGHUP or a control `stop`, the daemon does the steps below. On
Windows a SIGTERM from another process cannot be caught: Node's `process.kill` ends the process
at once there. So on Windows only a control `stop`, and Ctrl-C or closing the console of a
`daemon run` in a terminal (SIGINT, SIGHUP), stop it this way. The daemon:

1. stops accepting at once, which frees the port, and stops the 15-minute usage poll (probes
   that run and probes its open requests ask for still run);
2. closes idle keep-alive connections, again every second, and marks its answers
   `connection: close`, so a CLI's next request opens a connection to whatever holds the port
   next;
3. waits for its open proxied requests, for at most 15 minutes. A Claude CLI waits at most
   `API_TIMEOUT_MS` (600 s by default) for the headers of an answer; that a streamed answer
   that has started ends within the rest of the 15 minutes is an assumption. A second stop
   signal ends the wait. A control `stop` with a body `{ "maxWaitMs": <n> }` ends it after n
   milliseconds instead (`kurmis daemon stop` sends its own 30-second deadline this way); a
   `stop` without a body waits the whole 15 minutes;
4. writes `state.json`, closes the remaining connections, removes `daemon.json` and exits 0.

An uncaught error is logged by its error code only, and the daemon stops without waiting for its
requests and exits 1. The next kurmis command starts a new one.

**Version handover.** A CLI that finds a daemon of an older version starts a new daemon, and the
new daemon does the handover: it sends the old one a control `stop` and tries the bind every
100 ms for up to 10 seconds. While the old daemon closes, its port may answer the status request
with nothing or with an error; once the stop is sent that counts as the old daemon going away,
not as another program, and the bind is tried again. The old daemon frees the port as soon as
it has answered, and
finishes its open requests in the background while the new one serves. A routed Claude CLI
retries a request that finds no daemon (`CLAUDE_CODE_MAX_RETRIES=15`), which covers the moment
in between. Versions are compared numerically (`0.10.0` is newer than `0.9.1`), and an older
kurmis never replaces a newer daemon. A daemon on another port than `config.json` names (the
port was changed while it ran) is not reached by the new daemon's bind, so the CLI asks it to
stop with a control `stop` before it starts the new one, and the old daemon finishes its open
requests in the background as above. The CLI does this only when the running daemon's version
is the same as its own or older. When the daemon is newer, or the two versions cannot be
compared and differ, the CLI stops with an error that says to update kurmis or to stop the
daemon with `kurmis daemon stop`.

**Finding it.** The CLI reads `daemon.json` and counts the daemon as running only when it
answers a status request with the key. A `daemon.json` whose pid exists but that does not answer
is left alone, since that daemon may be finishing its requests before it stops. When
`daemon.json` finds nothing, the CLI also asks the configured port, since a daemon that has just
bound may not have written `daemon.json` yet.

When the pid in `daemon.json` exists and the program on its port answers the keyed status
request with 403, the `key` file was most likely changed or deleted while that daemon ran, so
the daemon still has the old key. `kurmis daemon start`, `stop` and every command that starts the
daemon then stop with an error, and `kurmis daemon status` prints the same text: the program on
the port refused the key in the key file, `daemon.json` names pid N, and if that is the daemon,
stop it with `kill N` (`taskkill /PID N /F` on Windows), then run the command again, and run
`kurmis setup` again if it was used, so the Claude Code settings hold the new key. The CLI does
not signal that pid itself: a daemon that refuses the key answers nothing that shows it is a
kurmis daemon, and the pid may since belong to another program.

**Starting it from the CLI** (`ensureDaemon`, `kurmis daemon start`): when none answers, the CLI
starts `<node> <bundle> daemon run` and waits up to 15 seconds for a daemon of its version or a
newer one to answer (30 seconds through launchd or WMI). The bundle is the one running now, with
symlinks resolved. The daemon does not inherit `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS` or `CLAUDE_SECURESTORAGE_CONFIG_DIR`, which a
CLI started inside a routed session has. It runs in the home folder, so it holds no project
folder open, and so `KURMIS_HOME` is made absolute (from the CLI's current folder) in every
environment the CLI hands to a daemon: a direct start, the launchd job, the launchd login item,
the Windows logon script and the command line of a start through WMI. How it is started:

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
  own environment from Windows, not the CLI's, so the kurmis variables that are set
  (`KURMIS_HOME` as an absolute path, and the test hooks; the same list the launchd job carries)
  go on its command line: `daemon run --env KURMIS_HOME=<path> …`, and `daemon run` puts each
  into its own environment before it reads any file. `--env` takes only those names. When WMI
  refuses, the daemon is started directly with a warning that it ends with the session.

Terminals that put their children in a kill-on-close job (some IDE terminals) are not detected;
a daemon started from one ends with it, and the next kurmis command starts it again.

**Stopping it from the CLI** (`kurmis daemon stop`) sends the control `stop` with
`{ "maxWaitMs": 30000 }` and waits up to 30 seconds for the pid to exit. A second control
request cannot be sent instead: a daemon that has answered `stop` no longer listens on its
port, and another daemon may hold the port by then. So the deadline goes with the first
request, and the daemon ends its wait for its open requests by itself when it is over, writes
`state.json` and exits. What happens when the pid is still there after the 30 seconds (a daemon
older than `maxWaitMs`, which ignores the field) depends on the platform:

- **macOS and Linux:** the CLI sends SIGTERM, which, as the second stop signal, ends the
  daemon's wait, and waits 5 more seconds.
- **Windows:** `process.kill` ends the process at once there (TerminateProcess), without
  `state.json` being written or `daemon.json` removed. So the CLI first waits 10 seconds more,
  for a daemon that ended its wait by itself to finish, and only then ends the process and waits
  5 more seconds.

Only a pid that answered the keyed status request as the daemon's own is ever signalled.
`kurmis daemon restart` sends `stop` without a body, waits until the port is free, and starts a
new daemon at once, so the old one finishes its requests in the background. It refuses to
replace a daemon of a newer version.

### Starting at login

`kurmis setup` registers `<node> <bundle> daemon start --no-launchd` to run when the user logs
in, and `setup --undo` removes it. That command starts the daemon detached and exits, so
removing the entry never ends a running daemon. Both are idempotent: what is already there is
compared first. The Node is the first `node` on PATH when it is the same file as the running one,
since `process.execPath` names a versioned folder that a Homebrew upgrade removes.

- **macOS:** `~/Library/LaunchAgents/kurmis.daemon.plist`, the same shape and environment as
  the one-shot job (`KURMIS_HOME` as an absolute path; mode 0644; it holds no secret). It is
  written only when its content differs, then loaded with `launchctl bootstrap`, which also runs
  it once; one loaded with old content is unloaded first, since launchd keeps what it read at
  load time. When loading fails (nobody at the screen), the plist stays and a warning says it
  starts at the next login. `setup --undo` runs `bootout`, ignoring "not loaded", and deletes the
  plist.
- **Windows:** the `REG_SZ` value `kurmis` under
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, set, read and removed with `reg.exe`
  through `runProgram` (no shell). It needs no admin rights and shows in Task Manager's Startup
  tab. Its data is `<SystemRoot>\System32\wscript.exe //B //Nologo "<data folder>\autostart.vbs"`
  with full paths. node.exe is a console program and would flash a console window at logon, so
  the script, UTF-16 with a byte order mark, sets the kurmis variables (`KURMIS_HOME` as an
  absolute path, and the test hooks that are set) and the start folder and
  starts node hidden without waiting (`WScript.Shell.Run "<command line>", 0, False`). `//B`
  stops error dialogs at logon.
- **Other platforms:** a warning (setup still exits 0); the next kurmis command starts the
  daemon.

## How a Claude CLI reaches the daemon

`kurmis claude …` starts `claude` with:

- `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`;
- `ANTHROPIC_CUSTOM_HEADERS` carrying the key, and the login when one was named;
- `ENABLE_TOOL_SEARCH=true`, because the CLI turns tool search off for any base URL that is not
  Anthropic's, and the proxy passes it through;
- `CLAUDE_CODE_MAX_RETRIES=15`, so a request outlasts a daemon restart. These two are left out
  when the person sets either themselves, in their `--settings`, the user settings file or the
  environment, to a value that is not empty: routing works without them, so their value stays,
  as `kurmis setup` keeps it in `settings.json`;
- `CLAUDE_SECURESTORAGE_CONFIG_DIR` naming the folder of the login it starts on, or set to the
  empty string on `claude:default`, which the CLI reads as the default credentials, so that also
  a CLI with `CLAUDE_CONFIG_DIR` set signs in as `claude:default`;
- `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` removed, because a key would sign the requests
  itself and no subscription would be billed;
- `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` removed, because a CLI
  with a token of its own sends that token instead of the credentials of the login it was
  started on, and the proxy forwards the started-on login's header when it has read no token
  for that login, so the request would be billed to whatever account the token belongs to. The
  wrapper prints one line on stderr when either was set.

**Kurmis' own options come first.** `kurmis claude` and `kurmis codex` read their options
(`--login <id>`, `--help`) from the front of the argument list and stop at the first argument
they do not know. That argument and everything after it go to the CLI unchanged. `--` also ends
kurmis' options and is dropped, so `kurmis claude -- --help` shows claude's own help, while
`kurmis claude --help` shows kurmis'. `--login` takes a full id or just the name, so
`--login work` means `claude:work` under `kurmis claude`. The code is `src/cli/wrapper-args.ts`.

**The login the CLI starts on** (`src/cli/commands/claude.ts`). The wrapper starts the daemon
when it is not running and reads its status. With `--login`, the CLI starts on that login, which
must be a Claude login in `config.json` and, unless it is `claude:default`, must have its folder.
On Auto, `autoStartLogin` picks the login: `claude:default` while it is signed in (an unknown
sign-in state counts as signed in for it, and only for it), otherwise a signed-in login of the
pool, with a note on stderr. The proxy signs each request with the login it picks. When that is
the login the CLI was started on, the proxy forwards the CLI's own `Authorization` header. The
wrapper sends `x-kurmis-started-on` with that login. When the daemon cannot be reached, the
wrapper does not start claude unrouted; it fails with a message naming `kurmis daemon start`
and the log.

**The `env` of `settings.json` beats the process environment, and the `--settings` flag beats
`settings.json`.** Measured with Claude Code 2.1.301 against two local servers. In global mode
a variable the wrapper puts in the process environment is therefore ignored, so the wrapper
also passes its routing variables (`ROUTING_VARIABLES`: the base URL, the custom headers,
`ENABLE_TOOL_SEARCH` and `CLAUDE_CODE_MAX_RETRIES`) in a `--settings` argument
(`src/cli/settings-arg.ts`). `CLAUDE_SECURESTORAGE_CONFIG_DIR` stays in the process environment
only.

How Claude Code 2.1.301 reads `--settings`, from its bundled source: before it parses the
command line it scans the arguments up to the first `--` and loads only the last `--settings
<value>` or `--settings=<value>`. Its parser has positional options on, so a root option such as
`--settings` must come before a subcommand (`claude --settings X mcp list`). A value whose
trimmed text starts with `{` and ends with `}` is inline JSON; anything else is a file path
relative to the folder claude starts in.

So the wrapper passes exactly one `--settings`, first, ahead of the person's arguments:

- When the person's arguments carry `--settings` before claude's `--`, the last one is read
  (inline JSON, or the file, relative to the current folder), kurmis' variables are merged into
  its `env`, and every `--settings` of theirs is taken out. Their other keys and variables are
  kept; for the base URL and the custom headers kurmis' values win, and their own
  `ENABLE_TOOL_SEARCH` and `CLAUDE_CODE_MAX_RETRIES` stay (above). Their file is never changed.
  Settings that cannot be read, are not a JSON object, or have an `env` that is not an object
  stop the start with a message.
- The merged settings go to claude as a file in the data folder's `settings/`, mode 0600, not
  inline, because they hold the key and a command line is visible to other users in the process
  list. Claude passes its `--settings` value on to processes it starts itself, such as
  background sessions, which can outlive the wrapper. So a file with only kurmis' variables is
  shared by every start with the same values (named after their hash) and kept. A file with a
  copy of the person's own settings, which may hold secrets of theirs, belongs to one wrapper
  (`run-<pid>-<random>.json`, so several wrappers at once each have their own) and is deleted
  when claude has ended. A process claude starts with it after that cannot start: Claude Code
  2.1.306 stops with "Error: Settings file not found: <path>". So a background session that
  claude starts after the wrapper has ended fails when the person passed their own
  `--settings`; one that is already running has read the file. The next start removes a file a
  killed wrapper left, by the pid in its name: when that pid no longer runs, or when the file is
  older than 30 days, in case the pid was reused by another program.
- `ANTHROPIC_CUSTOM_HEADERS` keeps the person's own header lines. They are taken from the
  highest layer that sets the variable, as the CLI would: their `--settings`, then the user
  settings file (`$CLAUDE_CONFIG_DIR/settings.json` when that is set, else
  `~/.claude/settings.json`), then the process environment. Project settings files are not read,
  so headers set only there are dropped. A user settings file that is not JSON is a warning.

**Global mode** is `kurmis setup` (`src/cli/global-settings.ts`, `src/cli/commands/setup.ts`). It
puts the routing variables in the `env` block of the user settings file, so a plain `claude` and
the IDE extensions are routed too. The values are those of an Auto CLI with no started-on
header, so a plain `claude` runs on `claude:default`, except in a `$CLAUDE_CONFIG_DIR/settings.json`
whose CLIs have credentials of their own (below). It also registers the daemon to start at
login (a launchd agent on macOS, a logon entry on Windows) and starts the daemon.

The daemon is started first. Once the file names the daemon, every Claude Code on the machine
sends its requests there, so the file is written only after a daemon answers on the port
`config.json` names, with the key that daemon accepted. Setup checks first that it could edit
the file, so a file it would refuse starts no daemon. Autostart is registered last.

- The file is `$CLAUDE_CONFIG_DIR/settings.json` when that variable is set and not empty, as the
  CLI reads it, else `~/.claude/settings.json`; the path used is printed. A `CLAUDE_CONFIG_DIR`
  inside kurmis' data folder is refused.
- The file is edited as text: only the members of `env` change, and key order, indent, line
  endings and a byte order mark stay as they were. A file that is not plain JSON (comments,
  trailing commas), or whose top level or `env` is not an object, is refused and not written.
  The message names the line and column where it stops being JSON and never quotes the file,
  since it may hold a secret (`src/cli/json-error.ts`); the same goes for a `--settings` file of
  the wrapper's and the user settings file it reads for custom headers.
  A symlinked file is written through the link: the link stays, its target gets the change, and
  setup warns that the key is written to that target and names it. A link whose target does
  not exist yet gets that target created, so the link is not replaced by a plain file.
- On Windows a read-only file (its read-only attribute set) is refused with the `attrib -R`
  command that clears it, because a rename over a read-only file fails there. A write that
  fails because another program holds the file open is reported as a sentence, not a stack.
- When setup changes an existing file that holds none of kurmis' settings, it first copies it
  to `settings.json.kurmis-backup` (mode 0600), replacing an older backup: after a setup, an
  undo and months of edits, the file as it is now is what "before kurmis" means. When the file
  already holds kurmis' settings (setup run again after the port or the key changed), the
  backup is left as it is.
- The file holds the key after setup, so setup makes it readable by the user only: a new file
  gets mode 0600, and an existing one has its group and other bits cleared (0644 becomes 0600),
  also when setup finds kurmis' settings already there and writes nothing. An existing backup
  has its group and other bits cleared too. Setup says when it changed a mode. Undo keeps the
  mode the file has. On Windows node ignores modes, so nothing is changed there; the file is
  protected by the access list it inherits from its folder (`PRIVATE_FILE_MODE` in
  `src/platform/files.ts`).
- An `ANTHROPIC_BASE_URL` that is not kurmis' (`http://127.0.0.1:<port>` with the port of
  `config.json`, or with an `x-kurmis-key` in the same `env`'s headers) is refused, so another
  proxy is not cut off silently. A value of the person's own for `ENABLE_TOOL_SEARCH` or
  `CLAUDE_CODE_MAX_RETRIES` is kept, and setup says so. Their own header lines are kept exactly
  as written, ahead of kurmis' lines.
- When the daemon cannot be started, or runs on another port than `config.json` names, nothing
  is written and setup exits 1. When autostart then fails, the settings change stands and setup
  exits 1; running it again is safe. A launchd agent that is written but can be loaded only at
  the next login, and a platform without autostart (Linux), are warnings with exit 0: the
  daemon runs now, and the next kurmis command starts it after a restart.

`kurmis setup --undo` removes only the values that are still kurmis': a key the person changed is
left and reported, and only the `x-kurmis-*` lines are taken out of the custom headers. When the
lines left are the ones the backup has, the backup's value comes back as it was (with its line
endings and blank lines); otherwise the lines left are joined by newlines. A value the backup
already had (read with or without a byte order mark) is left. An `env` that undo empties is
removed, unless the backup shows the file had an `env` before kurmis. It unregisters autostart and leaves the daemon running, because
`kurmis claude` still uses it. Both directions can be run again without changing anything more.
Claude Code sessions that are already open keep the settings they started with.

Before its first request the CLI sends `HEAD /api/hello` to the base URL, without the custom
headers. The proxy answers that path itself.

**`claude:default` and `CLAUDE_CONFIG_DIR`.** `claude:default` is the login in `~/.claude`: the
daemon reads its token from the Keychain item with the plain name or from
`~/.claude/.credentials.json`, its probe runs with `CLAUDE_SECURESTORAGE_CONFIG_DIR` empty, and
`kurmis login claude:default` runs without `CLAUDE_CONFIG_DIR`. Claude Code 2.1.306 (read from
its bundled source) takes its credentials from `CLAUDE_SECURESTORAGE_CONFIG_DIR` when that is
set, the empty string meaning the default ones, and otherwise from `CLAUDE_CONFIG_DIR`: the file
in that folder, and a Keychain item named after the variable's value (`keychain-service.ts`). So
a CLI started with `CLAUDE_CONFIG_DIR` set may be signed in to another account than
`claude:default`. The daemon is one per user and cannot follow a variable that each shell sets
for itself, so kurmis keeps `claude:default` fixed and makes sure no request is signed as
`claude:default` for a CLI on other credentials:

- `kurmis claude` on `claude:default` sets `CLAUDE_SECURESTORAGE_CONFIG_DIR` to the empty string,
  so the CLI signs in with `claude:default`'s own credentials while its settings and transcripts
  still come from `CLAUDE_CONFIG_DIR`. When `CLAUDE_CONFIG_DIR` is set it says so on stderr.
- `kurmis setup` from a shell with `CLAUDE_CONFIG_DIR` set writes
  `$CLAUDE_CONFIG_DIR/settings.json`, which only CLIs with that variable read, and those sign in
  with the credentials in that folder. So setup adds `x-kurmis-started-on: none` to the custom
  headers there, and says so. The proxy then signs those CLIs' requests only with extra logins.
- On macOS and Windows any value of `CLAUDE_CONFIG_DIR` counts, the path of `~/.claude` too,
  because the CLI names its Keychain or Credential Manager item after the value. On Linux a
  value that resolves to `~/.claude` is the same file and does not count
  (`configDirHasOwnCredentials` in `src/data/login-env.ts`).

## The wrapper

`kurmis claude`, `kurmis codex` and `kurmis login` start their CLI through `runInteractive` in
`src/cli/wrapper.ts`: `stdio: 'inherit'`, no shell, and the wrapper waits for the child.

- **macOS and Linux.** Ctrl-C (SIGINT) and Ctrl-\ (SIGQUIT) reach every process in the
  terminal's foreground process group, so the child gets them itself; the wrapper ignores them
  while the child runs, as `system(3)` does. That is so only when stdin is a terminal. When it
  is not (a script or a program runs `kurmis claude -p`), a SIGINT or SIGQUIT is most likely
  sent to the wrapper's pid alone, so the wrapper forwards them like SIGTERM. A child whose input
  is piped but that runs in a terminal's foreground process group then gets Ctrl-C twice, which
  a CLI that is not interactive does not mind: it ends at the first. SIGTERM and SIGHUP are
  usually sent to the wrapper alone, so it forwards them to the child and keeps waiting.
- **Windows.** Ctrl-C, Ctrl-Break and closing the console reach every process on the console
  (Node reports closing as SIGHUP). The wrapper ignores all three and forwards nothing, because
  `child.kill()` there ends the child at once with TerminateProcess.
- **How the wrapper ends.** With the child's exit code. When the child was ended by a signal,
  the wrapper removes its handlers and raises the same signal on itself, so the shell sees the
  same end; for a signal whose default action writes a core dump, and on Windows, it exits with
  128 + the signal number instead. A child that cannot be started gives a message and the code a
  shell would give: 127 when there is no such program (also when `findProgram` finds none), 126
  when it cannot be run (EACCES, EPERM, ENOEXEC, EISDIR), 1 otherwise.

- **Starting itself again.** A `claude` or `codex` on PATH may be a script of the person's that
  runs `kurmis claude` or `kurmis codex`, and kurmis would start it, which starts kurmis, without
  end. The wrapper adds its pid to `KURMIS_WRAPPER_PIDS` in the child's environment, and refuses
  to start its child (exit 1, with a message that says to take the program off PATH or to set
  `KURMIS_CLAUDE_BIN` or `KURMIS_CODEX_BIN`) when its own parent is one of those pids, which is
  what a script that `exec`s kurmis gives, or when eight wrappers already run inside each other,
  which catches a script that starts kurmis without `exec`. A `kurmis claude` run from the shell
  of a session has the CLI or a shell as its parent, never a wrapper, so it is not refused. A
  PATH hit that is kurmis' own bundle is skipped when the program is looked up (below).

`test/cli/wrapper-pty.test.ts` checks this under a pseudo-terminal: `test/cli/pty-driver.py`
(run with `python3 -I`) starts a bundled wrapper on the fake claude, sends Ctrl-C and SIGTERM, and
kills whatever is left in the process group. It needs `python3` and is skipped on Windows.

## Codex

There is no proxy for Codex. `kurmis codex …` picks a login when it starts, or uses the one named
with `--login`, prepares that login's `CODEX_HOME` and starts `codex` with it. `codex:default`
runs with `CODEX_HOME` as it was inherited, except that an inherited `CODEX_HOME` inside kurmis'
`codex/` folder (left by an outer `kurmis codex` session on an extra login) is removed.

**Choosing the login** (`src/core/codex-choice.ts`, `src/cli/commands/codex.ts`). The wrapper
starts the daemon when it is not running, reads its status, and ranks the Codex logins with
`chooseAccount`, as Claude's Auto ranks a new session. The rows come from the status: routing,
limits and use-first from the login, signed in unless the daemon says it is not (an unknown state
counts as signed in), no token expiry. A login the server refused (its usage says `rejected`)
is passed over until the reset it named, even when no window reads 100%. The usage says
`rejected` when the plan's general limit (limit id `codex`) or the workspace's spending control
has been reached. A limit that meters one model apart only stops that model, so reaching it does
not make the login refused (`statusOf` in `src/core/codex-usage.ts`).

- When at least two Codex logins could be chosen and one of them has usage that is missing or
  older than 20 minutes (the daemon's 15-minute probe interval plus 5), the wrapper asks the
  daemon to probe those logins and waits up to 5 seconds, then goes on with what it has.
- When every login routing may use is at a limit, it starts on the one whose usage comes back
  first, with a note on stderr saying when.
- When none of them is signed in, or the daemon cannot be reached, it starts on `codex:default`
  with a note.
- With more than one Codex login, it prints which one it starts on.

**Preparing a login's home.** Before every start on an extra login, `prepareCodexHome`
(`src/cli/codex-home-files.ts`) prepares `codex/<name>/` from the default Codex home: `CODEX_HOME`
of the starting environment, or `~/.codex`. A `CODEX_HOME` inside kurmis' own `codex/` folder is
a login's home, inherited by a `kurmis codex` run from inside a session on that login; it is
ignored and `~/.codex` is used. The decisions are the pure functions of `src/core/codex-home.ts`:

- Each folder of the default home is linked into the login's home, and so is a link there that
  leads to a folder (into a dotfiles folder, say); the login's link then leads to the link in the
  default home. Left out are scratch folders (`tmp`, `.tmp`), every `.sandbox` folder of the
  Windows sandbox (below), and names that say they hold a credential or a database
  (`codexPrivateName`).
- A link in the login's home that kurmis made and that leads to a folder no longer shared, or
  leads nowhere, is removed first (`codexStaleLink`). A link that leads nowhere counts as kurmis'
  when its target has the link's own name, which also catches links into a default home used
  before. Other links are left alone.
- `AGENTS.md` and `AGENTS.override.md` are copied. When the default home no longer has one of
  them, a copy kurmis made is removed, so a removed `AGENTS.override.md` (which Codex reads
  instead of `AGENTS.md`) stops overriding; a file kurmis did not put there stays.
- `config.toml` is merged without its secrets (below). Both it and the copied files are read
  through a link, so a file that is a symlink into a dotfiles folder still counts.
- `auth.json` and every other file stay out, so each login keeps its own sign-in.

An empty real folder where a link should go (Codex made it before the default home had that
folder) is replaced by the link. A folder with something in it, or a link to somewhere else, is
left as it is with a warning, given once per folder. When two `kurmis codex` start on one login
at the same moment, the one whose link creation fails with EEXIST reads the place again and
finds the other's link. Every step that fails adds a warning to stderr and the start goes on.
Only a home that cannot be created stops it.

**What was merged.** `codex-merged/<name>.json` in the data folder records, for the login's
home, the default home's `config.toml` without secrets as it was last merged in, a SHA-256 of
each file last copied in, and the folders already warned about. It is kept outside the Codex
home, written with mode 0600, rewritten only when it changes, and removed by `logout`. A home
that is empty when a start begins (a new login) starts from an empty record, so a record left
by an earlier login of the same name is not used.

**The `config.toml` merge** (`src/core/codex-account-config.ts`). Codex writes to the
`config.toml` of the home it runs with (a `/model` choice, `[notice]` keys, plugin and feature
switches, trust), so the merge is three-way, against the last merged copy, one setting (a
value, or a whole array) at a time:

- A setting the default home has is taken from it, unless the default home's value is the one
  last merged in and the login's file has another: then the login (or Codex in a session on it)
  changed it, and that value stays until the default home's changes.
- A setting the login's file has and the default home no longer has is removed when it was in
  the last merged copy, and kept when it never was.
- A table that loses its last setting that is not a secret goes as a whole, with its header and
  the login's own secrets in it. Codex refuses to load a file where an MCP server has only an
  `env` table left (`invalid transport`).
- Without a last merged copy (the first start after kurmis began keeping one), every setting of
  the login that is not a secret or trust counts as merged in before, which is what the earlier
  two-way merge did: what the default home lacks is removed this once.
- When the default home has no `config.toml`, the login's file and the record stay as they are.

A secret is never copied from the default home, and a secret in the login's file is never
changed or removed, except with its whole table. A key name marks the strings under it as
secrets by its last word (`secretKeyName`): `token`, `secret`, `password`, `passphrase`,
`authorization`, `cookie`, `apikey`, or `key` other than in `env_key` and `public_key`. So
`experimental_bearer_token`, `bearer_token`, `access_token`, `client_secret` and `api_key` are
secrets, while `bearer_token_env_var` and `env_key` (names of environment variables),
`cli_auth_credentials_store` (a kind of store), `mcp_oauth_callback_port` (a port) and
`model_auto_compact_token_limit` (a count) are not. The tables `env`, `set`, `http_headers`,
`headers` and `query_params` hold secrets whatever their keys are called, and
`client-private-key` (otel's path to a key file) is not a secret. A boolean, a number or a date
is never a secret. A string is also a secret when its text looks like one (a bearer token, a
known key format, a password in a URL, `--token <value>`), and an argument list when it passes
a header or a token. The rule errs towards secrets: `features.network_proxy.credentials.<n>.env`
holds names of variables and is still not copied. When the default home has a secret the login
lacks, a warning says so. When a secret stands in the way of a setting (the login's value holds
one, or the default home's array of tables holds one and differs from the login's in more than
its secrets, such as a new `[[x]]` element), the login's stays and a warning names the setting,
at every start until the two agree.

The login's file keeps its layout and comments. The merge parses each file once and makes all
its changes in one pass: a changed value is replaced where it stands, a removed key goes with
its line, a removed table with its header, and a new key goes into the section that already
defines its table, or under a new `[header]` at the end. A value from the default home is
written the way the default home wrote it (a multi-line string stays multi-line); comments of
the default home are not copied. Only a changed array of tables is then set one element at a
time, and the result is checked to hold exactly the merged settings. A UTF-8 byte order mark at
the start of either file is ignored. A login's `config.toml` that is not valid TOML is left as
it is, because it may hold the login's own secrets.

The login's `config.toml` is written to a temporary file beside it, and the file is read again
just before the rename. When a Codex process changed it in the meantime, the merge is made
again from the new contents, up to three times in all (`CODEX_CONFIG_MERGE_ATTEMPTS`); after
that the file is left alone until the next start, and the record is not updated. The home is
created with mode 0700 and `config.toml` written with 0600, because it may hold the login's own
secrets.

**Hook and folder trust.** Codex keeps trust in the `config.toml` of the home it runs with:
`hooks.state."<hook key>"` (`trusted_hash`, `trusted_content_hash`, `enabled`) for a hook and
`projects."<folder>"` (`trust_level`) for a folder. A session on a login asks for trust and Codex
writes it into that login's file. A trust value that came from the default home follows it, so
trusting a folder again in `~/.codex` reaches the login. A trust value of the login's own (one
that differs from the last merged copy, or every trust value on the first merge without one)
stays when the default home drops it, and where the default home has a value for the same field,
`enabled = false` beats `true` and `"untrusted"` beats any other `trust_level`. For the hashes
the login's own stays: a hash trusts exactly the version of the hook that hashes to it, so
neither hash trusts more than the other, and taking the default home's would undo the login's
own approval on every refresh.

This differs from the original router, which drops trust the login's file widened, because a model in a
session could have written it. Kurmis has no window in which a person gives trust, and a model
that can write a login's `config.toml` could as well write `~/.codex/config.toml`, whose trust
reaches every login. One consequence: a folder the login itself marked untrusted, or a hook it
switched off, stays so after the default home trusts it. It has to be trusted again in a
session on that login.

**The Windows sandbox.** Codex's Windows sandbox (`codex-rs/windows-sandbox-rs`) keeps a setup
marker in `CODEX_HOME/.sandbox` that is valid only together with the sandbox users' passwords in
`.sandbox-secrets`, copies helper programs into `.sandbox-bin`, and its sandbox service refuses a
`CODEX_HOME` whose `.sandbox` folders are links. So every `.sandbox` folder stays private to
each login, and a link to one that an earlier kurmis made is removed.

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
  child to exit ("The wrapper" above).
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
still works. A PATH hit that resolves to kurmis' own bundle (a link to it, or a shim that starts
it) is skipped and named in the not-found message, because it is not the real program.

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

- `KURMIS_HOME` moves the data folder; every test sets it to a temporary folder. A relative one
  is taken from the current folder, and every start of a daemon passes it on as an absolute path
  ("Starting it from the CLI").
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

**Integration tests.** `test/integration/` runs the real bundle as `node <bundle> …` processes,
end to end, against the fake claude, codex and Anthropic API. `createWorld` in
`test/integration/harness.ts` gives each test its own temporary HOME, data folder, free port,
fake API, and fake Keychain, launchctl and registry folders. It builds the children's
environment from nothing, so only the fakes and the stand-ins of `test/setup.ts` can be reached.
After each test it stops every daemon the test's commands started.

## Known limits

These are known and left as they are.

- **One user per machine.** The daemon's port is fixed, and any local program that binds it
  before the daemon does receives what the CLIs send there: the key in `x-kurmis-key` and, in
  global mode, the CLI's own `Authorization` header. Kurmis assumes nobody else runs programs on
  the machine. The README says so.
- **A plain `claude` started inside a session on an extra login, in global mode.** The wrapper
  starts the CLI with `CLAUDE_SECURESTORAGE_CONFIG_DIR` naming the extra login's folder in the
  process environment, and a shell started from that session inherits it. A plain `claude` run
  from that shell takes its routing variables from `settings.json`, whose
  `ANTHROPIC_CUSTOM_HEADERS` has no `x-kurmis-started-on`, so the proxy counts it as started on
  `claude:default`. That CLI reads the extra login's credentials and sends that login's token in
  its `Authorization` header. When the proxy picks `claude:default` and has read no token for it,
  it forwards that header, so the request is billed to the extra login while kurmis counts it as
  `claude:default`. When the proxy has read `claude:default`'s token, which is the usual case,
  the request is signed and counted correctly. The wrapper cannot avoid this: any variable it
  could add to tell the nested CLI apart is overridden or never sent, because the `env` of
  `settings.json` beats the process environment and the proxy only sees headers. Use
  `kurmis claude` inside such a session instead.
- **A plain `claude` inside a `kurmis claude` session on `claude:default`, with
  `CLAUDE_CONFIG_DIR` set and global mode set up from it.** The session's
  `CLAUDE_SECURESTORAGE_CONFIG_DIR` is empty, and a shell started from it passes that on, so the
  plain `claude` signs in as `claude:default`. It reads `$CLAUDE_CONFIG_DIR/settings.json`, whose
  headers say `x-kurmis-started-on: none`, so the proxy does not use `claude:default` for it
  although it could. Its requests go to the extra logins, or get the 599 when there is none.
- **Version handover.** The new daemon reads `state.json` once, when it starts. While the old
  daemon finishes its open requests, the usage, cooldowns and session placements it records stay
  in its own memory, and the new daemon does not see them. Both daemons write the whole
  `state.json` in that time, so the file holds whichever wrote last; the old daemon writes once
  more as it stops, and a change the new one made before that is lost from the file (not from
  the new daemon's memory) until the new daemon writes again.
- **The Windows sandbox in elevated mode on several Codex logins.** Codex creates two sandbox
  user accounts per machine and stores their passwords in the home it runs with. Its setup in
  one home sets new passwords for the same accounts, so the passwords another login's home
  holds stop working, and Codex there runs its setup again (with a UAC prompt, or through its
  sandbox service when that is installed, which accepts only one home). Switching logins can
  so cost a setup each time. Kurmis does not change the sandbox mode of a login. Codex's
  unelevated sandbox mode (the `windows.sandbox` setting) uses no such accounts as far as its
  code shows; that has not been tested.
- **What counts as a usage limit.** A 429 counts as a usage-limit refusal when its
  `anthropic-ratelimit-unified-status` is `rejected` or it carries
  `anthropic-ratelimit-unified-representative-claim` or `anthropic-ratelimit-unified-overage-status`
  (`isDefinitiveQuotaRejection`, the original router's rule). Any other 429 is treated as no capacity. This
  has not been checked against a real usage-limit 429 from Anthropic yet.

## Code layout

- `src/data/` holds the data folder: its paths, login ids, the JSON file helpers, the stores for
  `config.json`, `state.json` and `daemon.json`, the lock file around `config.json` changes
  (`lock.ts`), and the log writer. Both the CLI and the daemon use it.
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
  - `codex-choice.ts`: which Codex login `kurmis codex` starts on.
  - `credentials.ts`, `keychain-service.ts`: the `.credentials.json` format and the Keychain
    item name.
- `src/daemon/` holds the proxy, the control API, the token readers (`credentials.ts` for the
  file, `keychain.ts` for the macOS Keychain), the usage probes and the daemon's lifecycle.
- `src/cli/` holds the commands and the wrapper. `main.ts` is the bundle's entry and
  `dispatch.ts` picks the command and handles `--help`, `--version` and `help <command>`.
  `wrapper.ts` runs an interactive child, `wrapper-args.ts` splits the wrappers' arguments,
  `settings-arg.ts` builds claude's `--settings`, `global-settings.ts` edits the user settings
  file for `setup`, `status-format.ts` renders `status`, `daemon-client.ts` reaches the daemon and
  `codex-home-files.ts` prepares a Codex home. Each
  command is one module in `src/cli/commands/` exporting a `Command`: its name, a one-line
  summary, its help text and `run(args, context)`, which returns the exit code (0 done, 1
  failed, 2 wrong command line, or the child's code for `claude` and `codex`). Each exports a
  `create<Name>Command(deps)` too, which takes fakes of what it reaches outside itself (the
  daemon client, the child runner, `findProgram`, `prepareCodexHome`; `command-deps.ts`), so
  unit tests run without a daemon or a real CLI. The commands are:
  - `claude` and `codex` (above).
  - `status [--json]`: starts the daemon when needed and shows its status. When no signed-in
    login has been read yet it asks for one probe and waits up to 15 seconds; then it ends the
    request and closes its connection, so the command exits at once while the daemon finishes
    the probe. `kurmis codex` does the same with its 5-second wait. The text shows
    per login the label, the email the daemon read from the login's own profile (on the
    terminal only), sign-in, routing, limits, use-first, sessions, each usage window with its
    reset, and why routing passes the login over (`routeBlockText`), and last which login
    `kurmis codex` would start on (`src/cli/status-format.ts`). Resets are shown as the time
    left; a cooldown's end is shown in local time (`02:10`, with the date when it is on another
    day) with the time left after it.
  - `list [--json]`: the logins from `config.json` without the daemon, with the columns `ID LABEL
    AUTO FIVE-HOUR WEEKLY USE-FIRST CREDENTIALS`. Credentials is a check of local files only: an
    extra Claude login's `.credentials.json` or a `.claude.json` naming an account in its folder,
    `~/.claude/.credentials.json` or `~/.claude.json` for `claude:default`, and the existence of
    `auth.json` for Codex (its fields are never read). `--json` prints the login settings with
    `credentials: boolean` added.
  - `login claude|codex [--name <name>] [--label <text>]` adds a new login; without `--name` it
    takes the first free name of `2`, `3`, ... (`claude:2`). `login <id> [--label <text>]` signs
    an existing login in again, the default ones included (and adds an id that is new). First
    it takes the login's lock (`locks/`, above) and reads `config.json` again under it; without
    `--name` a number whose lock another run holds is passed over, so two `kurmis login claude`
    at once get `claude:2` and `claude:3`. The lock is held until the command ends, so a failed
    run can never delete the folder of a run that signed in, and a logout cannot delete a
    folder a sign-in writes into. The
    login's folder is created next (mode 0700), and for Codex prepared with `prepareCodexHome`,
    so the sign-in reads the same merged `config.toml` as later sessions. Then `claude auth login
    --claudeai` runs with `claudeLoginEnv`, or `codex login` with `codexLoginEnv`, through the
    wrapper. The login counts as signed in when the CLI exits 0 and an account (`.claude.json`) or
    local credentials are there; otherwise a folder this run created is removed and nothing is
    added. The email is printed and never stored; the label defaults to the name. A running
    daemon is told to reload and asked to probe the login, waiting up to 15 seconds, because
    it may still hold the login as signed out from before and Auto would pass it over until
    its next poll; none is started for this.
  - `logout <id>`: refuses the default logins. It holds the login's lock while it runs, and
    stops at once when a `kurmis login` of the login holds it. It removes the login from `config.json`, tells a
    running daemon to reload (so it stops probing the login), runs `claude auth logout` or
    `codex logout` on it with a 30-second deadline (a failure is a warning, naming the Keychain
    item that may be left on macOS, and the removal goes on), and deletes the folder with
    `removeTreeSync` (`src/platform/remove-tree.ts`), which removes links and junctions inside it
    without following them.
  - `set <id> [--auto on|off] [--five-hour <1-100>] [--weekly <1-100>] [--use-first on|off]
    [--label <text>]`: needs at least one option, changes `config.json` under the lock, tells a
    running daemon to reload and prints the login's settings. `<id>` may be a bare name when only
    one login has it.
  - `setup [--undo]` (above).
  - `daemon start|stop|restart|status|run`, where `daemon run` runs the daemon in the foreground
    and is what `daemon start` launches in the background. `daemon status` exits 1 when no daemon
    runs.

  **`kurmis status --json`** prints its own shape, not the control API's answer, so it can stay
  stable while the daemon's usage snapshot changes. Times are ISO strings. `format` is raised
  only when a field is removed or changes meaning; fields may be added.

  ```json
  { "format": 1,
    "daemon": { "version": "0.1.0", "pid": 4242, "port": 28411, "startedAt": "<ISO>" },
    "logins": [ {
      "id": "claude:work", "provider": "claude", "label": "Work", "email": "<email or null>",
      "signedIn": true, "probing": false, "routing": true, "fiveHourLimit": 90, "weeklyLimit": 100,
      "useFirst": false,
      "usage": { "fetchedAt": "<ISO>", "source": "probe", "plan": "max", "error": null,
        "windows": [ { "key": "five_hour", "label": "5 hour", "durationMinutes": 300,
          "utilization": 42, "resetsAt": "<ISO or null>", "plan": true, "limitPercent": 90 } ] },
      "blocked": { "kind": "over-limit", "text": "<sentence>", "until": "<ISO or null>" },
      "sessions": 2 } ],
    "codexStart": { "login": "codex:default", "note": null } }
  ```

  `usage` and `blocked` may be null. A window whose reset has passed reads `utilization: 0`.
  `limitPercent` is null for a window that meters one model rather than the plan. The CLI's
  `get_usage` answer has the server's `seven_day_opus` and `seven_day_sonnet` windows and, in
  `model_scoped`, the per-model weekly windows from the server's `limits` list, so one model's
  window can come twice, as `seven_day_opus` and as `Opus`. An `Opus` or `Sonnet` entry with the
  same figure and reset as the fixed window is left out of `windows` and the text
  (`repeatsModelWindow` in `src/core/usage-rules.ts`); the daemon's snapshot keeps both.
  `blocked.text` gives a cooldown's end as an ISO time, as the daemon's log does. `sessions` is
  null for Codex logins, and `codexStart` is null without Codex logins. A Claude login's
  `blocked` comes from the daemon; a Codex login's is the Codex choice's rule.
- `src/version.ts` holds the version, which the build takes from `package.json`.
- `src/platform/` holds what differs per OS: finding programs and reading npm shims (`programs.ts`,
  `npm-shim.ts`), folder links (`links.ts`), deleting a folder without following its links
  (`remove-tree.ts`), detaching and WMI starts (`detach.ts`), launchd jobs (`launchd.ts`),
  autostart (`autostart.ts`, `windows-autostart.ts`), and the file rename retry and
  file modes (`files.ts`). Every short-lived program kurmis starts goes through `runProgram` in
  `run.ts`: no shell, stdin closed, a deadline and a cap on the output. The usage probes, whose
  stdin carries JSON frames, go through `startFrameProcess` in `frame-process.ts`: no shell, a
  deadline, a cap on each frame and on all output, and a kill that takes the program's child
  processes with it (its process group on macOS and Linux, `taskkill /T /F` on Windows).
- `test/` mirrors `src/`. `test/fakes/` holds stand-ins for `claude`, `codex app-server` and
  Anthropic's API. `test/daemon/fake-security/` stands in for macOS's `security` program, with
  its Keychain items in a temporary folder. No test reaches the network or the user's real
  `~/.claude`, `~/.codex` or Keychain.
