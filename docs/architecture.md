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

- `config.json` holds the daemon's port and the logins with their settings: id, whether it is the
  login plain claude uses (`usedByPlainClaude`), alias, whether the person set the alias, opt-in,
  the two limits and use-first. The CLI writes it. The daemon writes it only to give a login its
  automatic alias, or to add plain claude's login to a file that has none (see "Aliases" below), and
  reloads it when its contents change (`configStamp`, a hash of the file).
- `config.json.lock` exists while a command changes `config.json` (see `src/data/lock.ts`).
  `settings-files.json` has a lock of its own.
- `settings/` holds the settings files `kurmis claude` passes to claude with `--settings`
  (see "How a Claude CLI reaches the daemon"), mode 0600. One that holds only kurmis' variables
  is named after a hash of its contents and removed once no start has used it for 30 days. One
  that holds a copy of the person's own `--settings` is `run-<pid>-<random>.json`, deleted when
  that wrapper ends.
- `claude/<id>/` is the config folder of the extra login with that id. On Linux and Windows it holds
  `.credentials.json` (on Windows the record may be in Credential Manager instead). On macOS the
  secret is in the Keychain. The Keychain item's and the Credential Manager record's names are made
  from this folder's path (`keychainService` in `src/core/keychain-service.ts`). So a sign-in goes
  straight into this folder, and the folder is never renamed.
- `locks/<id>.lock` exists while a `kurmis login` or `kurmis logout` of that login runs
  (`src/cli/login-lock.ts`). It is the lock file of `src/data/lock.ts`, held for the whole
  command, because a sign-in can take minutes. A second run for the same login stops at once
  with a message naming the pid that holds it. A lock whose pid does not run, or that is older
  than 24 hours, is taken over.
- `probe/` holds the usage probes' folders: `probe/cwd`, the empty folder every probe runs in,
  and `probe/claude-own`, the `CLAUDE_CONFIG_DIR` of the probe of the login plain claude
  uses. The CLI caches that login's profile in `probe/claude-own/.claude.json`, which is where
  the daemon reads its account uuid and email.
- `daemon.json` holds the running daemon's pid, port, version and start time. The daemon writes it
  once it has its port and removes it as the last step of stopping, only while the file still names
  its own pid (`removeDaemonFile` in `src/data/daemon-file.ts`), so a replaced daemon never removes
  its successor's file. The CLI removes a `daemon.json` whose pid no longer exists, and one that is
  damaged.
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
- `key` holds the secret every proxied and control request carries. It is created once and kept,
  because a running Claude CLI and, in global mode, `~/.claude/settings.json` hold a copy of it and
  must keep working after the daemon restarts. Only the user can read it.
- `state.json` holds the daemon's usage snapshots, cooldowns and which login each session is on,
  so a daemon restart keeps them.
- `daemon.log` is the daemon's log. It names logins by their id only. It never holds a token, a
  request body, an alias or an email. At 5 MB it is renamed to `daemon.log.1`, replacing the
  previous one.

**The login plain claude uses.** It is marked `usedByPlainClaude` in `config.json`: the account a
plain `claude` is signed in to. Plain `claude` means the CLI run without kurmis. The login follows
whatever that CLI is signed in to. It is always in the config, cannot be removed, and has no folder
here. It is the login in `~/.claude`: `~/.claude/.credentials.json` and the Keychain item with the
plain name, whatever `CLAUDE_CONFIG_DIR` says (see "Plain claude's login and `CLAUDE_CONFIG_DIR`"
below). A CLI on this login runs with the environment left as it was inherited, apart from the
routing variables and `CLAUDE_SECURESTORAGE_CONFIG_DIR`, and with the API key and OAuth token
variables removed. Code tells this login apart from the others by its `usedByPlainClaude` setting
(`plainClaudeLogin` and `extraLogins` in `src/data/config.ts`), never by its id.

**Login ids.** Every login, plain claude's included, has an id that never changes. A new id is 10
lowercase letters and digits from `node:crypto` (`newLoginId` in `src/data/login-id.ts`,
`newLoginIdFor` in `src/data/config.ts`). It is unique, and it is none of the logins' aliases, so an
id alone names one login. `kurmis login` also passes over an id that has a folder in `claude/`.

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
- **Who sets the automatic alias** (`followEmail` in `src/data/config.ts`). `kurmis login` sets it
  right after the sign-in, from the email it reads. The daemon sets it after a usage probe that
  finds the login signed in and tells it the email from the profile the probe's CLI cached
  (`src/data/identity.ts`, `noteEmail` in `src/daemon/logins.ts`). A failed write is tried again
  after the next probe.

No email is stored in any file kurmis keeps. A login's email is read from its profile file when
it is needed (`src/data/identity.ts`). For plain claude's login that is the
probe folder's `.claude.json`. The shared `~/.claude.json` counts only before the first probe:
every claude that uses the default config folder writes its account there, so after a
`kurmis claude` on an extra login it names that login.

**Writing files.** The JSON files are written to a temp file in the same folder, flushed to the disk
and renamed over the old one, so a reader sees the old file or the new one, never half of each. On
Windows a rename fails while another program has the file open, so it is retried for about a second.
On macOS and Linux the data folder is created with mode 0700. `key`, `daemon.json`, `daemon.log` and
the files that hold the person's settings are 0600; `config.json` and `state.json` keep the default
mode inside the 0700 folder. Windows ignores those modes; there the files are protected by the
access list they inherit from `%USERPROFILE%`, which only lets in the user, SYSTEM and
Administrators.

**Reading files.** `loadConfig` adds the login of plain claude, with a new id, when the config has
none, a missing `config.json` included, and saves the file under its lock, so every reader sees the
same id from then on. `kurmis status` reads it this way too, so it creates the data folder when it
is gone. `readConfig` reads the file without writing it, for the readers that must change nothing:
`findDaemon`, the check of whether global routing is on (`globalRoutingState`), and the part of
`setup --pause` and `--uninstall-and-logout` that reads before anything is removed. A `config.json`
that is not JSON or has a wrong field is an error that names the file and the field. So is one whose
`version` is not 3. For an older version the message says to delete the file and add the extra
logins again; for a newer one, to update kurmis. Two logins with one id or alias, or a second plain
claude login, are errors too. A damaged `state.json` never stops the daemon: an entry that does not
check out is dropped and the rest is kept, and a file that is not JSON, or of another version, reads
as empty.

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

Session placements are dropped after 7 days without a request, and beyond the newest 2000.
`state.json` is saved at most every 2 s and once when the daemon stops. `kurmis status` reads
`state.json` while no daemon runs: each login's usage snapshot and cooldown, whose `fetchedAt` it
shows as the age of the usage, and the session placements, which it counts per login.

## The daemon

One daemon per user. It serves the proxy and the control API on one `127.0.0.1` port. The port is
fixed so that `settings.json` can name it. It is `port` in `config.json`, 28411 when that is not
set, and a busy port is an error that says how to change it. A new daemon replaces a daemon of an
older version at once, and the old one finishes its open requests in the background ("Version
handover" below).

- **What the daemon answers itself.** `HEAD` and `GET /api/hello` get a 200 without the key,
  because the CLI checks the base URL with it before its first request and without its custom
  headers. A path that is neither the control API nor one of the routed Anthropic paths
  (`ROUTE_PATHS` in `src/core/proxy-rules.ts`) is a 404. The code is `src/daemon/app.ts`.
- **The control API** is on paths under `/_kurmis/` (`src/daemon/control.ts`). It lets the CLI read
  status, ask for a usage probe, reload config and stop the daemon. The paths and their answers are
  in `src/core/control-api.ts`. Every request needs the secret from `key`, in the header
  `x-kurmis-key`; without it the answer is 403 with no body. `status` gives each login's id, alias
  and whether plain claude uses it (`usedByPlainClaude` in `LoginStatus`). It also gives each
  login's email from its profile file (`src/data/identity.ts`), for `kurmis status` on the person's
  own terminal. The email is never logged. A login also gets the organization uuid from its profile
  file (`organizationUuid`). `kurmis status` compares it with the email to warn about two logins of
  one account; `kurmis login` makes the same check from the profile files. A request body may be at
  most 64 KB (`MAX_CONTROL_BODY_BYTES`). A larger one is answered 413 with the control API's error
  answer (`{ "ok": false, "error": "…" }`) as soon as the size is known, from `content-length` or
  while reading. The daemon then goes on reading the rest of the body and throws it away, for at
  most 30 seconds.
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

  None of them is forwarded upstream. The body is read whole (at most 64 MB), because a request may
  have to be sent more than once. A body that is not JSON is a 400. Otherwise it goes upstream as
  the bytes that came, except for the account uuid in `metadata.user_id`, which is set to the chosen
  login's (`outgoingBody` in `src/core/proxy-rules.ts`): only that string is replaced in the text,
  so key order, white space and integers above 2^53 reach Anthropic as the CLI sent them. A larger
  body gets a 413 with an error in the shape of Anthropic's own (`request_too_large`), which the CLI
  does not retry. The proxy then reads and discards the rest of the body, for at most 5 s after the
  answer (`TOO_LARGE_LINGER_MS`), and closes the connection.
- **Choosing a login.** The steps of a request are in the header of `src/core/proxy-rules.ts`; the
  ranking of logins is `rankAccounts` in `src/core/account-router.ts`. Logins whose usage reading
  belongs to a window that has ended are probed first. Such a probe of a login is not started again
  within a minute of the last one (`STALE_PROBE_INTERVAL_MS` in `usage-poller.ts`), by any request,
  so a probe that keeps failing does not run before every request; meanwhile the stale reading
  counts as empty, as it does anyway. A login whose token is about to expire is chosen as if it were
  fresh, and a usage probe renews its token. On Auto the request waits at most 5 s
  (`RENEWAL_WAIT_MS`) for that when another login could take it. A login whose record has no refresh
  token is never renewed: it just becomes unusable when its token is about to expire.
- **Signing.** The proxy signs with `Bearer <token>` for the token it read for the chosen login.
  When the chosen login is the one the CLI was started on and no token was read for it, the
  CLI's own `authorization` header is forwarded instead. No other login is ever signed with the
  CLI's header. A request with `x-kurmis-started-on: none` is never signed with the CLI's header,
  and plain claude's login is left out of its pool, because the CLI is signed in to
  another account than that login's; when no other login can take it, the proxy's 599 says so.
  A 401 is handled this way:
  - A 401 on the CLI's own header goes to the CLI as it is: the CLI owns that token.
  - A 401 on a token the proxy read makes it read the token again. When the record has a refresh
    token, the proxy renews it once through a probe, then chooses a login again, normally the same
    one. A record without a refresh token is not renewed.
  - When that login still answers 401, or could not be renewed, the 401 goes to the CLI only if the
    login is the one the CLI was started on (the CLI can sign it in again) or the session is pinned
    to it with `x-kurmis-login`. Otherwise the request goes on to the next login, and Auto treats
    the login as signed out (`markRefused` in `logins.ts`, in memory only) until a usage probe of it
    succeeds and finds it signed in (the 15-minute poll keeps trying), or until the token read for
    it is another one, as after it was signed in again from a terminal. Only a fingerprint of the
    refused token is kept for that, never the token. A login whose token had run out when a usage
    probe started, and was still the same token after it while the probe did not find the login
    signed in, could not be renewed: it is signed out in the same way (`markSignInExpired`) until
    another token is read for it. With either mark the status shows the login signed out, and
    `kurmis claude` on Auto does not start on it while another pool login is signed in. The
    15-minute poll still probes it. With no login left, the CLI gets the proxy's own 599 below,
    never that 401.
- **Sessions** are told apart by the `X-Claude-Code-Session-Id` header the CLI sends. That is what a
  session stays on its login by. The CLI's subagents and small-model requests share it. Requests
  without one, or with an invalid one, share a single placement, stored under the key `:no-session`.
  A session is placed on a login only once an answer under 400 from it is passed on.
- **Usage limits.** A usage-limit 429 starts the login's cooldown until the reset it names. On
  Auto the request is then sent on the next login before the CLI sees anything. When no login is
  left, the CLI gets the real 429 of the login that is back first, so it behaves exactly as with
  one exhausted account. The proxy answers its own 429 (`poolLimitAnswer`) instead when it holds
  no real one (logins skipped for limits it already knew about), or when a login it did not try
  is back earlier than every one that refused. A login whose token is about to expire and could
  not be renewed is not back, whatever its usage. A pinned session gets its login's 429 as it is.
- **No capacity.** A 529, or a 429 without usage-limit headers, puts that login into the session's
  backoff (`CapacityCooling` in `src/core/capacity-hold.ts`) and the request goes to another login
  at once when the session may use one that is not cooling. Otherwise it waits for the first login
  to come out of its backoff, for any change in the logins (usage, cooldown, config), or for the
  client to close the request. After `CAPACITY_HOLD_MS` (two minutes) the proxy answers 529 itself,
  and the CLI sends the request again. The two minutes also end any wait for a login choice; a
  request whose hold ended meanwhile is given back and not sent.
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
- **The upstream connection** (`src/daemon/upstream.ts`) uses `node:https`, not `fetch`, which gives
  up after 300 s without headers or between chunks. Its timeouts and resend rules are in the header
  of that file.
  Answers are passed on byte for byte as they arrive, with backpressure: a CLI that reads slowly
  pauses the upstream connection. The daemon's HTTP client decodes nothing, so
  `content-encoding` is passed on with the body.
- **Usage** is probed every 15 minutes for each signed-in login (and each login not probed yet), and
  on demand: the control API's `probe`, a stale reading, a token renewal, and a login that appears
  in `config.json` when the daemon reads it again, by a `reload` or because a request found it
  changed (`onLoginsAdded` in `logins.ts`). One probe per login runs at a time; a second request
  waits for it. A failed probe keeps the previous windows and records the error on the snapshot. A
  probe that succeeds and finds the login signed in also gives the daemon the login's email, from
  which it sets an automatic alias ("Aliases", under "The data folder"). The daemon also updates
  usage from the rate-limit headers of every answer it gets from Anthropic, including ones it does
  not pass on. Rate-limit headers and cooldowns recorded after a probe started take precedence over
  its result. The code is `src/daemon/usage-poller.ts`, with the probe in `claude-probe.ts`.
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

  On Windows, Claude Code keeps the record in Credential Manager instead of the file when
  `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1` is set or the feature flag `tengu_windows_credman` is on in
  the CLI's config file: `.config.json` in the config folder the CLI runs with when that file is
  there and not empty, else `.claude.json` in `CLAUDE_CONFIG_DIR` or the home folder. Such a CLI
  reads Credential Manager first and the file only when Credential Manager has nothing, and deletes
  the file when it first writes the record to Credential Manager. The daemon reads the record in the
  same order. The lookup and the PowerShell reader are in `src/platform/windows-credentials.ts`, and
  the retry and waiting rules are in `src/daemon/credential-manager.ts`:
  - *Probes.* A usage probe of a login whose last read that worked found its record in
    Credential Manager runs with `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1` (`probeEnvironment`). The
    probe's config folder is not the one a routed CLI runs with, so its feature flag may be off,
    and then it would not see the record and would report the login signed out.
- **Config reload.** The daemon reads `config.json` again on the control API's `reload`, and when
  a request finds its contents changed (`configStamp`, checked at most every 2 s). A file that
  does not read leaves the config the daemon has. A file that could not be read because another
  process held its lock for more than 500 ms is read again at the next check, even when its
  contents stay the same. A login the new config has and the old one did not is probed at once.
  A removed login's usage, cooldown, marks and session placements are dropped, and a probe or an
  answer of it that ends after the reload records nothing.
  Until a config has been read, the daemon uses a stand-in with the login of plain claude under
  a new random id, which it never saves.

### Starting and stopping

The code is `src/daemon/main.ts` (the process), `src/daemon/lifecycle.ts` (what the CLI and the
daemon both need: a keyed control request, who holds a port, version comparison),
`src/cli/daemon-client.ts` (finding, starting and stopping it from the CLI) and
`src/platform/detach.ts`, `launchd.ts`, `autostart.ts`, `windows-autostart.ts`.

**`kurmis daemon run`** opens `daemon.log`, then reads or creates `key` and reads `port` from
`config.json`; a failure is logged and exits 1. Then it listens on `127.0.0.1:<port>`. The port is
the lock that keeps one daemon per user. When the port is busy, the daemon asks the holder for its
status with the key:

- an older kurmis daemon is replaced (below; `daemonAge` and `shouldReplaceDaemon` in
  `src/daemon/lifecycle.ts`);
- any other kurmis daemon (the same version and control API version, a newer one as defined below,
  or a version that cannot be compared, such as `dev`, which code run from the source tree
  reports) keeps the port, and the new process prints that it already runs and exits 0. Two CLIs
  that start a daemon at the same moment rely on this: the bind decides, and both CLIs connect to
  the one that won;
- any other program is an error, exit 1, that says to set `"port"` in `config.json` (1024 to
  65535).

When the port is busy and nothing answers, the daemon retries the bind every 100 ms for 10 s,
then exits 1.

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

**Version handover.** A CLI that finds an older daemon starts a new daemon, and the new daemon does
the handover: it sends the old one a control `stop` and tries the bind every 100 ms for up to 10
seconds. While the old daemon closes, its port may answer the status request with nothing or with an
error; once the stop is sent that counts as the old daemon going away, not as another program, and
the bind is tried again. The old daemon frees the port as soon as it has answered, and finishes its
open requests in the background while the new one serves. A routed Claude CLI retries a request
that finds no daemon (`CLAUDE_CODE_MAX_RETRIES=15`), which covers the moment in between.

Versions are compared numerically (`0.10.0` is newer than `0.9.1`). `scripts/build.mjs` adds the
build time to the version in `package.json` (`0.1.0+20261023120000`). Of two builds of one
version the later is newer, so an update replaces the daemon although the version number stays the
same (`compareVersions` in `src/daemon/lifecycle.ts`). A newer daemon (see below) is never replaced
by an older kurmis, so two builds with different control API versions do not keep replacing each
other: the one with the higher control API version stays.

A daemon on another port than `config.json` names (the port was changed while it ran) is not
reached by the new daemon's bind, so the CLI asks it to stop with a control `stop` before it
starts the new one, and the old daemon finishes its open requests in the background as above. A
`stop` that fails or gets an answer other than 200 is an error, and no new daemon is started. A
port that is already closed counts as stopped, so two daemons never run on two ports. The CLI does
this only when the running daemon is not newer than itself. When the daemon is newer, or the two
versions cannot be compared and differ, the CLI stops with an error that says to update kurmis or
to stop the daemon with `kurmis daemon stop`.

**A newer daemon.** A newer daemon (a higher version, a later build, or the same build with a higher
control API version) is kept. When its control API version is the CLI's own, the CLI uses it
(`canUseDaemon`). Otherwise the CLI cannot read its answers: `startDaemon` and `ensureDaemon`
throw a `DaemonNotUsableError` whose message (`unusableDaemonText` in
`src/cli/daemon-client.ts`) says that a newer daemon runs, gives both versions, and says to
update this kurmis or to stop the daemon with `kurmis daemon stop` and run the command again. A
daemon whose version cannot be compared and whose control API version is another is refused too;
the message says the versions cannot be compared and to stop it with `kurmis daemon stop`.
`kurmis claude`, `kurmis setup` and `kurmis daemon start` then fail with that message, and
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
`{ "maxWaitMs": 30000 }` and waits up to 30 seconds for the pid to exit. The deadline goes with
the first request, since a daemon that has answered `stop` no longer listens on its port. The
daemon ends its wait for its open requests by itself when the deadline is over, writes
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
`kurmis daemon restart` sends `stop` without a body, waits up to 5 seconds for the port to be free
(an error otherwise), then starts a new daemon, so the old one finishes its requests in the
background. It refuses to replace a daemon of a newer version.

### Starting at login

`kurmis setup` registers `<node> <bundle> daemon start` to run when the user logs in, and
`setup --uninstall-and-logout` removes it. That command starts the daemon detached and exits, so
removing the entry never ends a running daemon. Both are idempotent: what is already there is
compared first. The Node is the first usable `node` on PATH when it is the same file as the running
one, otherwise the running Node. A `node` on PATH in a temporary folder (`os.tmpdir()`, `TMPDIR`,
`TEMP`, `TMP`, `/tmp`, `/var/folders`) is passed over. Setup warns when the Node it registers is
still in such a folder, and still exits 0 (`nodeForJobs`, `isTemporaryPath` in
`src/platform/detach.ts`).
- **macOS:** `~/Library/LaunchAgents/kurmis.daemon.plist` (`daemonJobPlist` in
  `src/platform/launchd.ts`). It has `RunAtLoad` and `AbandonProcessGroup`, no `KeepAlive`, and
  output to `/dev/null`. Its environment is only `HOME`, the caller's `PATH` (so the daemon finds
  `claude`), `KURMIS_HOME` as an absolute path, and the program variables and test hooks when they
  are set; never an `ANTHROPIC_*`, `SSH_*` or `CLAUDE_*` variable. A process launchd starts from it
  runs in the user's GUI session, which can read the login Keychain. It is written only when its
  content differs, and loaded with `launchctl bootstrap` when it was just written or is not loaded;
  a loaded copy is unloaded first. The GUI domain exists only while the user is logged in at the
  screen (or through Screen Sharing). When loading fails for any reason, the plist stays, a warning
  says it starts at the next login, and setup exits 0. Removing it runs `bootout`, ignoring "not
  loaded", and deletes the plist. launchd may fail to start the job (exit 78, EX_CONFIG) when Node,
  the bundle or the data folder is on an external volume that a launchd job may not read; then no
  daemon starts at login, and the next `kurmis claude` starts one.
- **Windows:** the `REG_SZ` value `kurmis` under
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, set, read and removed with `reg.exe`
  through `runProgram` (no shell). It needs no admin rights and shows in Task Manager's Startup
  tab. Its data, with full paths, is:
  `<SystemRoot>\System32\wscript.exe //B //Nologo //E:JScript "<data folder>\autostart.js"`
  (each path in quotes when it has a space).
  node.exe is a console program and would flash a console window at logon, so the script, JScript in
  UTF-16 with a byte order mark, sets the start folder and starts node hidden without waiting
  (`shell.Run("<command line>", 0, false)`). The kurmis variables (`KURMIS_HOME` as an absolute
  path, and the test hooks that are set) go on that command line as
  `daemon start --env NAME=VALUE …`, which `daemon start` puts into its own environment and the
  daemon's before it reads any file. `--env` takes only those names. `//B` stops error dialogs at
  logon.
  - *A `%` in the command line.* The command runs as written, or, when the script cannot make it
    so, nothing is started and the next `kurmis claude` starts the daemon. A command line without
    `%` is run as it is.
  - *A `%` in the Run value.* The Run value names `wscript.exe` and `autostart.js` by their full
    paths, and a REG_SZ value has no escape for `%`. Whether Explorer replaces `%NAME%` in a
    REG_SZ Run value is not verified. So when the value has a `%` (in the data folder's path or in
    `SystemRoot`), setup still writes it, warns that the start at login may not work with that
    path, says to use a data folder whose path has no `%` (set with `KURMIS_HOME`), and exits 0
    (`percentWarning`). A `%` only in the script's own command line (Node, the bundle,
    `KURMIS_HOME`) is handled by the script, so it gets no warning. A value with a line break is
    an error (exit 1).
  - *Why JScript.* The Run value starts JScript through wscript, because VBScript is being
    removed from Windows.
  - *When Windows Script Host cannot run it.* Setup checks that `wscript.exe` exists and that
    `Enabled` is not 0 under `Software\Microsoft\Windows Script Host\Settings` (HKCU and HKLM).
    Otherwise it writes no entry and warns, and setup exits 0; the next `kurmis claude` starts
    the daemon anyway.
- **Other platforms:** a warning (setup still exits 0); the next `kurmis claude` starts the
  daemon.

## How a Claude CLI reaches the daemon

`kurmis claude …` starts `claude` with:

- `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`;
- `ANTHROPIC_CUSTOM_HEADERS` carrying the person's own header lines, then the key, the started-on
  login, and the pinned login with `--login`;
- `ENABLE_TOOL_SEARCH=true`, because the CLI turns tool search off for a base URL that is not
  Anthropic's (`src/cli/settings-arg.ts`);
- `CLAUDE_CODE_MAX_RETRIES=15`, so a request outlasts a daemon restart. Each of these two is left
  out when the person already sets it to a value that is not empty, in their `--settings`, the
  user settings file or the environment. Routing works without them, so the person's value
  stays, as `kurmis setup` keeps it in `settings.json`;
- `CLAUDE_SECURESTORAGE_CONFIG_DIR` naming the folder of the login it starts on, or set to the
  empty string on plain claude's login, which the CLI reads as the default credentials, so that
  also a CLI with `CLAUDE_CONFIG_DIR` set signs in as that login;
- `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` removed, because a key would sign the requests
  itself and no subscription would be billed;
- `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` removed, because a token
  of its own would replace the started-on login's credentials.

A value of the two token variables in the `env` of a settings file would beat the process
environment, so the wrapper's `--settings` (below) sets both to the empty string. Claude Code
2.1.306 reads that as unset: it tests `CLAUDE_CODE_OAUTH_TOKEN` for a value that is not empty
wherever it reads it, and takes the same path for an empty
`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` as for an unset one (read from its bundled source).
The wrapper prints one line on stderr for each place that set either to a value that is not
empty: the environment, the user settings file, the person's `--settings` (`oauthTokenNotes` in
`src/cli/commands/claude.ts`).

Claude Code puts the `env` of its settings into its own environment, so a shell in a routed
session has both token variables set to the empty string, and a `kurmis claude` run there says
nothing about them.

**Kurmis' options go before `claude`, claude's after it.** `kurmis [--login <login>] claude …`
passes everything after the word `claude` on, `--help` included, unchanged except for a
`--settings` of the person's, which is merged with kurmis' own (below). A separator such as
`--` would not work: PowerShell drops `--` when it runs npm's `kurmis.ps1`. `--login` takes an
alias or an id. kurmis reads `--login` only before `claude`; after `claude` it is one of claude's
arguments. `dispatch.ts` refuses a `--login` before any other command, a missing value and a
second `--login` (exit 2). The login must be in
`config.json`.

**The login the CLI starts on** (`src/cli/commands/claude.ts`). The wrapper starts the daemon
when it is not running and reads its status. The login claude starts on, pinned or picked on Auto,
must have its folder unless it is plain claude's. On Auto, `autoStartLogin` picks the login: plain
claude's login unless the daemon reports it signed out, otherwise the first signed-in pool login,
or the pool's first login, or plain claude's when there is no pool. Nothing is printed about it.
The CLI needs credentials of its own only to send at all: a CLI that finds none answers "Not
logged in" before it sends anything.

The daemon's status says whether a login is signed in once it has read a token for it or a
probe has answered, and reports it signed out while its token is refused or its sign-in has
expired. Right after the daemon starts, it may have neither for plain claude's login. Then the
wrapper first asks the daemon to probe the logins whose state is unknown and waits for the answer,
at most 15 seconds (`START_PROBE_WAIT_MS`, `withFirstProbe`); the probes
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
as the same login. A running daemon this kurmis can use is used as it is, because the port it
belongs on is in the config. Otherwise, `ensureDaemon` reads the config again, and the start fails
when it still cannot.

**The `env` of `settings.json` beats the process environment, and the `--settings` flag beats
`settings.json`.** Measured with Claude Code 2.1.301 against two local servers. In global mode a
variable the wrapper puts in the process environment is therefore ignored, so the wrapper also
passes its routing variables (`ROUTING_VARIABLES` in `src/cli/settings-arg.ts`) in a `--settings`
argument. `CLAUDE_SECURESTORAGE_CONFIG_DIR` stays in the process environment only.

Claude Code 2.1.301 loads only the last `--settings` before the first `--`, and only when it comes
before a subcommand (`src/cli/settings-arg.ts`).

So the wrapper passes exactly one `--settings`, first, ahead of the person's arguments:

- When the person's arguments carry `--settings` before a `--`, it is merged with kurmis' (kurmis'
  base URL and headers win), their `--settings` arguments are dropped, and their file is never
  changed. Settings that cannot be read, or are not a JSON object, stop the start with a message
  (`src/cli/settings-arg.ts`).
- The merged settings go to claude as a file in the data folder's `settings/`, mode 0600, not
  inline, because they hold the key and a command line is visible to other users in the process
  list. Claude passes its `--settings` value on to processes it starts itself, such as
  background sessions, which can outlive the wrapper. So a file with only kurmis' variables is
  shared by every start with the same values (named after their hash) and kept until no start
  has used it for 30 days. A file with a copy of the person's own settings, which may hold secrets
  of theirs, belongs to one wrapper (`run-<pid>-<random>.json`, so several wrappers at once each
  have their own) and is deleted when claude has ended. A process claude starts with it after that
  cannot start: Claude Code 2.1.306 stops with "Error: Settings file not found: <path>". So a
  background session that claude starts after the wrapper has ended fails when the person passed
  their own `--settings`. The next start removes a file a killed wrapper left, by the pid in its
  name: when that pid no longer runs, or when the file is older than 30 days, in case the pid was
  reused by another program.
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
  `settings-files.json`; when that cannot be written, setup stops before any settings file is
  changed.
- The file is edited as text: only the members of `env` change, and key order, indent, line
  endings and a byte order mark stay as they were. A file that is not plain JSON, or whose top
  level or `env` is not an object, is refused and not written. The message never quotes the file,
  since it may hold a secret (`src/cli/json-error.ts`).
  A symlinked file is written through the link: the link stays, its target gets the change, and
  setup warns that the key is written to that target and names it. A link whose target does
  not exist yet gets that target created, so the link is not replaced by a plain file.
- On Windows a read-only file (its read-only attribute set) is refused with the `attrib -R "<path>"`
  command that clears it, because a rename over a read-only file fails there. A write that fails
  because another program holds the file open is reported as a sentence, not a stack.
- When setup changes an existing file that holds none of kurmis' settings, it first copies it
  to `settings.json.kurmis-backup` (mode 0600), so the backup is the file as it was just before
  kurmis' settings went in, and replaces an older backup. When the file already holds kurmis'
  settings, an existing backup stays; if there is none, one is written, and undo ignores it
  because it holds kurmis' key.
- The file holds the key after setup, so setup makes it readable by the user only: a new file
  gets mode 0600, and an existing one (and an existing backup) has its group and other bits
  cleared, also when setup writes nothing else. Setup says when it changed a mode. On Windows node
  ignores modes, so the file keeps the access list it inherits from its folder
  (`PRIVATE_FILE_MODE` in `src/platform/files.ts`).
- An `ANTHROPIC_BASE_URL` that is not kurmis' (`http://127.0.0.1:<port>` with the port of
  `config.json`, or with an `x-kurmis-key` in the same `env`'s headers) is refused, so another
  proxy is not cut off silently. The person's own `ENABLE_TOOL_SEARCH` or
  `CLAUDE_CODE_MAX_RETRIES` is kept, and setup says so. Their own header lines stay ahead of
  kurmis' lines. A key or token variable in the same `env` (`ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`)
  is kept, with a warning when its value is not empty, since a plain `claude` then sends that key
  or token in place of its login's credentials (`KEY_VARIABLES` in `src/cli/global-settings.ts`).
  The proxy always replaces an `x-api-key`, but forwards the CLI's `authorization` header when it
  has read no token for the started-on login ("Signing" under "The daemon").
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
reported, and only the `x-kurmis-key`, `x-kurmis-login` and `x-kurmis-started-on` lines are taken
out of the custom headers. `ENABLE_TOOL_SEARCH` and `CLAUDE_CODE_MAX_RETRIES` are taken out only
when the same `env` still has kurmis' `ANTHROPIC_BASE_URL` or one of the `x-kurmis-key`,
`x-kurmis-login` and `x-kurmis-started-on` lines, since setup keeps a value the person set for
them. When the header lines left are the ones the backup has, the backup's value comes back;
otherwise the lines left are joined by newlines. A value the backup already had is left. An `env`
that this empties is removed, unless the backup shows the file had an `env` before kurmis. The file
keeps its mode. Putting the settings in and taking them out can each be run again without changing
anything more. Claude Code sessions that are already open keep the settings they started with, so
every command that changes the file says to start them again.

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
every file `settings-files.json` names, and writes `paused.json`. The daemon, its start at login,
the logins and the backups stay, so `kurmis claude` keeps working. A pause with nothing to take out
writes nothing and says global routing is already paused, or not on when there is no
`paused.json`. When a file cannot be changed, the others are
still changed, no `paused.json` is written and the pause exits 1. A file system error that setup
did not expect is reported as a sentence with its code, and the command exits 1. `kurmis setup`
deletes `paused.json` once the settings are back in the file, and replaces the backup with the file
as it is then, which includes what the person changed while routing was paused.

`kurmis setup --uninstall-and-logout` first lists what it will remove: kurmis' settings and backups
in each settings file, the start at login, the logins kurmis added, the other entries of the data
folder's `claude/` folder (deleted without a logout), the running daemon and the data folder. It
says that the login of plain claude is not signed out. At a terminal it then asks, and anything but
`y` or `yes` removes nothing. `--yes` skips the question; without a terminal on stdin and without
`--yes` it refuses. A `config.json` or settings file it cannot read or change stops it before the
list, with nothing removed. Up to there it writes nothing. Then, in this order:

1. Kurmis' settings come out of each settings file, and the backups are deleted. When a file
   cannot be written, nothing else is removed, since the Claude Code that reads it still needs
   the daemon.
2. The start at login is removed (`unregisterAutostart`). On Windows the Run value goes first and
   the script only after it, since a Run value that names a missing script makes wscript show an
   error at every logon. The script is kept when the value cannot be read or deleted
   (`src/platform/windows-autostart.ts`).
3. The daemon is stopped as `kurmis daemon stop` stops it, so it uses no login and probes none
   while they are signed out.
4. Each login kurmis added is removed through the code of `kurmis logout` (`createLoginLogout` in
   `src/cli/commands/logout.ts`). A login whose removal fails stays in `config.json`, with its
   folder, so a second run can try again. Plain claude's login is never signed out. When the logout
   CLI can never finish (for example, it is not installed), the message names `kurmis logout <id>`,
   which removes the login and its folder anyway and may leave the Keychain item or Credential
   Manager record it names. Error messages of this step start with `kurmis setup:`.
5. The data folder is deleted (`removeDataFolder` in `src/data/remove-data-folder.ts`). Only the
   names kurmis gives its files and folders are deleted, through `removeTreeSync`, so a link inside
   is removed and its target is left. A folder that then holds anything else is kept, and its names
   are printed. Stray `.DS_Store`, `Thumbs.db` and `desktop.ini` files do not keep it. A data folder
   that is itself a link is emptied through it, and then the link is removed.

A failed step is reported and the later steps still run, except that the data folder is kept
when the start at login could not be removed, the daemon could not be stopped or a login could
not be removed. The command then exits 1 and says to run it again. When every step worked, its
last line says to run `npm uninstall -g kurmis`.

**Plain claude's login and `CLAUDE_CONFIG_DIR`.** Plain claude's login is
the login in `~/.claude`: the daemon reads its token from the default Keychain item (macOS) or
Credential Manager record (Windows), else `~/.claude/.credentials.json`, its probe runs with
`CLAUDE_SECURESTORAGE_CONFIG_DIR` empty, and `kurmis login` of it runs without `CLAUDE_CONFIG_DIR`.
Claude Code 2.1.306 (read from
its bundled source) takes its credentials from `CLAUDE_SECURESTORAGE_CONFIG_DIR` when that is
set, the empty string meaning the default ones, and otherwise from `CLAUDE_CONFIG_DIR`: the file
in that folder, and a Keychain item named after the variable's value (`keychain-service.ts`). So
a CLI started with `CLAUDE_CONFIG_DIR` set may be signed in to another account than the
login plain claude uses. The daemon is one per user and cannot follow a variable that each
shell sets for itself, so kurmis keeps plain claude's login fixed to `~/.claude` and
makes sure no request is signed as that login for a CLI on other credentials:

- `kurmis claude` on plain claude's login sets `CLAUDE_SECURESTORAGE_CONFIG_DIR` to the
  empty string, so the CLI signs in with that login's own credentials while its settings and
  transcripts still come from `CLAUDE_CONFIG_DIR`. When `CLAUDE_CONFIG_DIR` gives claude
  credentials of its own, it says so on stderr.
- `kurmis setup` from a shell with `CLAUDE_CONFIG_DIR` set writes
  `$CLAUDE_CONFIG_DIR/settings.json`, which only CLIs with that variable read, and those sign in
  with the credentials in that folder. So setup adds `x-kurmis-started-on: none` to the custom
  headers there, and says so. The proxy then signs those CLIs' requests only with extra logins.
- On macOS and Windows any value of `CLAUDE_CONFIG_DIR` counts, the path of `~/.claude` too,
  because the CLI names its Keychain or Credential Manager item after the value. On Linux a
  value that resolves to `~/.claude` is the same file and does not count
  (`configDirHasOwnCredentials` in `src/data/login-env.ts`).
- So on macOS and Windows `kurmis setup` refuses to run while `CLAUDE_CONFIG_DIR` names `~/.claude`
  itself, and says to unset the variable (`namesDefaultClaudeFolder`). The file it would write is
  `~/.claude/settings.json`, which plain `claude` reads too. The two kinds of CLI have different
  credentials, so no `x-kurmis-started-on` in that file is right for both. For the same reason
  setup refuses, on every platform, a `CLAUDE_CONFIG_DIR` whose `settings.json` is a link to
  `~/.claude/settings.json` (`sharesDefaultSettingsFile`). `kurmis setup --pause` and
  `--uninstall-and-logout` still run.
- `kurmis claude` with `CLAUDE_CONFIG_DIR` naming `~/.claude` starts claude on the machine's
  own Claude login's credentials as above, which are the ones a `claude` without the variable
  uses, and its note says that the variable would otherwise give claude a Keychain item (or
  Credential Manager entry) of its own.

## The wrapper

`kurmis claude` and `kurmis login` start claude through `runInteractive` in
`src/cli/wrapper.ts`: `stdio: 'inherit'`, no shell, and the wrapper waits for the child.

For `kurmis claude` the exit code is the child's. A child killed by a signal ends kurmis the same
way, or with 128 plus the signal's number (`finishLikeChild`). `kurmis login` exits 1 when the
sign-in fails or no claude is found. A child that cannot be started gives a message and the code a
shell would give: 127 when there is no such program (also when `findProgram` finds none), 126 when
it cannot be run (EACCES, EPERM, ENOEXEC, EISDIR), 1 otherwise.
The wrapper refuses to start its child (exit 1) when eight wrappers already run inside each other.
That stops a `claude` script of the person's that runs `kurmis claude` from starting kurmis
without end. See `src/cli/wrapper.ts`.

## Windows

- **Never start a `.cmd` or `.bat` shim.** Node will not start one without a shell, and
  through `cmd.exe` the user's arguments can be changed or run. Kurmis finds the real program
  behind the shim instead (below).

**Deleting a folder** (`src/platform/remove-tree.ts`) removes links and junctions as links, and
never recurses into a folder whose real path lies outside the one being removed.

**Finding `claude`** (`src/platform/programs.ts`) checks `KURMIS_CLAUDE_BIN`, then PATH, then the
native installer's `claude.exe`, and reads a package's shim instead of starting it. A `claude.exe`
that is briefly missing during an update is waited for, up to three seconds.

**Reading npm, pnpm and yarn shims** (`src/platform/npm-shim.ts`) reads the line that names the
quoted target and ends in `%*`, expands only the folder variables and `%%` as `cmd.exe` does, and
refuses other forms. A `.js` target runs through the Node the shim names when that file exists,
otherwise through the Node that runs kurmis. An `.exe` target is started directly.

**What the packages contain** (`src/platform/programs.ts`): the bin of `@anthropic-ai/claude-code`
is `bin/claude.exe`, a placeholder until its postinstall step replaces it. When it is still not a
program, kurmis runs the package's `cli-wrapper.cjs` through Node.

## Test hooks

Environment variables that exist only so tests can point kurmis at stand-ins. A person rarely
needs them.

- `KURMIS_HOME` moves the data folder; every test sets it to a temporary folder. A relative one
  is taken from the current folder, and every start of a daemon passes it on as an absolute path
  ("Starting it from the CLI").
- `KURMIS_CLAUDE_BIN` names the program (also usable by a person). `test/setup.ts` points it
  at `test/no-real-program.mjs`, which only fails, so no test can start the real CLI from PATH
  by accident; a test that needs a CLI names a fake. A test of the PATH search sets it to an
  empty value.
- `KURMIS_UPSTREAM_URL` is Anthropic's API base URL, `https://api.anthropic.com` by default.
- **The system programs.** Each program of the operating system that kurmis runs has a
  `KURMIS_*_PROGRAM` variable that names its stand-in; the six are listed in
  `src/platform/system-programs.ts`. A daemon that a test starts inherits them and the test's home
  variables (`inheritedTestHooks`). `test/setup.ts` points them at the fakes under
  `test/daemon/fake-security/` and `test/platform/`. Each fake keeps its records in the folder that
  its `FAKE_*_DIR` variable names.
- **The guard.** `KURMIS_REFUSE_SYSTEM_PROGRAMS=1`, which `test/setup.ts` and the integration
  harness set, makes `runProgram`, `startFrameProcess`, `spawnDetached` and the wrapper refuse
  (`src/platform/system-program-guard.ts`): a program whose file name, or that of the file its
  links lead to, is one of the system programs above, `cmd`, `cscript`, `wmic`, `schtasks`, `pwsh`,
  `claude`; a program inside the Claude Code npm packages or the native installer's
  `~/.local/share/claude/versions`; and Node running a script that is one of these, such as
  `node …/@anthropic-ai/claude-code/cli.js`, which is how a `claude` on PATH that links to a
  `.js` file is started. It is passed on to every program kurmis starts, together with
  `TEST_HOME_VARIABLES` from the process's environment where that program's environment lacks
  them. Each refusal is also written to the file `KURMIS_REFUSED_PROGRAMS_LOG` names, and
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
`createDaemonApp`'s `tuning` option shortens the daemon's timings and replaces its probe, platform
and random source in tests.

**Integration tests.** `test/integration/` runs the real bundle as `node <bundle> …` processes,
end to end, against the fake claude and Anthropic API. `createWorld` in
`test/integration/harness.ts` gives each test its own temporary HOME, data folder, free port,
fake API, and fake Keychain, launchctl and registry folders. It builds the children's
environment from nothing, so only the fakes and the stand-ins of `test/setup.ts` can be reached.
After each test the harness runs `kurmis daemon stop`, and kills a daemon that still runs only
when it is shown to be the test's (`OwnDaemons` in `test/daemon/own-daemons.ts`). The daemon
process tests in `test/cli/` stop their daemons the same way.

**Tests on Windows.** The suite is meant to pass on Windows too. `test/host.ts` has the link
helpers (`linkFolder`, `canCreateSymlinks`). Removing temporary folders retries (`maxRetries`),
because Windows will not delete a file that is still open.

## Known limits

- **One user per machine.** The daemon listens on one known port (28411 unless `config.json` sets
  another), and any local program that binds it before the daemon does receives what the CLIs send
  there: the key in `x-kurmis-key` and, in global mode, the CLI's own `Authorization` header.
  Kurmis assumes nobody else runs programs on the machine.
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
  variable.** On macOS and Windows, setup writes `~/.claude/settings.json` with no
  `x-kurmis-started-on`, so the proxy counts every plain `claude` that reads it as started on
  plain claude's login. `kurmis setup` refuses to run while the variable names `~/.claude`. One
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
  starts, so such a daemon gets no token from a Keychain item. Its Keychain search list holds
  only the System keychain, so a read of a login's item exits 44, the same as an item that is
  not there, and the daemon goes on to the login's `.credentials.json`. The daemon checks for
  this once at its start with `security show-keychain-info login.keychain`, which shows no
  dialog: when that fails it logs `keychain_unreadable`, and `kurmis status` warns with the
  reason (`keychainProblem` in the status answer). With `kurmis setup` run at the screen, the
  login item starts the daemon in the GUI session and ssh sessions use it. A newer kurmis replaces
  an older daemon from wherever it runs, so after an update the first command over ssh that starts
  the daemon leaves a daemon that cannot read the Keychain.
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
  more as it stops if it has a change not yet in the file, and a change the new one made before
  that is lost from the file (not from the new daemon's memory) until the new daemon writes again.
- **What counts as a usage limit.** A 429 counts as a usage-limit refusal when its
  `anthropic-ratelimit-unified-status` is `rejected` or it carries
  `anthropic-ratelimit-unified-representative-claim` or `anthropic-ratelimit-unified-overage-status`
  (`isDefinitiveQuotaRejection`). Any other 429 is treated as no capacity. This
  has not been checked against a real usage-limit 429 from Anthropic yet.

## Code layout

- `src/data/` holds the data folder: its paths, login ids (`login-id.ts`), the JSON file
  helpers, value checks for the JSON files (`validate.ts`), the stores for `config.json`,
  `state.json` and `daemon.json` (`daemon-file.ts`, which keeps `key` as well as `daemon.json`),
  the lock file around `config.json` changes (`lock.ts`), the Claude profile reader
  (`identity.ts`), the environment for `claude auth …` and the probes (`login-env.ts`), the log
  writer, and the removal of the whole folder (`remove-data-folder.ts`). Both the CLI and the
  daemon use it.
- `src/core/` holds pure logic with no I/O: routing, usage parsing, limits.
  - `accounts.ts`, `login-alias.ts`: login ids, aliases, and the defaults for a new login.
  - `account-router.ts`, `proxy-rules.ts`, `capacity-hold.ts`, `route-headers.ts`,
    `routed-env.ts`: which login serves a request, the proxy's decisions, and the headers.
  - `control-api.ts`: the control API's paths and answers, shared by the CLI and the daemon.
  - `claude-usage.ts`, `usage.ts`, `usage-rules.ts`, `countdown.ts`: usage snapshots, parsing,
    the rules over the windows, and the "how long until" text.
  - `credentials.ts`, `keychain-service.ts`: the `.credentials.json` format and the Keychain
    item name.
- `src/daemon/` holds the proxy, the control API, the token readers (`credentials.ts` for the
  file, `keychain.ts` for the macOS Keychain, `credential-manager.ts` for Windows Credential
  Manager, put together in `tokens.ts`), the usage probes and the daemon's lifecycle. `app.ts`
  handles requests and `main.ts` is the process. `logins.ts` is the login table and `upstream.ts`
  the HTTP client to Anthropic. `lifecycle.ts` holds the keyed control request, the port-holder
  check and the version comparison; the CLI uses it too.
- `src/cli/` holds the commands and the wrapper. `main.ts` is the bundle's entry and
  `dispatch.ts` picks the command and handles `--login`, `--help`, `--version` and
  `help <command>`. `wrapper.ts` runs an interactive child, `settings-arg.ts` builds claude's
  `--settings`, `global-settings.ts` edits the user settings file for `setup`,
  `global-routing.ts` answers whether global routing is on, paused or off and keeps
  `settings-files.json`, `local-credentials.ts` checks whether a login's credentials are on this
  machine, `status-format.ts` renders `status`, `daemon-client.ts` reaches the daemon,
  `sign-out.ts` signs an extra login out with `claude auth logout`, `json-error.ts` names where a
  settings file stops being JSON without quoting its text, and `login-lock.ts` is the per-login
  lock. Each command is one module in `src/cli/commands/` exporting a `Command`
  (`src/cli/command.ts`), whose `run` returns the exit code: 0 done, 1 failed, 2 wrong command
  line, or the child's code for `claude` (`login` also ends the way claude did when claude is
  killed by a signal). `commands/index.ts` is the command list, in `--help` order. Most also export
  a `create<Name>Command(deps)`, which takes fakes of what the command reaches outside itself (the
  daemon client and the child runner in `command-deps.ts`; `findProgram` is in each command's own
  deps), so unit tests run without a daemon or a real CLI. What the commands do is in the README
  and in the header comment of each module; "The commands" below has what those do not say.
- `src/version.ts` holds the version, which the build takes from `package.json` with the build time
  appended (`0.1.0+20261023120000`). The appended time lets a newer build of the same version
  replace the running daemon; code run from source reports `dev`.
- `src/platform/` holds what differs per OS: finding programs and reading npm shims
  (`programs.ts`, `npm-shim.ts`), deleting a folder without following its links
  (`remove-tree.ts`), detaching (`detach.ts`), the launchd login item (`launchd.ts`), autostart
  (`autostart.ts`, `windows-autostart.ts`), reading Windows Credential Manager
  (`windows-credentials.ts`), the system programs and the variables that name their test
  stand-ins (`system-programs.ts`), `system-program-guard.ts`, which refuses real programs during
  tests, and the file rename retry and file modes (`files.ts`). Every short-lived program kurmis
  starts goes through `runProgram` in `run.ts`, except the `taskkill` that ends a usage probe on
  Windows: no shell, stdin closed, a deadline and a cap on the output. The usage probes, whose
  stdin carries JSON frames, go through `startFrameProcess` in `frame-process.ts`: no shell, a
  deadline, a cap on each frame and on all output, and a kill that takes the program's child
  processes with it (its process group on macOS and Linux, `taskkill /T /F` on Windows).
- `test/` mirrors `src/`. `test/fakes/` holds stand-ins for `claude` and Anthropic's API.
  `test/daemon/fake-security/` stands in for macOS's `security` program, with its Keychain
  items in a temporary folder. No test reaches the network or the user's real `~/.claude` or
  Keychain.

## The commands

`kurmis claude` and `kurmis setup` are described above.

**`kurmis status`** never starts the daemon and exits 0 whether a daemon runs or not, and 1 when it
cannot read `config.json`.

- When a daemon answers with this kurmis' control API version, the logins come from its status
  answer. When no login that may be signed in has usage yet, status asks the daemon to probe the
  logins and waits up to 15 seconds. Then it ends the request and closes its connection, so the
  command exits at once while the daemon finishes the probe. An older daemon is shown as it is;
  status replaces nothing.
- Without a daemon answer in this control API version, the logins come from `config.json` and
  `state.json`, and each login's email from its profile files. Each login then shows whether its
  token is on this machine, or `unknown` when a check cannot run (`checkCredentials` in
  `src/cli/local-credentials.ts`). On macOS a no is asked again of the keychains that
  `security list-keychains -d user` names, which covers ssh sessions. A `.claude.json` that names
  an account does not count, and status never starts `claude` for this. The "passed over" lines
  are left out then.
- **The same account.** Logins are the same account when their emails match (case aside) and
  their organization uuids match, or when the emails match and either has none
  (`isSameClaudeAccount` in `src/data/identity.ts`). Plain claude's login is compared first, and
  the warning names the `kurmis logout` for the later one.

**`kurmis login`** (`login.ts`)

- A new login's folder is `claude/<id>/` from the start, because its path names its Keychain item.
- The run holds the login's lock (`locks/`) until it ends.
- A sign-in counts when the CLI exits 0 and an account or credentials are there. Otherwise a folder
  this run created is removed. On Windows a login whose record is already in Credential Manager
  signs in with `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`, so the new token replaces the record.
- A running daemon is then told to reload and to probe the login, for up to 15 seconds.

**`kurmis logout`** (`logout.ts`) takes the login out of `config.json`, tells a running daemon to
reload, runs `claude auth logout` with a 30-second deadline, and deletes the folder. On Windows the
sign-out needs `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`, or the record stays in Credential Manager. A
failed sign-out is a warning that names what may be left, and the removal goes on.
`setup --uninstall-and-logout` uses the same removal (`createLoginLogout`).

**`kurmis daemon status`** exits 1 when no daemon runs.

## `kurmis status --json`

`kurmis status --json` prints its own shape, not the control API's answer, so it can stay
stable while the daemon's usage snapshot changes. Times are ISO strings. The current format is
7. Fields may be added without changing it; removing a field or changing its meaning raises it
(`STATUS_JSON_FORMAT` in `src/cli/status-format.ts`).

```json
{ "format": 7,
  "daemon": { "version": "0.1.0+20261023120000", "pid": 4242, "port": 28411,
    "startedAt": "<ISO>", "older": false, "newer": false },
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
  the plan. The server can report a model's weekly window twice (for example `seven_day_opus` and
  `Opus`), and `windows` and the text leave out the copy with the same figure and reset as the
  fixed window (`repeatsModelWindow` in `src/core/usage-rules.ts`).
- `blocked` is null when Auto could use the login. `blocked.text` gives a cooldown's end as an
  ISO time.
- `warnings` holds a sentence for each login that is the same account as another login, one
  when `globalRouting` is `on` and `daemon` is null, and, when the logins come from the daemon,
  one when the daemon cannot read the login Keychain on macOS.
