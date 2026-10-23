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

## The data folder

Everything kurmis keeps is in one folder: `~/.kurmis`, or `%USERPROFILE%\.kurmis` on Windows.
`KURMIS_HOME` moves it, and every test runs with it set to a temporary folder. The code is in
`src/data/`.

- `config.json` holds the daemon's port and the logins with their settings: id, whether it is
  the login plain claude uses (`usedByPlainClaude`), alias, whether the person set the alias,
  opt-in, the two limits and use-first. The CLI writes it. The daemon writes it only to give
  a login its automatic alias (see "Aliases" below), and reloads it when its contents change
  (`configStamp`, a hash of the file).
- `config.json.lock` exists while a command changes `config.json` (`changeConfig` in
  `src/data/config.ts`, `src/data/lock.ts`). It is created with exclusive create and holds
  `{pid, createdAt, token}`. Another command waits for it, up to 15 seconds, and then fails
  with a message naming the pid that holds it. A lock whose pid is dead, or that is older than
  10 seconds, is stale and is removed; `config.json.lock.break` exists for a moment while that
  happens, so two waiters never remove each other's new lock. A lock is released only by the
  process whose token it holds.
- `settings/` holds the settings files `kurmis claude` passes to claude with `--settings`
  (see "How a Claude CLI reaches the daemon"), mode 0600. One that holds only kurmis' variables
  is named after a hash of its contents and removed once no start has used it for 30 days. One
  that holds a copy of the person's own `--settings` is `run-<pid>-<random>.json`, deleted when
  that wrapper ends.
- `claude/<id>/` is the config folder of the extra login with that id. On Windows it
  holds the login's `.credentials.json`. On macOS the CLI keeps the secret in the Keychain,
  under a name derived from this folder's path (`keychainService` in
  `src/core/keychain-service.ts`). So a sign-in goes straight into this folder, and the folder
  is never renamed.
- `locks/<id>.lock` exists while a `kurmis login` or `kurmis logout` of that login runs
  (`src/cli/login-lock.ts`). It is the lock file of `src/data/lock.ts`, held for the whole
  command, because a sign-in can take minutes. A second run for the same login stops at once
  with a message naming the pid that holds it. A lock whose pid does not run, or that is older
  than 24 hours, is taken over.
- `probe/` holds the usage probes' folders: `probe/cwd`, the empty folder every probe runs in,
  and `probe/claude-own`, the `CLAUDE_CONFIG_DIR` of the probe of the login plain claude
  uses. The CLI caches that login's profile in `probe/claude-own/.claude.json`, which is where
  the daemon reads its account uuid and email.
- `daemon.json` holds the running daemon's pid, port, version and start time. The daemon writes
  it once it has its port and removes it as the last step of stopping, only while the file still
  names its own pid, so a replaced daemon never removes its successor's file. The file is renamed
  aside and checked again before it is deleted, so a file the successor writes between the
  check and the removal is kept (`removeDaemonFile` in `src/data/daemon-file.ts`). The CLI
  removes a `daemon.json` whose pid no longer exists, and one that is damaged.
- `autostart.js` is the script the Windows logon entry runs (see "Starting at login").
- `paused.json` exists while global routing is paused (`kurmis setup --pause`, see "Pausing and
  removing global routing"). It holds the time of the pause.
- `settings-files.json` lists the Claude Code settings files `kurmis setup` put kurmis' settings
  into: `{ "version": 1, "files": ["<absolute path>", …] }`. Setup adds a file before it writes
  it, under the lock `settings-files.json.lock` (`recordSettingsFile` in
  `src/cli/global-routing.ts`). `setup --pause`, `setup --uninstall-and-logout` and
  `kurmis status` look at each file it names besides the one of the current environment, so a
  setup run with `CLAUDE_CONFIG_DIR` set is found from a shell without it, and the other way
  round. A damaged file is reported; setup then writes one that names only its own file.
- `key` holds the secret every proxied and control request carries. It is created once and
  kept, because a running Claude CLI and, in global mode, `~/.claude/settings.json` hold a copy
  of it and must keep working after the daemon restarts. Only the user can read it. It is
  created in one step that fails when the file exists, so two processes that create it at the
  same moment get the same key.
- `state.json` holds the daemon's usage snapshots, cooldowns and which login each session is on,
  so a daemon restart keeps them.
- `daemon.log` is the daemon's log. It names logins by their id only. It never holds a token, a
  request body, an alias or an email. At 5 MB it is renamed to `daemon.log.1`, replacing the
  previous one.

**The login plain claude uses.** It is marked `usedByPlainClaude` in `config.json`: the account
a plain `claude` is signed in to. Plain `claude` means the CLI run without kurmis. The login
follows whatever that CLI is signed in to. It is always in the config, cannot be removed, and has
no folder here. It is the login in `~/.claude`: `~/.claude/.credentials.json` and the Keychain
item with the plain name, whatever `CLAUDE_CONFIG_DIR` says (see "Plain claude's login and
`CLAUDE_CONFIG_DIR`" below). A CLI on this login runs with the environment left as it was
inherited, apart from the routing variables and `CLAUDE_SECURESTORAGE_CONFIG_DIR`. Code tells
this login apart from the others by its `usedByPlainClaude` setting (`plainClaudeLogin` and
`extraLogins` in `src/data/config.ts`), never by its id.

**Login ids.** Every login, plain claude's included, has an id that never changes. A new id is
10 lowercase letters and digits from `node:crypto` (`newLoginId` in `src/data/login-id.ts`,
`newLoginIdFor` in `src/data/config.ts`). It is unique, and it is none of the logins' aliases, so
an id alone names one login. `kurmis login` also passes over an id that has a folder in
`claude/`. An id read from a file may be 1 to 32 lowercase letters and digits. It may not be a
Windows device name such as `con` or `nul`, `none` (the value of `x-kurmis-started-on` for no
kurmis login) or `invalid`. So an id is always a safe folder name and a safe value for the log,
and the path functions check it again.

**Aliases** (`src/core/login-alias.ts`). The alias is the name the person sees and types. Every
command takes a login by its alias or its id, without regard to case (`resolveLogin` in
`src/data/config.ts`). Aliases are unique.

- **An automatic alias** is made from the account's email (`aliasFromEmail`): the email without
  its top-level domain, in lowercase, every run of characters other than `a-z` and `0-9` turned
  into one `-`, without `-` at either end, cut to 32 characters. `work@example.com` gives
  `work-example`. When another login has it, or it is another login's id,
  the first free of `-2`, `-3`, ... is added (`automaticAlias`). A login keeps a numbered alias
  as long as it still fits the email and is free, so two logins of one account do not swap
  aliases. While no email is known, the alias is the id. A login keeps its last alias while its
  email cannot be read.
- **A user alias** comes from `--alias` on `kurmis login` or `kurmis set`, and `aliasSetByUser`
  is then true. It is 1 to 32 of `a-z`, `0-9`, `-` and `_`, starting with a letter or digit, not
  the alias of another login, and not another login's id. Kurmis never replaces
  it, and no command makes it automatic again.
- **Who sets the automatic alias** (`followEmail` in `src/data/config.ts`). `kurmis login` sets
  it right after the sign-in, from the email it reads. The daemon sets it after a usage probe
  that finds the login signed in and tells it the email from the profile the probe's CLI cached
  (`src/data/identity.ts`, `noteEmail` in `src/daemon/logins.ts`). The daemon writes
  `config.json` under the config lock and waits at most 500 ms for it (`CONFIG_LOCK_TIMEOUT_MS`),
  because the wait blocks its event loop. When it does not get the lock or the write fails, it
  logs `alias_write_failed` with the login's id and tries again after the next probe.

No email is stored in any file kurmis keeps. A login's email is read from its profile file when
it is needed (`src/data/identity.ts`). For plain claude's login that is the
probe folder's `.claude.json`. The shared `~/.claude.json` counts only before the first probe:
every claude that uses the default config folder writes its account there, so after a
`kurmis claude` on an extra login it names that login.

**Writing files.** Every JSON file is written to a temp file in the same folder, flushed to the
disk and renamed over the old one, so a reader sees the old file or the new one, never half of
each. On Windows a rename fails while another program has the file open, so it is retried for
about a second. On macOS and Linux the data folder is created with mode 0700, and `key`,
`daemon.json` and `daemon.log` with 0600. Windows ignores those modes; there the files are
protected by the access list they inherit from `%USERPROFILE%`, which only lets in the user,
SYSTEM and Administrators.

**Reading files.** `loadConfig` adds the login of plain claude, with a new id, when the config
has none, a missing `config.json` included, and saves the file under its lock, so every reader
sees the same id from then on. `kurmis status` reads it this way too, so it creates the data
folder when it is gone. `readConfig` reads the file without writing it, for the readers that
must change nothing: `findDaemon` and the part of `setup --pause` and `--uninstall-and-logout`
that reads before anything is removed. A `config.json` that is not JSON or has a wrong field is
an error that names the file and the field. So is one whose `version` is not 3; its message says
to delete the file and add the extra logins again with `kurmis login`. Two logins with the same
id, a second `usedByPlainClaude` login, two logins with the same alias, and an alias that is
another login's id are errors too. A damaged `state.json` never stops the daemon: an entry that
does not check out is dropped and the rest is kept, and a file that is not JSON reads as empty.

```json
// config.json
{
  "version": 3,
  "port": 28411,
  "logins": [
    { "id": "p8d2w5n1qe", "usedByPlainClaude": true, "alias": "p8d2w5n1qe",
      "aliasSetByUser": false, "routing": true, "fiveHourLimit": 100, "weeklyLimit": 100,
      "useFirst": false },
    { "id": "k3v9q2m7xa", "usedByPlainClaude": false, "alias": "work-example",
      "aliasSetByUser": false, "routing": true, "fiveHourLimit": 90, "weeklyLimit": 100,
      "useFirst": true },
    { "id": "s5j1f8y3ud", "usedByPlainClaude": false, "alias": "side",
      "aliasSetByUser": true, "routing": true, "fiveHourLimit": 100, "weeklyLimit": 100,
      "useFirst": false }
  ]
}

// state.json, keyed by login id; a cooldown of null means "until further notice" (Infinity in memory)
{
  "version": 1,
  "usage": { "k3v9q2m7xa": { "accountId": "k3v9q2m7xa", "...": "AccountUsage" } },
  "cooldowns": { "k3v9q2m7xa": 1768489200000, "p8d2w5n1qe": null },
  "sessions": { "0b7c0a52-1111-4222-8333-944445555666": { "login": "k3v9q2m7xa", "lastUsed": 1768478400000 } }
}

// daemon.json
{ "pid": 4242, "port": 28411, "version": "0.1.0+20261023120000", "startedAt": 1768478400000 }

// key: 64 hex characters on one line
```

In this example plain claude's login has no alias from an email yet, so its alias is
its id.

Session placements are dropped after 7 days without a request, and beyond the newest 2000. The
daemon saves `state.json` through `createCoalescedWriter`, which writes at most once per
interval however often the state changes, and once more when it stops. `kurmis status` reads
`state.json` while no daemon runs: each login's usage snapshot, whose `fetchedAt` it shows as
the age of the usage, and the session placements, which it counts per login.

## The daemon

One daemon per user. It serves the proxy and the control API on one `127.0.0.1` port. The port
is fixed so that `settings.json` can name it. It is `port` in `config.json`, 28411 when that is
not set, and a busy port is an error that says how to change it. 28411 is below the range every
OS hands out for outgoing connections (32768 and up on Linux, 49152 and up on macOS and Windows),
and no common tool uses it. A new daemon replaces a daemon of an older version at once, and the
old one finishes its open requests in the background ("Version handover" below).

- **What the daemon answers itself.** `HEAD` and `GET /api/hello` get a 200 without the key,
  because the CLI checks the base URL with it before its first request and without its custom
  headers. A path that is neither the control API nor one of the routed Anthropic paths
  (`ROUTE_PATHS` in `src/core/proxy-rules.ts`) is a 404. The code is `src/daemon/app.ts`.
- **The control API** is on paths under `/_kurmis/` (`src/daemon/control.ts`). It lets the CLI read
  status, ask for a usage probe, reload config and stop the daemon. The paths and their answers are
  in `src/core/control-api.ts`. Every request needs the secret from `key`, in the header
  `x-kurmis-key`; without it the answer is 403 with no body. `status` gives each login's id, alias
  and whether plain claude uses it (`usedByPlainClaude` in `LoginStatus`). It also gives each
  login's email from its profile file (`src/data/identity.ts`), for `kurmis status` on the
  person's own terminal. The email is never logged. A login also gets the organization uuid from
  its profile file (`organizationUuid`), which `kurmis status` and `kurmis login` compare along
  with the email to tell whether two logins are the same account. A request body may be at most
  64 KB (`MAX_CONTROL_BODY_BYTES`). A larger one is answered 413 with the control API's error
  answer (`{ "ok": false, "error": "…" }`) as soon as the size is known, from `content-length` or
  while reading. The daemon then goes on reading the rest of the body and throws it away, for at
  most 30 seconds, instead of closing the connection: a connection closed while the client is
  still sending is reset, and the reset can lose the answer before the client reads it.
- **The proxy** is every other routed path (`src/daemon/proxy.ts`). A request needs the header
  `x-kurmis-key: <secret>`, which reaches the CLI through `ANTHROPIC_CUSTOM_HEADERS`, else it gets
  403 with no body. Both other kurmis headers carry login ids, never aliases:
  - `x-kurmis-login: <id>` pins the request to that login. One that is not a login id, or not
    the id of a login in the config, is a 400.
  - `x-kurmis-started-on: <id>` names the login the CLI was started on, and
    `x-kurmis-started-on: none` says the CLI's credentials are no kurmis login's (below, "Plain
    claude's login and `CLAUDE_CONFIG_DIR`"). Only the format is checked: a value
    that is neither a login id nor `none` is a 400, and an id that is not a login in the
    config never matches a login the proxy signs for. A request without the header counts as
    started on plain claude's login.

  None of them is forwarded upstream. The body is read whole (at most 64 MB), because a request
  may have to be sent more than once. A body that is not JSON is a 400. Otherwise it goes upstream
  as the bytes that came, except for the account uuid in `metadata.user_id`, which is set to the
  chosen login's (`outgoingBody` in `src/core/proxy-rules.ts`): only that string is replaced in
  the text, so key order, white space and integers above 2^53 reach Anthropic as the CLI sent
  them. A larger body gets a 413 with an error in the shape of Anthropic's own
  (`request_too_large`), which the CLI does not retry. The proxy then goes on reading the rest of
  the body and throws it away, for at most 5 s after the answer (`TOO_LARGE_LINGER_MS`), and
  closes the connection, for the same reason as the control API above.
- **Choosing a login** follows the order in the header of `src/core/proxy-rules.ts`. Logins
  whose usage reading belongs to a window that has ended are probed first. Such a probe of a
  login is not started again within a minute of the last one (`STALE_PROBE_INTERVAL_MS` in
  `usage-poller.ts`), by any request, so a probe that keeps failing does not run before every
  request; meanwhile the stale reading counts as empty, as it does anyway. A login whose token
  is about to expire is chosen as if it were fresh. Its token is then read again, past the
  minute a Keychain answer is kept, since the CLI may have renewed it, and only a token that is
  still about to expire is renewed by a usage probe; on Auto, when another login could take the
  request, the request waits at most 5 s (`RENEWAL_WAIT_MS`) for that and then goes to the other
  login. The request takes the first login back once that renewal has ended. It goes back to it
  and waits for the renewal to end when no other login can take the request (they refused it,
  have no capacity, or cannot sign), and when the session is sent back to it after a 400. A
  login whose record has no refresh token is never renewed: it just becomes unusable when its
  token is about to expire.
- **Signing.** The proxy signs with `Bearer <token>` for the token it read for the chosen login.
  When the chosen login is the one the CLI was started on and no token was read for it, the
  CLI's own `authorization` header is forwarded instead. No other login is ever signed with the
  CLI's header. A request with `x-kurmis-started-on: none` is never signed with the CLI's header,
  and plain claude's login is left out of its pool, because the CLI is signed in to
  another account than that login's; when no other login can take it, the proxy's 599 says so.
  A 401 is handled this way:
  - A 401 on the CLI's own header goes to the CLI as it is: the CLI owns that token.
  - A 401 on a token the proxy read makes it read the token again. When the record has a
    refresh token, the proxy renews it once through a probe (the probe's CLI renews a refused
    token) and sends the request again on the same login. A record without a refresh token is
    not renewed.
  - When that login still answers 401, or could not be renewed, the 401 goes to the CLI only if
    the login is the one the CLI was started on (the CLI can sign it in again) or the session
    is pinned to it with `x-kurmis-login`. Otherwise the request goes on to the next login, and
    Auto treats the login as signed out (`markRefused` in `logins.ts`, in memory only) until a
    usage probe of it succeeds and finds it signed in, at the latest the next 15-minute poll, or
    until the token read for it is another one, as after it was signed in again from a terminal.
    Only a fingerprint of the refused token is kept for that, never the token.
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
  is back earlier than every one that refused. A login whose token is about to expire and could
  not be renewed is not back, whatever its usage. A pinned session gets its login's 429 as it is.
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
  the body of an answer that started within the hold is passed on to its end. They end the
  choice of a login too, while it waits for a usage probe, a token read or a renewal, and the
  renewal after a 401; a request whose hold ended meanwhile is given back and not sent.
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
  that appears in `config.json` when the daemon reads it again, by a `reload` or because a
  request found it changed (`onLoginsAdded` in `logins.ts`). One probe per login runs at a time;
  a second request waits for it. A failed probe keeps the previous windows and records the error
  on the snapshot. A probe that succeeds and finds the login signed in also gives the daemon the
  login's email, from which it sets an automatic alias ("Aliases", under "The data folder"). The
  daemon also updates usage from the rate-limit headers of every answer it forwards. A probe
  describes the login as it was when the probe started, so what an answer said after that wins:
  the rate-limit headers of the answers since the probe started, for each window the latest that
  reported it, are applied again on top of the probe's snapshot, and a cooldown or a refused
  token recorded after the probe started is not ended by it. The code is
  `src/daemon/usage-poller.ts`, with the probe in `claude-probe.ts`.
- **A usage probe** is `claude -p` in stream-json mode, sending `initialize` and `get_usage`,
  with `claudeProbeEnv`, `--setting-sources=` (no settings file, so no `env` block or hook of the
  person's reaches it), no MCP servers, no saved session, `DISABLE_AUTOUPDATER=1`, and the empty
  folder `probe/cwd` as its working folder. Each probe has 30 s from start to exit and is killed
  with its child processes after that, or when the daemon closes
  (`src/platform/frame-process.ts`). After its answer the probe closes the CLI's input and waits
  for it to exit, so a token the CLI renewed is on disk when the probe ends. The daemon finds
  `claude` on the PATH it was started with, so a CLI installed or put on PATH later is found
  only after a `kurmis daemon restart` from a shell that finds it; the error a probe records
  when the program is missing says that.
- **Tokens** (`src/daemon/tokens.ts`). On macOS the login's Keychain item comes first
  (`/usr/bin/security`, with stdin closed and a deadline), and its `.credentials.json` is read when
  the Keychain gives no token: the CLI falls back to the file when it cannot use the Keychain, for
  example in an ssh session. On Linux only the file is read. An extra login's file is in its
  folder; that of the login plain claude uses is `~/.claude/.credentials.json`. The file is read
  again when its size or modification time changes. A Keychain or Credential Manager answer is
  kept for a minute. After a refused token or a renewal, the Keychain and Credential Manager
  readers go on answering the old token until the new read lands, and the next request waits
  for that read; a read that started before is not used. Tokens are never written anywhere.
  Only whether a record has a refresh token is kept, never the refresh token itself.

  On Windows, Claude Code (seen in 2.1.150 and later) keeps the record in Credential Manager instead
  of the file when `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1` is set or the feature flag
  `tengu_windows_credman` is on in the CLI's config file: `.config.json` in the config folder
  the CLI runs with when that file is there and not empty, else `.claude.json` in
  `CLAUDE_CONFIG_DIR` or the home folder. Such a CLI reads Credential Manager first and the file
  only when Credential Manager has nothing, and deletes the file when it first writes the record
  to Credential Manager. The daemon reads in the same order (`src/daemon/credential-manager.ts`,
  `src/platform/windows-credentials.ts`):
  - *Which record.* It lists the generic credentials named `<Keychain item name>/<account>` and
    takes the account name Claude Code uses on macOS (the user's name), else
    `claude-code-user`, else the only one there is, since the Windows build's account name could
    not be checked. The blob is the same JSON as the file, or, when `…#m` holds
    `{"n":…,"l":…}`, the base64 slices `#0` to `#n-1` joined, as the CLI writes a record longer
    than 2400 bytes.
  - *Reading through PowerShell.* Node cannot call `CredEnumerateW`, so a PowerShell script
    declares it with `Add-Type` and prints each name and blob as base64. One run reads up to 247
    logins; more are split into runs that keep the command line within Windows' 32,767
    characters. That needs PowerShell's full language mode: under Constrained Language Mode
    `Add-Type` is refused, the read fails (logged once as `token_read_failed` for a login
    without the file, or whose record was found there), and only the file is used.
  - *Failures and waiting.* A failed read keeps the token and the found state from before, and
    is tried again after 1, 2, 4, 8, then every 15 minutes. A request waits for a Credential
    Manager read only for a login that was not read yet, or not since its token was refused or
    renewed, and only when the login has no file or its record was found there. Any other login
    is answered from the file meanwhile. An old Credential Manager answer, and one after a usage
    probe, is read again in the background while it goes on being used, since starting
    PowerShell takes a second or two.
  - *Logins that use the file.* A login whose file exists and for which Credential Manager had
    no record is looked up there again only every 15 minutes, or after its token was refused or
    renewed, so a machine whose logins all use the file runs PowerShell every 15 minutes, not
    every minute. A record can still appear while the file is there, when the CLI could not
    delete the file after moving the record, or when a CLI with the flag off wrote the file
    after a record was made.
  - *Probes.* A usage probe of a login whose last read that worked found its record in
    Credential Manager runs with `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1` (`probeEnvironment`). The
    probe's config folder is not the one a routed CLI runs with, so its feature flag may be off,
    and then it would not see the record and would report the login signed out.
- **Config reload.** The daemon reads `config.json` again on the control API's `reload`, and when
  a request finds its contents changed (`configStamp`, checked at most every 2 s). A file that
  does not read leaves the config the daemon has. A file that could not be read because another
  process held its lock for more than 500 ms is read again at the next check, even when its
  contents stay the same. A login the new config has and the old one did not is probed at once.
  A login the new config no longer has is dropped with its usage, cooldown, sign-in state and
  refused token, and a probe or an answer of it that ends after the reload records nothing.
  Until a config has been read, the daemon uses a stand-in with the login of plain claude under
  a new random id, which it never saves.

### Starting and stopping

The code is `src/daemon/main.ts` (the process), `src/daemon/lifecycle.ts` (what the CLI and the
daemon both need: a keyed control request, who holds a port, version comparison),
`src/cli/daemon-client.ts` (finding, starting and stopping it from the CLI) and
`src/platform/detach.ts`, `launchd.ts`, `autostart.ts`, `windows-autostart.ts`.

**`kurmis daemon run`** reads or creates `key`, reads `port` from `config.json` and opens
`daemon.log`. Then it listens on `127.0.0.1:<port>`. The port is the lock that keeps one daemon
per user. When the port is busy, the daemon asks the holder for its status with the key:

- an older kurmis daemon is replaced (below): one of a lower version or an earlier build, or of
  the same build whose control API version (`apiVersion` in its status answer) is lower or missing
  (`daemonAge` and `shouldReplaceDaemon` in `src/daemon/lifecycle.ts`);
- any other kurmis daemon (the same version and control API version, a newer version, the same
  version with a higher control API version, or a version that cannot be compared, such as
  `dev`, which code run from the source tree reports) keeps the port, and the new process
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
   `connection: close`, so a CLI's next request opens a connection to whatever holds the port next;
3. waits for its open proxied requests, for at most 15 minutes. A Claude CLI waits at most
   `API_TIMEOUT_MS` (600 s by default) for the headers of an answer; that a streamed answer
   that has started ends within the rest of the 15 minutes is an assumption. A second stop
   signal ends the wait. A control `stop` with a body `{ "maxWaitMs": <n> }` ends it after n
   milliseconds instead (`kurmis daemon stop` sends its own 30-second deadline this way); a
   `stop` without a body waits the whole 15 minutes;
4. closes the client connections of the requests still open, when the wait ended before they
   finished or a `stop` named a wait of 0, so their clients see a dropped connection. Then it
   kills the usage probes that still run and waits for their processes to exit, writes
   `state.json`, closes the remaining connections, removes `daemon.json` and exits 0.

An uncaught error is logged by its error code only, and the daemon stops without waiting for its
requests and exits 1. The next `kurmis claude` starts a new one.

**Version handover.** A CLI that finds an older daemon (a lower version or an earlier build, or
the same build with a lower control API version) starts a new daemon, and the new daemon does
the handover: it sends the old one a control `stop` and tries the bind every 100 ms for up to 10 seconds. While
the old daemon closes, its port may answer the status request with nothing or with an error;
once the stop is sent that counts as the old daemon going away, not as another program, and the
bind is tried again. The old daemon frees the port as soon as it has answered, and finishes its
open requests in the background while the new one serves. A routed Claude CLI retries a request
that finds no daemon (`CLAUDE_CODE_MAX_RETRIES=15`), which covers the moment in between.

Versions are compared numerically (`0.10.0` is newer than `0.9.1`). `scripts/build.mjs` adds the
build time to the version in `package.json` (`0.1.0+20261023120000`), and of two builds of one
version the later is newer, so an update replaces the daemon although the version number stays
the same (`compareVersions` in `src/daemon/lifecycle.ts`). An older kurmis never replaces a
newer daemon, so two builds of one version with different control API versions do not keep
replacing each other: the one with the higher control API version stays.

A daemon on another port than `config.json` names (the port was changed while it ran) is not
reached by the new daemon's bind, so the CLI asks it to stop with a control `stop` before it
starts the new one, and the old daemon finishes its open requests in the background as above. A
`stop` that fails or is refused (anything but a 200, or the port already closed) is an error,
and no new daemon is started, so two daemons never run on two ports. The CLI does this only when
the running daemon is not newer than itself. When the daemon is newer, or the two versions
cannot be compared and differ, the CLI stops with an error that says to update kurmis or to stop
the daemon with `kurmis daemon stop`.

**A newer daemon.** A newer daemon (a higher version, or the same version with a higher control
API version) is kept. When its control API version is the CLI's own, the CLI uses it
(`canUseDaemon`). Otherwise the CLI cannot read its answers: `startDaemon` and `ensureDaemon`
throw a `DaemonNotUsableError` whose message (`unusableDaemonText` in
`src/cli/daemon-client.ts`) says that a newer daemon runs, gives both versions, and says to
update this kurmis or to stop the daemon with `kurmis daemon stop` and run the command again. A
daemon whose version cannot be compared and whose control API version is another is treated the
same way. `kurmis claude`, `kurmis setup` and `kurmis daemon start` then fail with that message, and
`kurmis daemon restart` refuses to replace a newer daemon. `kurmis status` and
`kurmis daemon status` say that the daemon is newer and, when it cannot be used, what to do.

**Finding it.** The CLI reads `daemon.json` and counts the daemon as running only when it
answers a status request with the key, within 10 seconds, since a busy daemon on a loaded
machine can take seconds to answer. A `daemon.json` whose pid exists but that does not answer
is left alone, since that daemon may be finishing its requests before it stops. A start that
finds such a daemon holding the configured port says so (naming its pid), rather than calling
the port taken by another program, and `kurmis daemon stop` says it did not ask it to stop. When
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

**Starting it from the CLI** (`ensureDaemon`, `kurmis daemon start`): `kurmis claude`,
`kurmis setup` and `kurmis daemon start` and `restart` start the daemon. `kurmis status`,
`login`, `logout` and `set` only look for a running one (`findDaemon`) and never start it.
When none answers, the CLI starts `<node> <bundle> daemon run` and waits up to 15 seconds for a
daemon of its version or a newer one to answer. The bundle is the one running now, with
symlinks resolved. The daemon does not inherit `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS` or `CLAUDE_SECURESTORAGE_CONFIG_DIR`, which a
CLI started inside a routed session has. It runs in the home folder, so it holds no project
folder open, and so `KURMIS_HOME` is made absolute (from the CLI's current folder) in every
environment the CLI hands to a daemon: a direct start, the launchd login item and the Windows
logon script.

The daemon is started detached, the same way on every platform and from every kind of session
(`spawnDetached` in `src/platform/detach.ts`). On macOS and Linux `detached: true` puts it in a
new session, so the terminal's hangup does not reach it, and its standard streams go to
`/dev/null`; the daemon writes its own log. On Windows `detached: true` gives it no console and
a process group of its own, and `windowsHide` keeps any window hidden. What this means for a
start from ssh is under "Known limits".

**Stopping it from the CLI** (`kurmis daemon stop`) sends the control `stop` with
`{ "maxWaitMs": 30000 }` and waits up to 30 seconds for the pid to exit. A second control
request cannot be sent instead: a daemon that has answered `stop` no longer listens on its
port, and another daemon may hold the port by then. So the deadline goes with the first
request, and the daemon ends its wait for its open requests by itself when it is over, writes
`state.json` and exits. What happens when the pid is still there after the 30 seconds depends
on the platform:

- **macOS and Linux:** the CLI sends SIGTERM, which, as the second stop signal, ends the
  daemon's wait, and waits 5 more seconds.
- **Windows:** `process.kill` ends the process at once there (TerminateProcess), without
  `state.json` being written or `daemon.json` removed. So the CLI first waits 25 seconds more,
  for a daemon that ended its wait by itself to finish step 4 above, which takes at most 20
  seconds, and only then ends the process and waits 5 more seconds.

When the signal is refused with EPERM (a daemon of another user, or on Windows one started as
administrator while this command is not), the stop is an error that names the pid and says to
end it from there; only ESRCH (no such process) counts as stopped.

`kurmis daemon stop --now` sends `{ "maxWaitMs": 0 }`, so the daemon skips step 3 and closes the
client connections of its open requests before anything else in step 4. A Claude CLI whose
request was cut sees a dropped connection, not an answer from the proxy, and retries it. The
log line `drain_cut_short` then has `reason=stop_now`. The CLI waits up to 25 seconds for the
pid to exit and then signals it as above, on Windows without the extra wait. A daemon may take
20 seconds for step 4: up to 10 seconds for its request handling to finish starting, and up to
10 seconds for the probes and `state.json` (`STOP_FINISH_MAX_MS` in `src/daemon/lifecycle.ts`).

Only a pid that answered the keyed status request as the daemon's own is ever signalled.
`kurmis daemon restart` sends `stop` without a body, waits until the port is free, and starts a
new daemon at once, so the old one finishes its requests in the background. It refuses to
replace a daemon of a newer version.

### Starting at login

`kurmis setup` registers `<node> <bundle> daemon start` to run when the user logs in, and
`setup --uninstall-and-logout` removes it. That command starts the daemon detached and exits, so
removing the entry never ends a running daemon. Both are idempotent: what is already there is
compared first. The Node is the first `node` on PATH when it is the same file as the running one,
since `process.execPath` names a versioned folder that a Homebrew upgrade removes. A `node` on
PATH in a temporary folder (`os.tmpdir()`, `TMPDIR`, `TEMP`, `TMP`, `/tmp`, `/var/folders`) or
in fnm's per-shell `fnm_multishells` folder, which fnm deletes later, is passed over. On
Windows `process.execPath` is the path Node was started by, without its links resolved, which
under fnm is in `fnm_multishells`; then the resolved path is used when it is not in such a
folder. Setup warns when the Node it registers is still in such a folder, and still exits 0
(`nodeForJobs`, `isTemporaryPath` in `src/platform/detach.ts`).

- **macOS:** `~/Library/LaunchAgents/kurmis.daemon.plist` (`daemonJobPlist` in
  `src/platform/launchd.ts`, mode 0644; it holds no secret). It has `RunAtLoad` and
  `AbandonProcessGroup`, no `KeepAlive`, and output to `/dev/null`. Its environment is only
  `HOME`, the caller's `PATH` (so the daemon finds `claude`), `KURMIS_HOME` as an
  absolute path, and the program variables and test hooks when they are set; never an
  `ANTHROPIC_*`, `SSH_*` or `CLAUDE_*` variable. A process launchd starts from it runs in the
  user's GUI session, which can read the login Keychain. It is written only when its content
  differs, then loaded with `launchctl bootstrap`, which also runs
  it once; one loaded with old content is unloaded first, since launchd keeps what it read at
  load time. The GUI domain exists only while the user is logged in at the screen (or through
  Screen Sharing). When loading fails (nobody at the screen), the plist stays and a warning says
  it starts at the next login. Removing it runs `bootout`, ignoring "not loaded", and deletes
  the plist. launchd may fail to start the job (exit 78, EX_CONFIG) when Node, the bundle or the
  data folder is on an external volume that a launchd job may not read; then no daemon starts at
  login, and the next `kurmis claude` starts one.
- **Windows:** the `REG_SZ` value `kurmis` under
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, set, read and removed with `reg.exe`
  through `runProgram` (no shell). It needs no admin rights and shows in Task Manager's Startup
  tab. Its data, with full paths, is:
  `<SystemRoot>\System32\wscript.exe //B //Nologo //E:JScript "<data folder>\autostart.js"`.
  node.exe is a console program and would flash a console window at logon, so the script, JScript in
  UTF-16 with a byte order mark, sets the start folder and starts node hidden without waiting
  (`shell.Run("<command line>", 0, false)`). The kurmis variables (`KURMIS_HOME` as an absolute
  path, and the test hooks that are set) go on that command line as
  `daemon start --env NAME=VALUE …`, which `daemon start` puts into its own environment and the
  daemon's before it reads any file. `--env` takes only those names. `//B` stops error dialogs at
  logon.
  - *A `%` in the command line.* `shell.Run` replaces `%NAME%` in its command line with the
    variable NAME (ExpandEnvironmentStrings, which has no escape), so a path or value with a `%`
    could change at logon. When the command line has one, the script sets the process variable
    `KURMIS_PERCENT_SIGN` to `%` (`shell.Environment("Process")`), writes each `%` as
    `%KURMIS_PERCENT_SIGN%`, and runs the command only when `shell.ExpandEnvironmentStrings`
    gives back the command line as it was; otherwise it starts nothing and the next
    `kurmis claude` starts the daemon. A command line without `%` is run as it is. The daemon
    inherits `KURMIS_PERCENT_SIGN`, which nothing reads.
  - *A `%` in the Run value.* The Run value names `wscript.exe` and `autostart.js` by their full
    paths, and a REG_SZ value has no escape for `%`. Whether Explorer replaces `%NAME%` in a
    REG_SZ Run value is not verified. So when the value has a `%` (the data folder's path has
    one), setup still writes it, warns that the start at login may not work with that path, and
    says to use a data folder whose path has no `%` (set with `KURMIS_HOME`), and exits 0
    (`percentWarning`). A `%` only in the script's own command line (Node, the bundle,
    `KURMIS_HOME`) is handled by the script, so it gets no warning.
  - *Why JScript.* Microsoft has deprecated VBScript: since Windows 11 24H2 it is an optional
    feature, to be turned off by default and later removed. JScript runs in the same Windows
    Script Host and is not part of that deprecation, so the start stays hidden and needs no
    admin rights. A shortcut in the Startup folder needs COM to write and still shows node's
    console (minimized at best). A Task Scheduler logon task may need elevation to create,
    depending on policy, and shows a console unless it runs whether the user is logged on or
    not, which needs a stored password or elevation.
  - *When Windows Script Host cannot run it.* Setup checks that `wscript.exe` exists and that
    `Enabled` is not 0 under `Software\Microsoft\Windows Script Host\Settings` (HKCU and HKLM).
    Otherwise it writes no entry and warns, and setup exits 0; the next `kurmis claude` starts
    the daemon anyway.
  - *Comparing the value.* reg.exe prints in the console's OEM code page, which Node reads as
    UTF-8, so a value with letters outside ASCII does not read back as written: such a letter
    can come out as a replacement character, as a best-fit ASCII letter (`ā` as `a`), as `?`,
    or in a double-byte code page as two characters, the second of which can be ASCII. The
    comparison lets each run of letters outside ASCII in the value setup writes match any run of
    1 to twice as many characters in what was read, and the ASCII parts must be the same
    (`sameRunData`); a value that still looks different is written again.
- **Other platforms:** a warning (setup still exits 0); the next `kurmis claude` starts the
  daemon.

## How a Claude CLI reaches the daemon

`kurmis claude …` starts `claude` with:

- `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`;
- `ANTHROPIC_CUSTOM_HEADERS` carrying the key, and the login when one was named;
- `ENABLE_TOOL_SEARCH=true`, because the CLI turns tool search off for any base URL that is not
  Anthropic's, and the proxy passes it through;
- `CLAUDE_CODE_MAX_RETRIES=15`, so a request outlasts a daemon restart. Neither of these two is
  set when the person already gives either a value that is not empty, in their `--settings`, the
  user settings file or the environment. Routing works without them, so the person's value
  stays, as `kurmis setup` keeps it in `settings.json`;
- `CLAUDE_SECURESTORAGE_CONFIG_DIR` naming the folder of the login it starts on, or set to the
  empty string on plain claude's login, which the CLI reads as the default credentials, so that
  also a CLI with `CLAUDE_CONFIG_DIR` set signs in as that login;
- `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` removed, because a key would sign the requests
  itself and no subscription would be billed;
- `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` removed. A CLI with a
  token of its own sends that token instead of the credentials of the login it was started on.
  The proxy forwards the started-on login's header when it has read no token for that login, so
  the request would be billed to whatever account the token belongs to.

A value of the two token variables in the `env` of a settings file would beat the process
environment, so the wrapper's `--settings` (below) sets both to the empty string. Claude Code
2.1.306 reads that as unset: it tests `CLAUDE_CODE_OAUTH_TOKEN` for a value that is not empty
wherever it reads it, and takes the same path for an empty
`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` as for an unset one (read from its bundled source).
The wrapper prints one line on stderr for each place that set either to a value that is not
empty: the environment, the user settings file, the person's `--settings` (`settingsEnv` in
`src/cli/settings-arg.ts`).

Claude Code puts the `env` of its settings into its own environment, so a shell in a routed
session has both token variables set to the empty string, and a `kurmis claude` run there says
nothing about them.

**Kurmis' options go before `claude`, claude's after it.** `kurmis [--login <login>] claude …`
passes everything after the word `claude` on, `--help` included, unchanged except for a
`--settings` of the person's, which is merged with kurmis' own (below). A separator such as
`--` would not work: PowerShell drops `--` when it runs npm's `kurmis.ps1`. `--login` takes an
alias or an id, and `dispatch.ts` refuses it before any other command.

**The login the CLI starts on** (`src/cli/commands/claude.ts`). The wrapper starts the daemon
when it is not running and reads its status. With `--login`, the CLI starts on that login, which
must be a login in `config.json` and, unless it is the login plain claude uses, must have its
folder. On Auto, `autoStartLogin` picks the login: plain claude's login while it is signed in,
otherwise a signed-in login of the pool, with a note on stderr. The CLI needs credentials of
its own only to send at all: a CLI that finds none answers "Not logged in" before it sends
anything.

The daemon's status says whether a login is signed in once it has read a token for it or a
probe has answered. Right after the daemon starts, it may have neither for plain claude's
login. Then the wrapper first asks the daemon to probe the logins whose state is unknown and
waits for the answer, at most 15 seconds (`START_PROBE_WAIT_MS`, `withFirstProbe`); the probes
the daemon started on its own are already running, so this waits for them. When the wait ends
without an answer, an unknown state counts as signed in for plain claude's login, and only for
it, with a note on stderr.

The proxy signs each request with the stored token of the login it picks. Only when that is the
login the CLI was started on and no token could be read for it does the proxy forward the CLI's
own `Authorization` header ("Signing" under "The daemon"). The wrapper sends
`x-kurmis-started-on` with that login's id, and with `--login` also `x-kurmis-login` with the
same id. When the daemon cannot be reached, the wrapper does not start claude unrouted; it
fails with a message naming `kurmis daemon start` and the log.

When `config.json` cannot be read (it is damaged, or its lock stays busy), `--login` is an
error, since the login cannot be looked up. Without `--login` the wrapper prints the reason
and starts claude on the login plain claude uses. It takes that login's id from the daemon's
status, and sends no `x-kurmis-started-on` when the status names none, which the daemon reads
as the same login.
A daemon that runs is used as it is, because the port it belongs on is in the config. When
none runs, `ensureDaemon` reads the config again, and the start fails when it still cannot.

**The `env` of `settings.json` beats the process environment, and the `--settings` flag beats
`settings.json`.** Measured with Claude Code 2.1.301 against two local servers. In global mode
a variable the wrapper puts in the process environment is therefore ignored, so the wrapper
also passes its routing variables (`ROUTING_VARIABLES`: the base URL, the custom headers,
`ENABLE_TOOL_SEARCH` and `CLAUDE_CODE_MAX_RETRIES`) in a `--settings` argument
(`src/cli/settings-arg.ts`). `CLAUDE_SECURESTORAGE_CONFIG_DIR` stays in the process environment
only.

How Claude Code 2.1.301 reads `--settings`, from its bundled source: before it parses the
command line it scans the arguments up to the first `--` and loads only the last `--settings
<value>` or `--settings=<value>`. Its parser reads root options only before a subcommand, so
`--settings` must come before one (`claude --settings X mcp list`). A value whose
trimmed text starts with `{` and ends with `}` is inline JSON; anything else is a file path
relative to the folder claude starts in.

So the wrapper passes exactly one `--settings`, first, ahead of the person's arguments:

- When the person's arguments carry `--settings` before a `--`, the last one is read
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
the IDE extensions are routed too. The values are those of an Auto CLI with no started-on header,
so a plain `claude` runs on plain claude's login, except in a
`$CLAUDE_CONFIG_DIR/settings.json` whose CLIs have credentials of their own (below). It also
registers the daemon to start at login (a launchd agent on macOS, a logon entry on Windows) and
starts the daemon.

The daemon is started first. Once the file names the daemon, every Claude Code that reads the
file sends its requests there, so the file is written only after a daemon answers on the port
`config.json` names, with the key that daemon accepted. Setup checks first that it could edit
the file, so a file it would refuse starts no daemon. Autostart is registered last.

- The file is `$CLAUDE_CONFIG_DIR/settings.json` when that variable is set and not empty, as the
  CLI reads it, else `~/.claude/settings.json`; the path used is printed. A `CLAUDE_CONFIG_DIR`
  inside kurmis' data folder is refused. Before the daemon is started, the path is added to
  `settings-files.json`; when that cannot be written, setup stops and changes nothing.
- The file is edited as text: only the members of `env` change, and key order, indent, line
  endings and a byte order mark stay as they were. A file that is not plain JSON (comments,
  trailing commas), or whose top level or `env` is not an object, is refused and not written.
  The message names the line and column where it stops being JSON and never quotes the file,
  since it may hold a secret (`src/cli/json-error.ts`); the same goes for a `--settings` file of
  the wrapper's and the user settings file it reads for custom headers.
  A symlinked file is written through the link: the link stays, its target gets the change, and
  setup warns that the key is written to that target and names it. A link whose target does
  not exist yet gets that target created, so the link is not replaced by a plain file.
- On Windows a read-only file (its read-only attribute set) is refused with the `attrib -R "<path>"`
  command that clears it, because a rename over a read-only file fails there. A write that fails
  because another program holds the file open is reported as a sentence, not a stack.
- When setup changes an existing file that holds none of kurmis' settings, it first copies it
  to `settings.json.kurmis-backup` (mode 0600), replacing an older backup, so the backup is the
  file as it was just before kurmis' settings went in. When the file already holds kurmis'
  settings (setup run again after the port or the key changed), the backup is left as it is.
- The file holds the key after setup, so setup makes it readable by the user only: a new file
  gets mode 0600, and an existing one has its group and other bits cleared (0644 becomes 0600),
  also when setup finds kurmis' settings already there and writes nothing. An existing backup
  has its group and other bits cleared too. Setup says when it changed a mode. Taking the
  settings out keeps the mode the file has. On Windows node ignores modes, so nothing is changed
  there; the file is protected by the access list it inherits from its folder
  (`PRIVATE_FILE_MODE` in `src/platform/files.ts`).
- An `ANTHROPIC_BASE_URL` that is not kurmis' (`http://127.0.0.1:<port>` with the port of
  `config.json`, or with an `x-kurmis-key` in the same `env`'s headers) is refused, so another
  proxy is not cut off silently. A value of the person's own for `ENABLE_TOOL_SEARCH` or
  `CLAUDE_CODE_MAX_RETRIES` is kept, and setup says so. Their own header lines are kept exactly
  as written, ahead of kurmis' lines. An `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_OAUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` in the same `env` is
  kept, with a warning when its value is not empty (`KEY_VARIABLES` in
  `src/cli/global-settings.ts`). A plain `claude` then sends that key or token in place of its
  login's credentials. The proxy always replaces an `x-api-key`, but it forwards the CLI's own
  `authorization` header when it has read no token for the login the CLI was started on
  ("Signing" under "The daemon").
- When the daemon cannot be started, or runs on another port than `config.json` names, the
  settings file is not written and setup exits 1. When autostart then fails, the settings change
  stands and setup exits 1; running it again is safe. A launchd agent that is written but can be
  loaded only at the next login, a Windows machine where no logon entry can be written because
  Windows Script Host is missing or turned off (`noEntryPossible` in
  `src/platform/autostart.ts`), an entry that starts a Node in a temporary folder
  (`warningOnly`), and a platform without autostart (Linux) are warnings with exit 0: the daemon
  runs now, and after a restart the next `kurmis claude` starts it. When the daemon cannot be
  started and the file already holds kurmis' settings from an earlier setup, setup says so
  rather than that Claude Code does not use kurmis yet.

Taking kurmis' settings out (`undoSettingsFile`, which `--pause` and `--uninstall-and-logout`
run) removes only the values that are still kurmis': a key the person changed is left and
reported, and only the `x-kurmis-*` lines are taken out of the custom headers.
`ENABLE_TOOL_SEARCH` and `CLAUDE_CODE_MAX_RETRIES` are taken out only when the same `env` still
has kurmis' `ANTHROPIC_BASE_URL` or an `x-kurmis-*` header line, since setup keeps a value the
person set for them. When the header lines left are the ones the backup has, the backup's value
comes back as it was (with its line endings and blank lines); otherwise the lines left are
joined by newlines. A value the backup already had (read with or without a byte order mark) is
left. An `env` that this empties is removed, unless
the backup shows the file had an `env` before kurmis. The file keeps its mode. Putting the
settings in and taking them out can each be run again without changing anything more. Claude
Code sessions that are already open keep the settings they started with, so every command that
changes the file says to start them again.

**Pausing and removing global routing.** `src/cli/global-routing.ts` answers whether global
routing is on, paused or off from the files alone, without the daemon (`globalRoutingState`):

- **on:** the settings file setup edits, for the environment it is asked with, or a file
  `settings-files.json` names, sets kurmis' `ANTHROPIC_BASE_URL` (`routesThroughKurmis` in
  `src/cli/global-settings.ts`);
- **paused:** none does, and `paused.json` is in the data folder;
- **off:** neither.

It reads `config.json` with `readConfig` and writes nothing.

The start at login is not part of the answer, because Linux has none and a pause leaves it in
place. A settings file that is missing or not JSON counts as not on, and so does a
`CLAUDE_CONFIG_DIR` inside the data folder, for which the default file is read instead.

`kurmis setup --pause` takes kurmis' settings out of the file of the current environment and of
every file `settings-files.json` names, and writes `paused.json`. It reports the file of the
current environment, and another file only when it changed. The daemon, its start at login, the
logins and the backups stay, so `kurmis claude` keeps working. A pause when no file holds
kurmis' settings and nothing is paused writes nothing and says global routing is not on. When a
file cannot be changed, the others are still changed, no `paused.json` is written and the pause
exits 1. When `paused.json` cannot be written after a file was changed, the pause says so and
exits 1. A file system error (EACCES, EISDIR, …) that setup did not expect is reported as a
sentence with its code, and the command exits 1. `kurmis setup` deletes `paused.json` once the
settings are back in the file. That setup finds a file without kurmis' settings, so it replaces
the backup with the file as it is then, which includes what the person changed while routing was
paused.

`kurmis setup --uninstall-and-logout` first lists what it will remove: kurmis' settings in each
settings file that has them (the current environment's and those `settings-files.json` names),
their backups, the start at login (on macOS when the plist is there, on Windows always), the
logins kurmis added (when there are any), the other entries of the data folder's `claude/`
folder, which are deleted without a logout, the running daemon and the data folder. It says that
the login of plain claude is not signed out. At a terminal it then asks, and anything but `y` or
`yes` removes nothing. `--yes` skips the question. Without a terminal on
stdin and without `--yes` it refuses. A `config.json` it cannot read, or a settings file it
cannot read or change, stops it before the list, with nothing removed. Up to there it writes
nothing. Then, in this order:

1. Kurmis' settings come out of each settings file, and the backups are deleted. When a file
   cannot be written, nothing else is removed, since the Claude Code that reads it still needs
   the daemon.
2. The start at login is removed (`unregisterAutostart`). On Windows the Run value is removed
   first, and `autostart.js` is deleted only once it is gone. When
   `reg query` of the value fails, `reg query` of the whole Run key tells a missing value (the
   key lists its values without kurmis') from one that cannot be read. When the value cannot be
   read or `reg delete` fails, the script is kept, since a Run value that names a missing
   script makes wscript show an error at every logon.
3. The daemon is stopped as `kurmis daemon stop` stops it, so it uses no login and probes none
   while they are signed out.
4. Each login kurmis added is removed through the code of `kurmis logout` (`createLoginLogout` in
   `src/cli/commands/logout.ts`), with `keepWhenSignOutFails`. The logins are the extra ones in
   `config.json` and every folder under `claude/` whose name is a login id, so a second run
   finds a folder a removal that stopped half-way left. A folder named by the id of the login
   plain claude uses is left out, and that login is never signed out. Here the logout CLI runs
   before the login is taken out of `config.json`. When it fails, nothing of that login is
   removed: it stays in `config.json` and its folder stays, since the
   folder's path names the Keychain item and Credential Manager record that a second run's
   logout CLI removes. That holds for a login without a folder too. The message names the
   way out when the logout CLI can never finish (for example, the CLI is not installed):
   `kurmis logout <id>`, which removes the login and its folder anyway and may leave the item it
   names. Messages of this step start with `kurmis setup:`.
5. The data folder is deleted (`removeDataFolder` in `src/data/remove-data-folder.ts`). Only the
   names kurmis gives its files and folders are deleted, with their temporary, lock and rotated
   forms, each with everything in it and each through `removeTreeSync`, so a link or junction
   inside is removed and its target is left. On Windows `removeTreeSync` gets the data folder's
   real path as the folder it must stay inside, so an entry that is a mount point is removed as
   a link, the entries at the top included. When the folder then holds anything else, it is left
   and the names are printed. `.DS_Store`, `Thumbs.db` and `desktop.ini` are deleted when
   nothing else is left, and are not printed. A data folder that is itself a link is emptied
   through it, the folder it points to is removed, and then the link.

A failed step is reported and the later steps still run, except that the data folder is kept
when the start at login could not be removed, the daemon could not be stopped or a login could
not be removed. The command then exits 1 and says to run it again. When every step worked, its
last line says to run `npm uninstall -g kurmis`.

**Plain claude's login and `CLAUDE_CONFIG_DIR`.** Plain claude's login is
the login in `~/.claude`: the daemon reads its token from the Keychain item with the plain name
or from `~/.claude/.credentials.json`, its probe runs with `CLAUDE_SECURESTORAGE_CONFIG_DIR`
empty, and `kurmis login` of it runs without `CLAUDE_CONFIG_DIR`. Claude Code 2.1.306 (read from
its bundled source) takes its credentials from `CLAUDE_SECURESTORAGE_CONFIG_DIR` when that is
set, the empty string meaning the default ones, and otherwise from `CLAUDE_CONFIG_DIR`: the file
in that folder, and a Keychain item named after the variable's value (`keychain-service.ts`). So
a CLI started with `CLAUDE_CONFIG_DIR` set may be signed in to another account than the
login plain claude uses. The daemon is one per user and cannot follow a variable that each
shell sets for itself, so kurmis keeps plain claude's login fixed to `~/.claude` and
makes sure no request is signed as that login for a CLI on other credentials:

- `kurmis claude` on plain claude's login sets `CLAUDE_SECURESTORAGE_CONFIG_DIR` to the
  empty string, so the CLI signs in with that login's own credentials while its settings and
  transcripts still come from `CLAUDE_CONFIG_DIR`. When `CLAUDE_CONFIG_DIR` is set it says so on
  stderr.
- `kurmis setup` from a shell with `CLAUDE_CONFIG_DIR` set writes
  `$CLAUDE_CONFIG_DIR/settings.json`, which only CLIs with that variable read, and those sign in
  with the credentials in that folder. So setup adds `x-kurmis-started-on: none` to the custom
  headers there, and says so. The proxy then signs those CLIs' requests only with extra logins.
- On macOS and Windows any value of `CLAUDE_CONFIG_DIR` counts, the path of `~/.claude` too,
  because the CLI names its Keychain or Credential Manager item after the value. On Linux a
  value that resolves to `~/.claude` is the same file and does not count
  (`configDirHasOwnCredentials` in `src/data/login-env.ts`).
- So on macOS and Windows `kurmis setup` refuses to run while `CLAUDE_CONFIG_DIR` names
  `~/.claude` itself (compared with links resolved and without regard to case,
  `namesDefaultClaudeFolder`), and says to unset the variable and run setup again. The file it
  would write is `~/.claude/settings.json`, which every plain `claude` reads too, with or
  without the variable, and those two kinds of CLI have different credentials, so no
  `x-kurmis-started-on` in that file is right for both. For the same reason setup refuses, on
  every platform, a `CLAUDE_CONFIG_DIR` naming another folder whose `settings.json` is a link to
  `~/.claude/settings.json`, compared with every link resolved, one whose target does not exist
  yet included (`sharesDefaultSettingsFile`). `kurmis setup --pause` and
  `--uninstall-and-logout` still run.
- `kurmis claude` with `CLAUDE_CONFIG_DIR` naming `~/.claude` starts claude on the machine's
  own Claude login's credentials as above, which are the ones a `claude` without the variable
  uses, and its note says that the variable would otherwise give claude a Keychain item (or
  Credential Manager entry) of its own.

## The wrapper

`kurmis claude` and `kurmis login` start claude through `runInteractive` in
`src/cli/wrapper.ts`: `stdio: 'inherit'`, no shell, and the wrapper waits for the child.

- **macOS and Linux.** Ctrl-C (SIGINT) and Ctrl-\ (SIGQUIT) reach every process in the
  terminal's foreground process group, so the child gets them itself; the wrapper ignores them
  while the child runs, as `system(3)` does. That is so only when stdin is a terminal. When it
  is not (a script or a program runs `kurmis claude -p`), a SIGINT or SIGQUIT is most likely
  sent to the wrapper's pid alone, so the wrapper forwards them like SIGTERM. A child with piped
  input in a terminal's foreground process group then gets Ctrl-C twice and ends at the first.
  SIGTERM and SIGHUP are usually sent to the wrapper alone, so it forwards them to the child and
  keeps waiting.
- **Windows.** Ctrl-C, Ctrl-Break and closing the console reach every process on the console
  (Node reports closing as SIGHUP). The wrapper ignores all three and forwards nothing, because
  `child.kill()` there ends the child at once with TerminateProcess.
- **How the wrapper ends.** With the child's exit code. When the child was ended by a signal,
  the wrapper removes its handlers and raises the same signal on itself, so the shell sees the
  same end; for a signal whose default action writes a core dump, and on Windows, it exits with
  128 + the signal number instead. A child that cannot be started gives a message and the code a
  shell would give: 127 when there is no such program (also when `findProgram` finds none), 126
  when it cannot be run (EACCES, EPERM, ENOEXEC, EISDIR), 1 otherwise.

- **Starting itself again.** A `claude` on PATH may be a script of the person's that runs
  `kurmis claude`, and kurmis would start it, which starts kurmis, without end. The wrapper adds
  its pid to `KURMIS_WRAPPER_PIDS` in the child's environment, and refuses to start its child
  (exit 1, with a message that says to take the program off PATH or to set `KURMIS_CLAUDE_BIN`)
  when its own parent is one of those pids, which is what a script that `exec`s kurmis gives,
  or when eight wrappers already run inside each other,
  which catches a script that starts kurmis without `exec`. A `kurmis claude` run from the shell
  of a session has the CLI or a shell as its parent, never a wrapper, so it is not refused. A
  PATH hit that is kurmis' own bundle is skipped when the program is looked up (below).

`test/cli/wrapper-pty.test.ts` checks this under a pseudo-terminal: `test/cli/pty-driver.py`
(run with `python3 -I`) starts a bundled wrapper on the fake claude, sends Ctrl-C and SIGTERM, and
kills whatever is left in the process group. It needs `python3` and is skipped on Windows.

## Windows

- **Never start a `.cmd` or `.bat` shim.** Node will not start one without a shell, and
  through `cmd.exe` the user's arguments can be changed or run. Kurmis finds the real program
  behind the shim instead (below).
- **Deleting a folder** (`src/platform/remove-tree.ts`) never goes into a reparse point. Links
  and junctions are removed as links, and a folder whose real path (`realpathSync.native`)
  is outside the folder being removed, such as a volume mounted into it, which libuv reports as
  a plain folder, is removed with `rmdir` without recursion. `setup --uninstall-and-logout`
  deletes the data folder this way. It removes the logon entry with `reg.exe` and each login's
  Credential Manager record through `claude auth logout`, as `kurmis logout` does.

**Finding `claude`** (`src/platform/programs.ts`). `KURMIS_CLAUDE_BIN` names the program
explicitly (a `.js` path runs through Node). Otherwise kurmis searches PATH. On Windows it tries
each PATH folder with each extension in PATHEXT, in order, as `cmd.exe` does, and reads `Path`
and `PATHEXT` whatever the case of their names. The current folder and relative PATH entries are
skipped on every OS. An `.exe` or `.com` is started directly. A `.cmd` or `.bat` is read as a
package manager's shim and its target is started. `.ps1` and extensionless shims are never
used. When nothing is found, Claude Code is looked for where its native installer puts it:
`%USERPROFILE%\.local\bin\claude.exe` (`~/.local/bin/claude` on macOS and Linux). On Windows
that installer, and Claude Code updating itself, replace `claude.exe` with two renames, so for a
moment it is missing. A start (`findProgramForLaunch`) that finds it missing, with a
`claude.exe.new.*` copy written in the last minute next to it, waits up to three seconds for it
when it would have been the program found, rather than start an npm claude later on PATH or
report none. When the wait runs out it starts `claude.exe` anyway and fails. On macOS and
Linux a PATH hit that is a symlink to a `.js` file (an npm install of a Claude Code version whose
bin was `cli.js`) runs that file through Node, so a PATH without `node` on it still works. A
PATH hit that resolves to kurmis' own bundle (a link to it, or a shim that starts it) is skipped
and named in the not-found message, because it is not the real program.

**Reading npm, pnpm and yarn shims** (`src/platform/npm-shim.ts`). Each generator writes a line
that ends in the quoted target path, relative to `%~dp0` or `%dp0%` (the shim's own folder),
followed by `%*`. Kurmis finds that line and reads each word once from left to right, as
`cmd.exe` does: the folder variables become the shim's folder, `%%` becomes `%` (pnpm 11 writes
a `%` in a path that way), and a `%` in the shim's folder stays as it is. It refuses anything
else (other variables, relative paths, pipes, redirections). The shim file is read as UTF-8,
which npm and pnpm write, and a byte order mark is dropped; a file that is not UTF-8 is refused.
It reads npm's cmd-shim 2 to 9 (npm 6 to 12), pnpm's `@zkochan/cmd-shim` (pnpm 10 and earlier)
and `@pnpm/bins.cmd-shim` (pnpm 11); yarn 1 wrote the same form as npm's cmd-shim 2. A `.js`
target runs through the `node.exe` next to the shim if there is one, otherwise through the Node
that runs kurmis. An `.exe` target is started directly. A shim kurmis cannot read is skipped and
the search goes on; the not-found message lists every skipped shim and why. The fixtures in
`test/platform/fixtures/` were generated by running the generators: npm's cmd-shim 8.0.0 (from
npm 11.9.0) and 9.0.2 (from npm 12.2.0), `@zkochan/cmd-shim` 9.0.8, and `@pnpm/bins.cmd-shim`
1100.0.4 (the same code pnpm 11.28.6 bundles). The fixtures for cmd-shim 2 and 4 are written by
hand from its source.

**What the packages contain.** `@anthropic-ai/claude-code`'s bin is `bin/claude.exe`; its
postinstall step replaces a placeholder script with the native program. When that step did
not run, the file does not start with `MZ`, and kurmis runs the package's `cli-wrapper.cjs`
through Node instead. Kurmis does not take over the `NODE_PATH` that pnpm's shims set, because
Node finds a package's dependencies from its real folder.

## Test hooks

Environment variables that exist only so tests can point kurmis at stand-ins. A person never
needs them.

- `KURMIS_HOME` moves the data folder; every test sets it to a temporary folder. A relative one
  is taken from the current folder, and every start of a daemon passes it on as an absolute path
  ("Starting it from the CLI").
- `KURMIS_CLAUDE_BIN` names the program (also usable by a person). `test/setup.ts` points it
  at `test/no-real-program.mjs`, which only fails, so no test can start the real CLI from PATH
  by accident; a test that needs a CLI names a fake. While the guard below is on, `findProgram`
  falls back to the process's value, so a test of the PATH search sets it to an empty value.
- `KURMIS_UPSTREAM_URL` is Anthropic's API base URL, `https://api.anthropic.com` by default.
- **The system programs.** Every program of the operating system kurmis runs has a variable
  that names a stand-in (`src/platform/system-programs.ts`): `KURMIS_LAUNCHCTL_PROGRAM`
  (`/bin/launchctl`), `KURMIS_SECURITY_PROGRAM` (`/usr/bin/security`),
  `KURMIS_POWERSHELL_PROGRAM` (`<SystemRoot>\System32\WindowsPowerShell\v1.0\powershell.exe`),
  `KURMIS_REG_PROGRAM` (`<SystemRoot>\System32\reg.exe`), `KURMIS_TASKKILL_PROGRAM`
  (`<SystemRoot>\System32\taskkill.exe`) and `KURMIS_WSCRIPT_PROGRAM`
  (`<SystemRoot>\System32\wscript.exe`, which kurmis only names in the logon entry). The
  variable is looked up in the environment the code was given and, when it is not set there,
  in the process's own environment, so a test that passes an empty or partial environment
  still gets the stand-in `test/setup.ts` set. For the same reason a daemon kurmis starts gets
  these variables, the guard and its log from the process's environment when the environment it
  is started with lacks them (`inheritedTestHooks`), and while the guard is on also `HOME`,
  `USERPROFILE`, `KURMIS_HOME`, `KURMIS_CLAUDE_BIN` and `KURMIS_UPSTREAM_URL`
  (`TEST_HOME_VARIABLES`), so it uses the test's temporary home and API address and not the real
  ones. A stand-in that is a `.mjs` file runs through Node, as every `.js` program does
  (`invocationFor` in `src/platform/run.ts`), since Windows cannot start such a file itself.
  `test/setup.ts` points them at:
  - `test/daemon/fake-security/security.mjs`, with its Keychain items in `$FAKE_SECURITY_DIR`;
  - `test/platform/fake-launchctl/launchctl.mjs`, which records its calls in
    `$FAKE_LAUNCHCTL_DIR` and answers bootstrap, bootout and print with launchctl's exit codes.
    `FAKE_LAUNCHCTL_RUN=1` makes it run a loaded job's program with only the plist's
    environment, as launchd would; `FAKE_LAUNCHCTL_FAIL_BOOTSTRAP=<code>` makes every bootstrap
    fail;
  - `test/platform/fake-reg/reg.mjs`, which keeps values in `$FAKE_REG_DIR`; `FAKE_REG_FAIL=1`
    makes every call fail;
  - `test/platform/fake-windows/powershell.mjs`, which records each call and its decoded script
    in `$FAKE_POWERSHELL_DIR`, answers the Credential Manager listing from the files in its
    `credentials/` folder (none by default) and fails for every other script, or for every
    script when a `mode` file there says `fail`; `taskkill.mjs`, which records its calls in
    `$FAKE_TASKKILL_DIR` and ends only the one pid it is given (not its children, as `/T`
    would); and `wscript.mjs`, which only has to exist.
- `KURMIS_ENTRY` names the bundle a daemon is started from, for tests that run the CLI from the
  source tree, where there is no bundle to start.
- **The guard.** `KURMIS_REFUSE_SYSTEM_PROGRAMS=1`, which `test/setup.ts` and the integration
  harness set, makes `runProgram`, `startFrameProcess`, `spawnDetached` and the wrapper refuse
  (`src/platform/system-program-guard.ts`): a program whose file name, or that of the file its
  links lead to, is one of the system programs above, `cmd`, `cscript`, `wmic`, `schtasks`,
  `claude`; a program inside the Claude Code npm packages or the native installer's
  `~/.local/share/claude/versions`; and Node running a script that is one of these, such as
  `node …/@anthropic-ai/claude-code/cli.js`, which is how a `claude` on PATH that links to a
  `.js` file is started. It is passed on to every program kurmis starts, together with
  `TEST_HOME_VARIABLES` (above) from the process's environment where that program's environment
  lacks them. Each refusal is also written to the file `KURMIS_REFUSED_PROGRAMS_LOG` names, and
  `test/setup.ts` fails any test after which that file is not empty: a test whose code reached a
  real program fails even when the refusal let it pass.

**Test processes.** Vitest runs each test file in a process of its own (`pool: 'forks'` in
`vitest.config.ts`). In a worker thread a change to `process.env.HOME` does not reach
`os.homedir()`, so the tests would read and write the real home folder; `test/setup.ts` stops
with an error when `os.homedir()` is not its temporary home.

**Testing the daemon process.** `test/daemon/bundle.ts` bundles kurmis into a temporary folder as
`scripts/build.mjs` does, with a version the test chooses. `entry: 'real'` is the real CLI;
`entry: 'fake'` runs `daemon run` around a small fake request handler
(`test/daemon/fake-app.ts`) and the real CLI for every other command. An older daemon is a
bundle built with an older version, so no variable is needed to fake one. In-process tests pass
`runDaemon` a fake app, an EventEmitter in place of `process`, and a `version`.
`createDaemonApp`'s `tuning` option shortens the daemon's timings for tests.

**Integration tests.** `test/integration/` runs the real bundle as `node <bundle> …` processes,
end to end, against the fake claude and Anthropic API. `createWorld` in
`test/integration/harness.ts` gives each test its own temporary HOME, data folder, free port,
fake API, and fake Keychain, launchctl and registry folders. It builds the children's
environment from nothing, so only the fakes and the stand-ins of `test/setup.ts` can be reached.
After each test it runs `kurmis daemon stop`, and then kills a daemon that still runs only when
it is shown to be the test's (`OwnDaemons` in `test/daemon/own-daemons.ts`): it answers a status
request on the world's port with a key the world's data folder held and with its own pid, or,
off Windows, `ps` shows that it runs a bundle the world's commands ran. The pids come from
`daemon.json` and from the `daemon_started` lines of `daemon.log`. Windows soon gives a freed
pid to a new process, so there a pid that cannot be shown to be the test's daemon is never
signalled; the harness waits up to 10 seconds for it to exit, so that the world's folder is no
longer in use when it is removed. The daemon process tests in `test/cli/` stop their daemons
the same way.

**Tests on Windows.** The suite is meant to pass on Windows as well. `test/host.ts` has what the
tests need for that: `linkFolder` makes a directory junction on Windows (a directory symlink
elsewhere), and `canCreateSymlinks` makes one symlink to find out whether this process may;
tests of a symlink to a file or of a dangling link run only when it may (on Windows with
Developer Mode on or as an administrator). `withoutAddedVariables` drops the variables libuv
adds to a child's environment on Windows (`SYSTEMROOT`, `TEMP` and a few more) before an exact
comparison. Mode bits are checked only off Windows, which has none. Windows cannot deliver a
signal that a process could handle: SIGTERM from Node ends a process at once, so tests that need
a handler to run are POSIX-only, and the daemon process test also stops it through the control
API. Temporary folders are removed with `maxRetries`: on Windows a file another process has
open, or the folder it runs in, cannot be deleted (EBUSY), and a process that has just been
ended may hold them a moment longer.

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
  plain claude's login. That CLI reads the extra login's credentials and sends that
  login's token in its `Authorization` header. When the proxy picks the login plain claude
  uses and has read no token for it, it forwards that header, so the request is billed to the
  extra login while kurmis counts it as the login plain claude uses. When the proxy has read
  that login's token, which is the usual case, the request is signed and counted correctly. The
  wrapper cannot avoid this: any variable it could add to tell the nested CLI apart is
  overridden or never sent, because the `env` of `settings.json` beats the process environment
  and the proxy only sees headers. Use `kurmis claude` inside such a session instead.
- **A plain `claude` inside a `kurmis claude` session on plain claude's login, with
  `CLAUDE_CONFIG_DIR` set and global mode set up from it.** The session's
  `CLAUDE_SECURESTORAGE_CONFIG_DIR` is empty, and a shell started from it passes that on, so the
  plain `claude` signs in as plain claude's login. It reads
  `$CLAUDE_CONFIG_DIR/settings.json`, whose headers say `x-kurmis-started-on: none`, so the proxy
  does not use the login plain claude uses for it although it could. Its requests go to the extra
  logins, or get the 599 when there is none.
- **A plain `claude` with `CLAUDE_CONFIG_DIR` naming `~/.claude`, after a setup without the
  variable.** Setup writes `~/.claude/settings.json` with no `x-kurmis-started-on`, so the proxy
  counts every plain `claude` that reads it as started on plain claude's login. One
  run from a shell with `CLAUDE_CONFIG_DIR=~/.claude` reads that file too, but signs in with the
  Keychain item (or Credential Manager entry) named after the variable's value, which may hold
  another account or none. When the proxy picks the login plain claude uses and has read its token,
  the request is signed and counted as that login. When it has read no token for that login, it
  forwards the CLI's own `Authorization` header, so the request is billed to whatever account
  that item holds while kurmis counts it as the login plain claude uses. Kurmis cannot tell these
  CLIs apart, since the variable is not sent with the request. Unset the variable, or use
  `kurmis claude`.
- **A daemon started from ssh on macOS.** A process started from an ssh login runs in the ssh
  session's audit session. It cannot read the login Keychain, and neither can any process it
  starts, so such a daemon gets no token from a Keychain item. The Keychain reads fail with exit
  36 ("User interaction is not allowed"), and `kurmis status` shows those logins without a token.
  The CLI starts the daemon the same way from ssh as from a terminal at the screen and does not
  check for this. With `kurmis setup` run at the screen, the login item starts the daemon in the
  GUI session and ssh sessions use it. A newer kurmis replaces an older daemon from wherever it
  runs, so after an update the first command over ssh that starts the daemon leaves a daemon
  that cannot read the Keychain.
- **A daemon started from ssh on Windows, or from a terminal that ends its children.** Node cannot
  ask for `CREATE_BREAKAWAY_FROM_JOB`, so a detached child stays in a job object its parent is in.
  Windows' OpenSSH server puts each session in such a job and ends every process in it when the
  session closes, and some IDE terminals do the same when they close. A daemon started there
  ends with them, and the next `kurmis claude` starts it again. The daemon the logon entry starts
  is in no such job.
- **Version handover.** The new daemon reads `state.json` once, when it starts. While the old
  daemon finishes its open requests, the usage, cooldowns and session placements it records stay
  in its own memory, and the new daemon does not see them. Both daemons write the whole
  `state.json` in that time, so the file holds whichever wrote last; the old daemon writes once
  more as it stops, and a change the new one made before that is lost from the file (not from
  the new daemon's memory) until the new daemon writes again.
- **What counts as a usage limit.** A 429 counts as a usage-limit refusal when its
  `anthropic-ratelimit-unified-status` is `rejected` or it carries
  `anthropic-ratelimit-unified-representative-claim` or `anthropic-ratelimit-unified-overage-status`
  (`isDefinitiveQuotaRejection`). Any other 429 is treated as no capacity. This
  has not been checked against a real usage-limit 429 from Anthropic yet.

## Code layout

- `src/data/` holds the data folder: its paths, login ids (`login-id.ts`), the JSON file
  helpers, the stores for `config.json`, `state.json` and `daemon.json`, the lock file around
  `config.json` changes (`lock.ts`), the Claude profile reader (`identity.ts`), the log writer,
  and the removal of the whole folder (`remove-data-folder.ts`). Both the CLI and the daemon use
  it.
- `src/core/` holds pure logic with no I/O: routing, usage parsing, limits.
  - `accounts.ts`: the rule a login id is checked against, and the defaults for a new login
    (both limits 100%, opted in).
  - `login-alias.ts`: the alias rules and the automatic alias made from an email.
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
  - `credentials.ts`, `keychain-service.ts`: the `.credentials.json` format and the Keychain
    item name.
- `src/daemon/` holds the proxy, the control API, the token readers (`credentials.ts` for the
  file, `keychain.ts` for the macOS Keychain, `credential-manager.ts` for Windows Credential
  Manager, put together in `tokens.ts`), the usage probes and the daemon's lifecycle.
- `src/cli/` holds the commands and the wrapper. `main.ts` is the bundle's entry and
  `dispatch.ts` picks the command and handles `--login`, `--help`, `--version` and
  `help <command>`. `wrapper.ts` runs an interactive child, `settings-arg.ts` builds claude's
  `--settings`, `global-settings.ts` edits the user settings file for `setup`,
  `global-routing.ts` answers whether global routing is on, paused or off and keeps
  `settings-files.json`, `local-credentials.ts` checks whether a login's credentials are on this
  machine, `status-format.ts` renders `status`, `daemon-client.ts` reaches the daemon and
  `sign-out.ts` signs an extra login out with
  `claude auth logout`. Each command is one module in `src/cli/commands/` exporting a `Command`
  (`src/cli/command.ts`), whose `run` returns the exit code: 0 done, 1 failed, 2 wrong command
  line, or the child's code for `claude`. Most also export a `create<Name>Command(deps)`, which
  takes fakes of what the command reaches outside itself (the daemon client, the child runner,
  `findProgram`; `command-deps.ts`), so unit tests run without a daemon or a real CLI. What the
  commands do is in the README and in the header comment of each module; "The commands" below
  has what those do not say.
- `src/version.ts` holds the version, which the build takes from `package.json`.
- `src/platform/` holds what differs per OS: finding programs and reading npm shims
  (`programs.ts`, `npm-shim.ts`), deleting a folder without following its links
  (`remove-tree.ts`), detaching (`detach.ts`), the launchd login item (`launchd.ts`), autostart
  (`autostart.ts`, `windows-autostart.ts`), reading Windows Credential Manager
  (`windows-credentials.ts`), where the system programs are and their test stand-ins
  (`system-programs.ts`, `system-program-guard.ts`), and the file rename retry and file modes
  (`files.ts`). Every short-lived program kurmis starts goes through `runProgram` in
  `run.ts`: no shell, stdin closed, a deadline and a cap on the output. The usage probes, whose
  stdin carries JSON frames, go through `startFrameProcess` in `frame-process.ts`: no shell, a
  deadline, a cap on each frame and on all output, and a kill that takes the program's child
  processes with it (its process group on macOS and Linux, `taskkill /T /F` on Windows).
- `test/` mirrors `src/`. `test/fakes/` holds stand-ins for `claude` and Anthropic's API.
  `test/daemon/fake-security/` stands in for macOS's `security` program, with its Keychain
  items in a temporary folder. No test reaches the network or the user's real `~/.claude` or
  Keychain.

## The commands

`kurmis claude` and `kurmis setup` are described above.

**`kurmis status`** never starts the daemon and exits 0 whether one runs or not.

- When a daemon answers with this kurmis' control API version, the logins come from its status
  answer. When it has read no signed-in login yet, status asks for one probe and waits up to 15
  seconds. Then it ends the request and closes its connection, so the command exits at once
  while the daemon finishes the probe. An older daemon is shown as it is; status replaces
  nothing.
- When no daemon runs, the one that runs does not answer its status request, or it answers in
  another control API version, the logins come from `config.json` and `state.json`, and each
  login's email from its profile files. The sign-in is not known then, so each login shows
  whether its token is on this machine (`checkCredentials` in `src/cli/local-credentials.ts`):
  its `.credentials.json` holds a `claudeAiOauth` record with an access token, or the system's
  store has a record under the login's Keychain item name. On macOS that is
  `security find-generic-password -s <service>` without `-w`, which prints the item's attributes
  and not its secret (exit 0 yes, 44 no), one run per login without the file, side by side, with
  a 3-second deadline. On Windows it is one PowerShell run that lists Credential Manager's names
  without the blobs (`storedRecordsExist` in `src/platform/windows-credentials.ts`). A
  `.claude.json` that names an account does not count, because the CLI keeps it after the token
  is gone. A check that cannot run gives `unknown`, never yes. Status never starts `claude` for
  this. The "passed over" lines are left out then, because they depend on the sign-in and on
  usage the daemon reads again when it starts.
- **The same account.** Two logins are the same account when their emails, compared without
  regard to case, and their organization uuids are the same, or their emails are the same and
  either has no organization recorded (`isSameClaudeAccount` in `src/data/identity.ts`). The
  logins are taken in order, the login plain claude uses first. Each is compared with the first
  login of every account found so far, and the warning names the `kurmis logout` that removes
  the later one.

**`kurmis login`**

- A new login gets its id first, and its folder is `claude/<id>/` from the start, because the
  folder's path names its Keychain item.
- The command holds the login's lock (`locks/`) until it ends, so a failed run can never delete
  the folder of a run that signed in, and a logout cannot delete a folder a sign-in writes into.
- `claude auth login --claudeai` runs with `claudeLoginEnv` through the wrapper. On Windows a
  login whose record is already in Credential Manager signs in with
  `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`, so the new token replaces the record instead of going
  to a file the record hides.
- The sign-in counts when the CLI exits 0 and an account (`.claude.json`) or credentials are
  there (`hasCredentials`). An `unknown` answer counts as there, since the CLI reported the
  sign-in as done. Otherwise a folder this run created is removed and nothing is added.
- For the login plain claude uses, the email is read from `~/.claude.json`, and the probe
  folder's `.claude.json` is deleted first, because it may name the account signed in before.
- A new login is compared with the others again under the config lock, just before it is
  added, so two `kurmis login` runs of one account at the same moment add it once.
- Afterwards a running daemon is told to reload and asked to probe the login, waiting up to 15
  seconds, because it may still hold the login as signed out and Auto would pass it over until
  its next poll. No daemon is started for this.

**`kurmis logout`** takes the login out of `config.json`, tells a running daemon to reload (so
it stops probing the login), runs `claude auth logout` with a 30-second deadline and deletes the
folder with `removeTreeSync`. On Windows `claude auth logout` gets
`CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`, without which the CLI deletes only the file and leaves
the record in Credential Manager. A failed sign-out is a warning that names the Keychain item or
the Windows credentials that may be left, and the removal goes on. `setup
--uninstall-and-logout` runs the same removal (`createLoginLogout`) with `keepWhenSignOutFails`
(step 4 above).

**`kurmis daemon status`** exits 1 when no daemon runs.

## `kurmis status --json`

`kurmis status --json` prints its own shape, not the control API's answer, so it can stay
stable while the daemon's usage snapshot changes. Times are ISO strings. The current format is
7. Fields may be added without changing it; removing a field or changing its meaning raises it
(`STATUS_JSON_FORMAT` in `src/cli/status-format.ts`).

```json
{ "format": 7,
  "daemon": { "version": "0.1.0", "pid": 4242, "port": 28411, "startedAt": "<ISO>", "older": false, "newer": false },
  "source": "daemon",
  "globalRouting": "on",
  "logins": [ {
    "id": "k3v9q2m7xa", "alias": "work-example", "usedByPlainClaude": false,
    "email": "<email or null>", "signedIn": true, "credentials": null, "probing": false,
    "routing": true, "fiveHourLimit": 90, "weeklyLimit": 100, "useFirst": false,
    "usage": { "fetchedAt": "<ISO>", "source": "probe", "plan": "max", "error": null,
      "windows": [ { "key": "five_hour", "label": "5 hour", "durationMinutes": 300,
        "utilization": 42, "resetsAt": "<ISO or null>", "plan": true, "limitPercent": 90 } ] },
    "blocked": { "kind": "over-limit", "text": "<sentence>", "until": "<ISO or null>" },
    "sessions": 2 } ],
  "warnings": [ "<sentence>" ] }
```

- `daemon` is null while no daemon runs. `older` is true when the daemon is older than this
  kurmis, so the next command that starts the daemon replaces it. `newer` is true when it is
  newer, so no command of this kurmis replaces it.
- `source` is `daemon` when the logins come from the daemon's status answer, and `files` when
  they come from `config.json` and `state.json`: no daemon runs or answers its status request,
  or the one that runs answers in another control API version, and then `daemon` is not null.
- `globalRouting` is `on`, `paused` or `off`.
- The logins come in `config.json` order, plain claude's first. `id` never changes; `alias` is
  what the person types. `email` is shown, never stored. `sessions` is the number of
  sessions whose last request in the last 7 days this login served (the daemon keeps the 2000
  sessions that sent a request most recently).
- With `source` `daemon`: `signedIn` is what the daemon found, null when it has not looked yet,
  and `credentials` is null.
- With `source` `files`: `signedIn` is null, `credentials` is whether the login's token is on
  this machine (`true`, `false`, or `"unknown"` when a check could not run), `usage` is the last
  snapshot the daemon wrote to `state.json`, `probing` is false and `blocked` is null.
- `usage` is null when the login's usage has not been read yet. A window whose reset has passed
  reads `utilization: 0`. `limitPercent` is null for a window that meters one model rather than
  the plan. The CLI's `get_usage` answer has the server's `seven_day_opus` and
  `seven_day_sonnet` windows and, in `model_scoped`, the per-model weekly windows from the
  server's `limits` list, so one model's window can come twice, as `seven_day_opus` and as
  `Opus`. An `Opus` or `Sonnet` entry with the same figure and reset as the fixed window is left
  out of `windows` and the text (`repeatsModelWindow` in `src/core/usage-rules.ts`); the
  daemon's snapshot keeps both.
- `blocked` is null when Auto could use the login. `blocked.text` gives a cooldown's end as an
  ISO time, as the daemon's log does.
- `warnings` holds a sentence for each login that is the same account as another login, and one
  when `globalRouting` is `on` and `daemon` is null.
