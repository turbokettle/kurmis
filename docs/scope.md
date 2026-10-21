# What kurmis does

Kurmis lets one person use several Claude Code and Codex subscription logins on one machine.
It follows the account routing of the original router, but has no dependency on it. the original router is a
private tool, and kurmis exists so that someone without it can do the same.

## Platforms

macOS and Windows. Windows has to work at a basic level and is tested on a real Windows
machine after each larger change. Linux works where it costs nothing extra.

## Logins

- **Claude:** each extra login keeps only its credentials in a folder of its own. A CLI started
  on it gets `CLAUDE_SECURESTORAGE_CONFIG_DIR` and nothing else, so settings, CLAUDE.md, skills,
  plugins and transcripts stay the machine's own. The only thing a login changes is which
  subscription is billed.
- **Codex:** the CLI has one variable, `CODEX_HOME`, and it moves the whole folder. So each login
  has its own home. Before every start, `config.toml` is merged in from `~/.codex` without its
  secrets. TOML types are kept, and so are the comments in the login's own file; comments in
  `~/.codex/config.toml` are not carried over. `AGENTS.md` is copied in, and the folders of
  `~/.codex` are linked in: a symlink on macOS, a directory junction on Windows. Scratch folders
  (`tmp`, `.tmp`), links and anything whose name says it holds a credential or a database are
  not linked. `auth.json` is never copied or linked.

## Claude routing

One background process per user runs an HTTP proxy on the loopback address. The `kurmis` CLI
starts it when it is not running. A Claude CLI reaches it through `ANTHROPIC_BASE_URL`. That
includes IDE extensions, through `settings.json`. For each request the proxy picks a login and
signs the request with that login's token.

- **The pool.** Only logins opted in to routing are used. A login is used only while its
  five-hour window is under its five-hour limit and its weekly windows are under its weekly
  limit. Both limits default to 100%.
- **The order.** A login marked "use first" comes first. Otherwise a session that is being
  placed goes to the login whose weekly window resets soonest.
- **Staying.** After that, a session stays on the login that served it while that login is
  still in the pool. Anthropic keeps the prompt cache per login, so a switch makes the next
  request write the whole conversation to the cache again.
- **Usage limits.** A request refused with a usage-limit 429 is sent again on another login
  before the CLI sees anything. The refused login is skipped until its reset.
- **Overload.** A 529, or a 429 without usage-limit headers, is retried with backoff on the
  logins the session may use, for up to about two minutes.
- **An exhausted pool.** When every login is out, the CLI gets the same answer it would get
  from a single account that has run out. It then behaves as it always does at a limit.
- **Pinning.** A session started on one named login stays on it, whatever its limits say.

## Tokens and usage

- **Tokens** are read from the macOS Keychain or from `.credentials.json` on Windows. They are
  never stored anywhere else. When a token is about to expire, kurmis starts a short-lived
  `claude` on that login and lets the CLI renew it, rather than calling the OAuth endpoint
  itself.
- **Claude usage** comes from a `get_usage` request to a short-lived `claude`, and from the
  `anthropic-ratelimit-unified-*` headers on every answer the proxy forwards.
- **Codex usage** comes from `codex app-server`, through `account/rateLimits/read`.

## Commands

- `kurmis claude …` and `kurmis codex …` start the CLI with the terminal attached, pass Ctrl-C
  on, and exit with the CLI's exit code.
- `kurmis status`, with `--json`, shows each login's usage.
- `kurmis login`, `logout` and `list` manage logins.
- There are also commands to start and stop the background process and show its state.

## Not in kurmis

These the original router features are left out because they depend on the rest of the original router:

- lending a login to another machine;
- pausing a session at a limit and continuing it after the reset;
- the sign-in UI and the phone usage screen;
- rewriting the CLI's boilerplate text;
- usage history.
