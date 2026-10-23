# Test fakes

Stand-ins for `claude` and Anthropic's API, so tests never reach the network, the real
`~/.claude` or the Keychain. Import the helpers from `test/fakes/index.ts`.

- `anthropic.ts`: an in-process HTTP server on `127.0.0.1` standing in for the Messages API.
- `claude/fake-claude.js` and `claude.ts`: the fake `claude` and its helpers.
- `launcher.ts`: writes a launcher so a fake can be found on `PATH` by the real program's name.

The fake claude is plain ESM JavaScript because tests start it as a child process. Node 22,
kurmis' minimum, cannot run a `.ts` file without a flag, and a launcher or a daemon that starts
`claude` should not need to know about one. It imports every Node global it uses other than
`process`, `console`, `Buffer` and `URL`, so eslint's `no-undef` passes with the shared config.
tsc does not check it.

## Starting a fake

Run the fake as `[process.execPath, FAKE_CLAUDE_SCRIPT, ...args]`, or put it on `PATH`:

```ts
const claude = installFakeClaude(binDir) // { path, script, command }
spawn('claude', ['--version'], { env: { ...env, PATH: `${binDir}${delimiter}${env.PATH}` } })
```

On POSIX the launcher is `<binDir>/claude`, a shell script that runs the fake with the Node that
runs the tests. On Windows it is `<binDir>\claude.cmd`, which only a test that goes through
`cmd.exe` itself can use; kurmis never starts `.cmd` shims (docs/architecture.md, "Windows").

Kurmis does not start the launcher either. While the guard `test/setup.ts` turns on is set
(`src/platform/system-program-guard.ts`), kurmis refuses every program whose file name is
`claude`, the launcher included, and the test fails. So a test that has kurmis start the fake
names the fake's script in `KURMIS_CLAUDE_BIN` (a `.js` file, which kurmis runs through Node, on
every OS). The launcher is for tests that start it themselves, and for tests of how kurmis finds
a program on PATH that do not start it. A real `claude.exe` cannot be faked without building a
Node single-executable application, which these fakes do not do.

## Fake Anthropic API

```ts
const api = await startFakeAnthropic() // { url, port, requests, apiRequests(), script, scriptFor, setDefault, waitForRequests, reset, close }
api.scriptFor(fakeToken('one'), reply.quota({ claim: 'five_hour', resetsAt: Date.now() + 3_600_000 }))
api.script(reply.overloaded(), reply.ok({ text: 'Hi' }))
// ... run the code under test against api.url ...
expect(api.apiRequests().map((r) => r.bearer)).toEqual([fakeToken('one'), fakeToken('two')])
expect(api.requests.every((r) => r.headers['x-kurmis-key'] === undefined)).toBe(true)
await api.close()
```

**Choosing a reply.** Each request other than `/api/hello` takes the next reply from the queue of
the token that signed it (`scriptFor`, matched on the bearer token or `x-api-key`), then from the
shared queue (`script`), then the default (`setDefault`, initially `reply.ok()`). A reply can
also be a function of the recorded request.

**`/api/hello`** is always answered 200, with no body for `HEAD`, and does not take a reply from
any queue. Any path outside `/v1/` is answered 404.

**Replies** (`reply.*`, every one also takes `delayMs`, extra `headers`, and `hold`, a promise the
answer waits for, so a test decides when it is sent):

- `ok({ text, model, unified, usage, eventDelayMs })`: 200. A streaming `/v1/messages` request
  gets the real event order: `message_start`, `content_block_start`, `ping`, one
  `content_block_delta` per 16 characters, `content_block_stop`, `message_delta`, `message_stop`.
  A non-streaming one gets the message as JSON. `count_tokens` and `/v1/models` get small JSON
  answers. `unified` sets the rate-limit headers (default: five-hour at 0.1 and weekly at 0.05,
  both `allowed`). Null sends none.
- `quota({ claim, resetsAt, retryAfter })`: the usage-limit 429. It carries
  `anthropic-ratelimit-unified-status: rejected`, `-representative-claim: <claim>`, `-reset`
  (unix seconds), the window's own `-<5h|7d|7d_oi>-status/-reset/-utilization`, and
  `-overage-status: rejected` with `-overage-disabled-reason: org_level_disabled`. The body is
  `{type: "error", error: {type: "rate_limit_error", ...}}`. `resetsAt: null` leaves out the
  reset headers.
- `rateLimited({ retryAfter })`: a 429 with no `anthropic-ratelimit-unified-*` header, which the
  CLI retries.
- `overloaded({ retryAfter })`: 529 `overloaded_error`.
- `unauthorized({ message })`: 401 `authentication_error`.
- `serverError(status = 500)`: `api_error`.
- `raw(status, body)`: exactly that.
- `hang()`: never answers. `drop()`: closes the connection without an answer.

Every answer also has a `request-id` and an `anthropic-organization-id` (made up).
`unifiedHeaders({ fiveHour, sevenDay, sevenDayOverageIncluded, status, representativeClaim, overageStatus })`
builds the rate-limit headers on their own. Utilization is a 0 to 1 fraction and resets are unix
seconds, as the real API sends them.

**Recorded requests** have `seq`, `method`, `url` (with the query), `path`, `headers` (lower-case
names), `bearer`, `apiKey`, `sessionId` (`x-claude-code-session-id`), `body` (gunzipped when
compressed), `json` and `answeredWith: {kind, status}`. They stay in memory.
`waitForRequests(n)` resolves once `n` requests other than `/api/hello` have been answered or
are being answered.

## Fake claude

**`claude --version`** prints `2.1.301 (Claude Code)`.

**Where the login is.** The credentials file is `.credentials.json` in the first set one of
`CLAUDE_SECURESTORAGE_CONFIG_DIR` (empty means `~/.claude`) and `CLAUDE_CONFIG_DIR`, else
`~/.claude`. There is no fallback to the next folder, as in the real CLI. `~` is
`os.homedir()`, so `HOME` (or `USERPROFILE` on Windows) moves it. The email and organisation come
from `oauthAccount` in `.claude.json`: `$CLAUDE_CONFIG_DIR/.claude.json`, or `~/.claude.json`.
That means a login given only `CLAUDE_SECURESTORAGE_CONFIG_DIR` reports the identity of
`~/.claude.json`, or null fields when there is none, as the real CLI does. The fake never reads
the Keychain.

`writeClaudeCredentials(dir, overrides)` writes a credentials file in the real shape
(`claudeAiOauth: {accessToken, refreshToken, expiresAt, refreshTokenExpiresAt, scopes,
subscriptionType, rateLimitTier}`). `refreshToken: null` leaves it out, so the token is never
renewed. `writeClaudeIdentity(file, { email, ... })` writes `oauthAccount`.
`readClaudeCredentials(dir)` reads the file back. `fakeToken(label)` makes
`sk-ant-oat01-fake-<label>`.

**The environment** the fake acts on is the process environment, then the `env` block of the
config folder's `settings.json`, then the `env` block of `--settings` (a JSON string or a file
path). Each beats the one before, as docs/architecture.md describes for the real CLI.

**`claude auth status [--json]`** prints `{loggedIn, authMethod, apiProvider,
analyticsDisabled, projectsDirectory, email, orgId, orgName, subscriptionType}` with a two-space
indent and exits 0. With no credentials it prints `loggedIn: false` without the identity fields
and exits 1. Without `--json` it prints one line, whose wording is made up.

**`claude auth login`** prints the real three lines (the last, `Paste code here if prompted > `,
has no newline), writes a made-up login into the credentials folder and `oauthAccount` into
`.claude.json`, and prints `Login successful.`. `--email`, `FAKE_CLAUDE_EMAIL`,
`FAKE_CLAUDE_SUBSCRIPTION`, `FAKE_CLAUDE_ACCOUNT_UUID`, `FAKE_CLAUDE_ORG_ID` and
`FAKE_CLAUDE_ORG_NAME` set what it writes. `FAKE_CLAUDE_LOGIN=fail` makes it exit 1 instead.
**`claude auth logout`** deletes the credentials file.

**Stream-json** (`--input-format stream-json`) reads one JSON frame per line, as the daemon's
usage probe sends them, and answers `control_request` frames with
`{type: "control_response", response: {subtype: "success", request_id, response}}` (or
`subtype: "error"` with `error`):

- `initialize` answers a short version of the real handshake (`models`, `account`,
  `session_state: "idle"`, `claude_code_version`, ...).
- `get_usage` answers `{session, subscription_type, rate_limits_available, rate_limits,
  behaviors}`. The windows are percentages with ISO `resets_at`: by default five-hour 42 %,
  seven-day 13 %, seven-day Opus 4 %, plus a disabled `extra_usage`, an empty `limits` and one
  `model_scoped` entry. A login with no credentials, a failed renewal or no `user:profile` scope
  answers `rate_limits_available: false, rate_limits: null`.
- `interrupt` answers `{}`. Any other subtype is answered with an error.
- A user message is answered with an error `result`, because the fake runs no turns.
- When stdin ends it finishes the answers it is working on and exits 0.

**Token renewal.** Before `get_usage` and before a `-p` request, a token that expires within five
minutes is renewed when a refresh token is stored, as the real CLI does. The fake makes no OAuth
call. It writes `<old token>-renewed` (and `<old refresh token>-renewed`) with eight more hours
into the credentials file, through a temporary file and a rename. A 401 to a `-p` request also
renews once and sends again.

**`-p <prompt>`** (the prompt may also come on stdin) does what the real CLI does on the wire:

1. It refuses to start (exit 2) unless `ANTHROPIC_BASE_URL` is `http://` on `127.0.0.1`,
   `localhost` or `[::1]`. Without credentials it prints `Not logged in · Please run /login`
   and exits 1.
2. It sends `HEAD /api/hello` with only a `user-agent`, none of the custom headers.
3. It sends `POST /v1/messages?beta=true` with `stream: true` and the headers `Authorization:
   Bearer <accessToken>`, `anthropic-version`, `anthropic-beta` (with `oauth-2025-04-20` when
   the login has the `user:inference` scope), `anthropic-dangerous-direct-browser-access`,
   `x-app: cli`, `user-agent: claude-cli/<version> (external, cli)`,
   `X-Claude-Code-Session-Id` (from `--session-id`, `--resume`, or a new uuid), and last the
   `Name: value` lines of `ANTHROPIC_CUSTOM_HEADERS`. `ANTHROPIC_AUTH_TOKEN` signs as a bearer
   instead, and `ANTHROPIC_API_KEY` as `x-api-key`. The body's `metadata.user_id` holds
   `account_uuid` from `oauthAccount`.
4. It prints the streamed text and exits 0.

Retries follow the real CLI loosely. A 529, a 5xx, a 408, a 409, a 429 without usage-limit
headers and a failed connection are retried up to `CLAUDE_CODE_MAX_RETRIES` times (default 10,
at most 15). The first wait is `retryDelayMs` (10 ms), doubling up to 32 times that. A
`retry-after` over 60 seconds ends the retries. A 429 that carries
`anthropic-ratelimit-unified-status: rejected`, a representative claim or an overage status is
final at once for an OAuth login (an API key login retries it).

The final error is printed on stdout with exit 1:

- **A usage limit:** `You've hit your session limit · resets 2:10pm (Europe/Berlin)` for
  `five_hour`, `weekly` for the seven-day claims (with `Jan 2, ` before the time when the reset
  is more than a day away), `Opus` for `seven_day_opus`. With no claim or reset:
  `You've hit your usage limit.`
- **529:** `API Error: Repeated 529 Overloaded errors`.
- **429:** `API Error: Request rejected (429) · <message>`.
- **401:** `Failed to authenticate. API Error: 401 <body> · Please run /login`.
- **No connection:** `API Error: Connection error. (<code>)`. Any other status:
  `API Error: <status> <body>`.

`--output-format json` prints one `result` object instead (`is_error`, `result`, `session_id`,
`terminal_reason: "api_error"` and `api_error_status` on an error). `--model` takes `sonnet`,
`opus`, `haiku` or a full model id.

**Any other start** (an interactive session) prints one line and exits with `exitCode` after
`holdMs`. Ctrl-C (SIGINT) while held exits 130 and SIGTERM exits 143.

### Scripting the fake claude

The scenario is built from, in rising order: the single `FAKE_CLAUDE_*` variables, the JSON file
`FAKE_CLAUDE_SCENARIO` names, and `fake-claude-scenario.json` in the login's credentials folder
(`writeClaudeScenario(dir, scenario)`). The per-login file is how one test scripts several
logins when the daemon starts the fakes itself with one shared environment. Files are read at
start. Objects are merged key by key.

| Scenario key | Variable | What it does |
|---|---|---|
| `fiveHour`, `sevenDay`, `sevenDayOpus`, `sevenDaySonnet` | `FAKE_CLAUDE_USAGE_FIVE_HOUR`, `FAKE_CLAUDE_USAGE_SEVEN_DAY` | A window of the `get_usage` answer: a percentage, `{utilization, resetsAt}` (ISO or null), or null. |
| `usage` | | Merged over the whole `get_usage` answer, for example `{subscription_type: "team"}`. |
| `getUsage` | `FAKE_CLAUDE_GET_USAGE` | `answer` (default), `error` (answers `Failed to fetch usage` as an error) or `hang` (never answers). |
| `usageDelayMs` | `FAKE_CLAUDE_USAGE_DELAY_MS` | Waits before answering `get_usage`. |
| `startupDelayMs` | `FAKE_CLAUDE_STARTUP_DELAY_MS` | Waits before doing anything (after `--version`). |
| `startupFailure` | `FAKE_CLAUDE_STARTUP_FAILURE` | Exits 1 at start with this line on stderr. |
| `renew` | `FAKE_CLAUDE_RENEW` | `auto` (default, as described above), `always` (on every use), `never`, or `fail` (a due renewal fails and the fake acts as logged out). |
| `renewTo` | | `{accessToken, refreshToken, expiresInMs}` for what a renewal writes. |
| `retryDelayMs` | `FAKE_CLAUDE_RETRY_DELAY_MS` | The first wait between retries. Default 10. |
| `retryAfterScale` | `FAKE_CLAUDE_RETRY_AFTER_SCALE` | Above 0, waits out `retry-after` scaled by this (0.001 turns a second into a millisecond). Default 0: not waited out. |
| `exitCode` | `FAKE_CLAUDE_EXIT_CODE` | Exit code of an interactive start. |
| `holdMs` | `FAKE_CLAUDE_HOLD_MS` | How long an interactive start stays up. |

`FAKE_CLAUDE_VERSION` changes the version and `FAKE_CLAUDE_DEVICE_ID` the `device_id`.

### What the fake claude records

`FAKE_CLAUDE_RECORD=<file>` appends one JSON line per event, each with `t`, `pid` and `kind`.
`readFakeClaudeRecord(file)` reads them back.

- `start`: `argv`, `cwd`, `credentialsDir`, and `env` and `effectiveEnv` (after the settings
  layers) holding `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`,
  `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `CLAUDE_CONFIG_DIR`, `ENABLE_TOOL_SEARCH`,
  `CLAUDE_CODE_MAX_RETRIES`, `HOME`, `USERPROFILE` and `KURMIS_HOME` when set.
  `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are recorded only as `<set>`.
- `hello`, `request` (with the headers it sent and the status), `retry`, `renew`, `result`.
- `control_request` (the subtype), `user_message`, `login`, `logout`, `signal`, `exit`.

A token is written only when it looks like a fake one (`sk-ant-<kind>-fake-...`). Any other token
is replaced with its length.

`runFakeClaude(args, { env, replaceEnv, input, cwd })` runs the fake once and returns
`{code, signal, stdout, stderr}`.
