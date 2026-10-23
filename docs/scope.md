# What kurmis does

Kurmis lets one person use several Claude Code subscription logins on one machine.

## Platforms

macOS and Windows. Windows has to work at a basic level and is tested on a real Windows
machine after each larger change. Linux works where it costs nothing extra.

## Logins

- **The login plain `claude` uses.** The account a plain `claude` is signed in to is always a
  login of kurmis. It follows whatever that CLI is signed in to, and kurmis never signs it out.
  Every other login is an extra login, added with `kurmis login`.
- **Names.** Each login has a random id that never changes, and an alias that the person sees
  and types. Kurmis makes the alias from the account's email, as soon as it knows the email, so
  `work@example.com` becomes `work-example`. The person can set an alias of their own instead.
- **One login per account.** Signing in to an account that is already a login adds nothing, and
  kurmis says which login it is. `kurmis status` warns when two logins are the same account,
  because both then use one subscription. An account is its email and its organization: one
  email with a personal plan and a Team or Enterprise seat has two subscriptions, so it is two
  logins. When the organization of either login is not known, the email alone decides.
- **Credentials only.** Each extra login keeps only its credentials in a folder of its own. A
  CLI started on it gets `CLAUDE_SECURESTORAGE_CONFIG_DIR` and nothing else, so settings,
  CLAUDE.md, skills, plugins and transcripts stay those of `~/.claude`. The only thing a login
  changes is which subscription is billed.

## Routing

One background process per user runs an HTTP proxy on the loopback address. `kurmis claude`
and `kurmis setup` start it when it is not running. A Claude CLI reaches it through
`ANTHROPIC_BASE_URL`. That includes IDE extensions, through `settings.json`. For each request
the proxy picks a login and signs the request with that login's token.

- **The pool.** Only logins opted in to routing are used. A login is used only while its
  five-hour window is under its five-hour limit and its weekly windows are under its weekly
  limit. Both limits default to 100%. When no login is opted in, every request goes to the
  login plain `claude` uses.
- **The order.** A login marked "use first" comes first whenever it is in the pool. Otherwise a
  session that is being placed goes to the login whose weekly window resets soonest.
- **Staying.** After that, a session stays on the login that served it while that login is
  still in the pool, unless a "use first" login can take it and its own is not marked.
  Anthropic keeps the prompt cache per login, so a switch makes the next request write the
  whole conversation to the cache again.
- **Usage limits.** A request refused with a usage-limit 429 is sent again on another login
  before the CLI sees anything. The refused login is skipped until its reset.
- **Overload.** A 529, or a 429 without usage-limit headers, is retried with backoff on the
  logins the session may use, for up to about two minutes.
- **An exhausted pool.** When every login is out, the CLI gets the answer a single account that
  has run out would give, and behaves as it always does at a limit.
- **Pinning.** A session started on one named login stays on it, even when that login is out of
  usage.

## Tokens and usage

- **Tokens** are read from the macOS Keychain, or from the login's `.credentials.json` on
  Windows and on a Mac whose Keychain has none for it. On Windows, Windows Credential Manager
  is read before that file, as the CLI does. They are never stored anywhere else. When a token
  is about to expire, kurmis starts a short-lived `claude` on that login and lets the CLI renew
  it, rather than calling the OAuth endpoint itself.
- **Usage** comes from a `get_usage` request to a short-lived `claude`, and from the
  `anthropic-ratelimit-unified-*` headers on every answer the proxy forwards.

## Commands

- `kurmis claude …` starts the CLI with the terminal attached, passes Ctrl-C on, and exits with
  the CLI's exit code.
- `kurmis status`, with `--json`, shows every login with its settings and usage, whether the
  background process runs, and whether global routing (`kurmis setup`) is on, paused or off. It
  never starts the background process and changes no setting. It only adds the login of plain
  `claude` to `config.json` when the file has none, and removes a `daemon.json` that is damaged
  or names a process that is gone. While the background process is not running, the usage shown
  is the last it read.
- `kurmis login` and `logout` manage logins, and `kurmis set` changes a login's routing opt-in,
  limits, use-first and alias. Every command takes a login by its alias or its id.
- `kurmis setup` routes a plain `claude` and the IDE extensions through kurmis by editing the
  user settings file (`~/.claude/settings.json`, or the one in `CLAUDE_CONFIG_DIR`).
  `kurmis setup --pause` takes kurmis' settings out of every settings file setup changed and
  keeps the rest. `kurmis setup --uninstall-and-logout` removes everything kurmis set up, signs
  out every login added to kurmis and leaves the login plain `claude` uses alone.
- There are also commands to start and stop the background process and show its state.
  `kurmis daemon stop --now` stops it without waiting for its open requests.

## Not in kurmis

Kurmis does not do these things:

- any CLI other than Claude Code;
- lending a login to another machine;
- pausing a session at a limit and continuing it after the reset;
- a graphical interface: kurmis has only its command line;
- usage history.
