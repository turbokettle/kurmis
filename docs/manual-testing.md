# Testing kurmis by hand

`pnpm test` covers what the fakes in `test/fakes/` can show. This list is the rest: what needs
a real Claude Code or Codex, a real sign-in, the Keychain or Credential Manager, launchd, the
Windows registry, or a real terminal. Run it after larger changes, on macOS and on Windows.

Each check says what to do and what should happen. When something else happens, note the
command, what it printed, and the matching lines of `daemon.log` (in the data folder). The log
never holds tokens or request bodies, so it can be shared.

## Before you start

- **Install from the commit under test:** `npm i -g git+ssh://git@github.com/turbokettle/kurmis.git#<commit>`,
  or `npm i -g git+file://<path to a clone>`. `kurmis --version` should answer.
- **Use a scratch data folder and port** when the machine already runs kurmis or another tool on
  port 28411: set `KURMIS_HOME` to an empty folder and, after the first command has written
  `config.json` there, change its `port` and run `kurmis daemon restart`.
- **Keep requests small.** Use `--model haiku` and one-line prompts, so the tests use almost
  none of a subscription.
- **`kurmis setup` changes every Claude Code on the machine.** Run it only on a machine where
  that is fine, or with `HOME` (Windows: `USERPROFILE` too) pointed at a scratch folder that
  holds a copy of `.claude/settings.json`.
- **Stopping things.** `kurmis daemon stop` stops the daemon. Only stop processes the test
  started.

## On every platform

### Logins
The checks below call the extra Claude login `<t1>`: use the alias `kurmis status` shows for it.

1. **The logins plain claude and plain codex use get their alias.** Start from an empty data
   folder, with no daemon running. Run `kurmis status` first: it says the daemon is not running
   and starts none (`kurmis daemon status` still says so after it), and the data folder holds
   only `config.json` after it. Those two logins are there, each with an id and marked "the login
   plain claude uses" or "the login plain codex uses". Each shows `credentials on this machine` when
   plain `claude` or plain `codex` is signed in. Then run `kurmis daemon start` and `kurmis status`, which waits
   for the daemon's first usage probe. After it, each of them should have the alias made from
   its email (`me@example.com` gives `me-example`).
2. **A new login gets its alias from the email.** `kurmis login claude` opens the browser. Sign
   in with a second subscription. Expect the email printed, then `Added <alias> (id <id>)`, with
   the alias made from the email. `kurmis status` should show its email, `signed in`, its plan
   and its usage within a minute.
3. **The same account twice.** Run `kurmis login claude` again and sign in to the account of
   `<t1>`. Expect a message that the email is already `<t1>`, exit code 0, no new login in
   `kurmis status`, and no new folder in the data folder's `claude/`. Do the same with the account
   of the login plain claude uses: the message should name that login. On macOS,
   check that no new `Claude Code-credentials-<8 hex digits>` Keychain item is left. When the
   email of `<t1>` also has a seat in a Team or Enterprise organization, sign in to that one with
   `kurmis login claude`: expect it to be added, with `<t1's alias>-2` as its alias and a line
   that `<t1>` has the same email in another organization, and no warning in `kurmis status`.
4. **An extra login of the account plain claude uses.** This needs a spare Claude account B
   besides the account A of the login plain claude uses. Sign plain `claude` in to B with
   `claude auth login`, and run `kurmis daemon restart` and `kurmis status` until the login
   plain claude uses shows B's email. Add A with `kurmis login claude`. Sign plain `claude` in
   to A again, and run `kurmis daemon restart` and `kurmis status` until the login plain claude
   uses shows A's email. Expect a warning at the top that the extra login and the login plain
   claude uses are the same account, and the alias of the login plain claude uses with `-2` at
   the end, because the extra login has the alias without it.
5. Run `kurmis login <t1>` (signing it in again) in two terminals at once. The second should
   stop with a message that another `kurmis login` or `logout` of it is running, and the first
   should succeed.
6. **One email for Claude and Codex.** `kurmis login codex` with a ChatGPT account whose email
   is the same as the email of an extra Claude login, if there is one. Expect the Codex login to
   get the same alias as the Claude login. `kurmis set <alias> --weekly 90` should refuse and ask
   for `claude:<alias>` or `codex:<alias>`. `kurmis claude --login <alias>` and
   `kurmis codex --login <alias>` should each start on their own provider's login without the
   prefix.
7. `kurmis set <t1> --alias test-t1 --weekly 90`, then `kurmis status`. Expect the alias `test-t1`
   and the limit, and `daemon.log` showing `config_loaded`. Run `kurmis login test-t1`: the
   alias should stay `test-t1`.
8. `daemon.log` should hold login ids only: search it for the aliases and the emails of the
   logins, which should not appear.

### Routing Claude
1. `kurmis claude -p --model haiku "Reply ok"` answers `ok`. `daemon.log` shows
   `session_placed` on the login whose weekly window resets soonest (`kurmis status` shows the
   reset times), then `request_forwarded ... status=200`.
2. `kurmis claude --login <t1> -p --model haiku "Reply ok"` lands on `<t1>`.
3. An interactive `kurmis claude --model haiku`: ask a question that makes it read a file, so a
   tool call runs. Then run `kurmis set <that login> --auto off` in another terminal and ask
   again. Expect `session_moved` to another login, and the conversation keeps its context.
   Set `--auto on` again.
4. In the interactive session, press Ctrl-C twice. It should exit as quickly as a plain
   `claude` does (about a second), and `echo $?` (PowerShell: `$LASTEXITCODE`) should match
   what plain `claude` gives.
5. Start `kurmis claude -p --model haiku "Write the numbers from 1 to 400 as words"` and
   interrupt it from another terminal (macOS: `kill -INT <pid of kurmis>`; Windows: Ctrl-C in
   its own window). It should stop within a second or two.
6. **A login at its limit.** When a login reaches a usage limit on its own (or set its
   `--five-hour` limit just under its current use), keep using `kurmis claude`. Expect requests
   to go to another login without an error in the CLI, and `daemon.log` showing
   `usage_limit`, `retry_other_login` and `cooldown_started`. If Anthropic answers a real
   usage-limit 429, note its `anthropic-ratelimit-unified-*` header names and the body's
   `error.type` (not the body itself): kurmis decides from those.
7. **Every login out.** With every routed login set to `--auto off` except one, and that one at
   its limit, `kurmis claude -p` should fail exactly as a plain `claude` does on an exhausted
   account. `daemon.log` shows `pool_exhausted`. Undo the settings afterwards.

### Token renewal
Only on a login added with `kurmis login`, never on one whose credentials another tool shares,
because a renewal replaces the refresh token.

1. Note the login's token expiry: `claudeAiOauth.expiresAt` (milliseconds since 1970) in its
   credentials, read with a script that prints only that field.
2. Make the token look about to expire: change only `claudeAiOauth.expiresAt` to two minutes
   from now (macOS: in the Keychain item, see below; Windows: in the login's
   `.credentials.json`).
3. Send a request through that login. Expect `token_renewal_started` and
   `token_renewal_finished` in `daemon.log`, a new expiry hours ahead, and the request answered.

### Global mode
1. `kurmis setup`. Expect the daemon running, four added settings, and the autostart entry
   (macOS: `~/Library/LaunchAgents/kurmis.daemon.plist`; Windows: the `kurmis` value under
   `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`).
2. A plain `claude -p --model haiku "Reply ok"` now shows in `daemon.log` as
   `session_placed`.
3. `kurmis claude --login <t1> -p ...` still lands on `<t1>` in global mode.
4. Open the IDE extension (VS Code or JetBrains) and send one message. It should be routed too.
5. Log out of the computer and in again, without running kurmis. `kurmis daemon status` should
   show a daemon started at the new login.
6. `kurmis setup --pause`. `settings.json` should be byte-for-byte what it was before setup.
   The autostart entry, `settings.json.kurmis-backup` and the daemon stay, and a new plain
   `claude -p` does not show in `daemon.log`.
7. `kurmis setup` again. Expect "Global routing was paused; it is on again." and a plain
   `claude -p` routed again.
8. Run `kurmis setup` with `CLAUDE_CONFIG_DIR` set to the default `.claude` folder. It should
   refuse and explain why.
9. Run `kurmis setup --pause` with `CLAUDE_CONFIG_DIR` set to an empty folder of your own. It
   should still take kurmis' settings out of `~/.claude/settings.json`, and `kurmis status`
   without the variable should say global routing is paused. Run `kurmis setup` again.

### Uninstall
Run this last, since it removes the logins added above.

1. `kurmis setup --uninstall-and-logout < /dev/null` (PowerShell: `$null | kurmis setup
   --uninstall-and-logout`). It should list what it removes and refuse, because there is no
   terminal to ask at.
2. `kurmis setup --uninstall-and-logout` in a terminal, and answer `n`. Nothing should change.
3. Run it again and answer `y`. Expect `settings.json` as it was before setup, no
   `settings.json.kurmis-backup`, no autostart entry, no daemon, no data folder, and a last line
   that says to run `npm uninstall -g kurmis`.
4. A plain `claude -p --model haiku "Reply ok"` and a plain `codex exec "Reply ok"` still answer
   on the logins they used before.
5. The extra logins' Keychain items (macOS) or Credential Manager records (Windows) are gone,
   and every file in `~/.codex` is still there.
6. `kurmis status` exits 0, shows the logins plain claude and plain codex use with new ids, and
   creates a data folder that holds only `config.json`.

### Codex
1. `kurmis codex exec "Reply ok"` answers, on the login `kurmis status` named in its last line.
2. On an extra Codex login, change the model with `/model` inside `kurmis codex --login <login>`,
   exit, and start it again. The model choice should still be there.
3. Add a line to `~/.codex/AGENTS.md` and start `kurmis codex --login <login>`. The login's copy
   should have it.
4. `kurmis logout <login>`. Its folder goes; every file in `~/.codex` stays (compare a file
   count before and after).

### Daemon
1. `kurmis daemon stop`, then `kurmis status`. It exits 0, says the daemon is not running, and
   shows each login's last usage with how long ago it was read. `kurmis daemon status` still
   says the daemon is not running. With global routing on (after `kurmis setup`), `status` also
   warns that a plain `claude` cannot reach Anthropic. `kurmis claude -p "Reply ok"` starts the
   daemon again.
2. Install a newer build over the running one, then run `kurmis status`. It should say the
   daemon runs an older kurmis and leave it running. Then run `kurmis claude -p "Reply ok"`. Expect
   `daemon_replacing_older` in `daemon.log`, and an interactive session that was open keeps
   working.
3. Close the terminal that started the daemon. The daemon keeps running.
4. Start `kurmis claude -p --model haiku "Write the numbers from 1 to 400 as words"` and, while
   it streams, run `kurmis daemon stop --now` in another terminal. The stop should return
   within a few seconds and `daemon.log` should show `drain_cut_short` with `reason=stop_now`. Run
   `kurmis daemon start` right after: the session should retry its request and carry on.

## macOS only

- **Keychain.** A login added with `kurmis login` keeps its token in a Keychain item named
  `Claude Code-credentials-<8 hex digits>`. Check that `security find-generic-password -s <name>`
  (without `-w`) finds it, that routing works from a terminal at the screen, and that
  `kurmis logout` removes the item.
  - To change only `expiresAt` for the renewal test, read the item with `-w` into a variable,
    edit the JSON with a script, and write it back with
    `security add-generic-password -U -a <same account> -s <name> -w <json>`. Never print it.
- **Over ssh.** Without setup: ssh in and run `kurmis daemon stop`, then `kurmis daemon start`.
  The daemon starts, and `kurmis status` shows the logins whose token is in the Keychain
  without a token. Then run `kurmis setup` at the screen and log out and in again. Over ssh,
  `kurmis daemon status` should show the daemon started at that login, and `kurmis claude -p
  --model haiku "Reply ok"` should be routed on a Keychain login.
- **The login plain claude uses, signed out.** When `claude` itself is signed out, `kurmis claude`
  says it starts on another login's credentials and still routes. Check it right after
  `kurmis daemon stop; kurmis daemon start` too: the first `kurmis claude -p "Reply ok"` waits for
  the daemon's first probe and starts on the other login as well.

## Windows only

- **Install.** In PowerShell, `kurmis --version`. With the default execution policy, PowerShell
  may refuse `kurmis.ps1`; `kurmis.cmd --version` works, and so does
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Install Claude Code once through npm
  and once with the native installer, and check that `kurmis claude` finds each.
- **`pnpm test`** in a clone passes, including the Windows-only tests.
- **Credentials.** Check where the CLI keeps a login's token: `.credentials.json` in its folder,
  or Credential Manager (`cmdkey /list | findstr Claude`, or the Credential Manager control
  panel). Test both:
  - the default, with no extra variables;
  - with `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1` set for the user, then `kurmis login claude`
    with another account. kurmis should route the new login, `kurmis status` should show its
    usage, and `kurmis logout <its alias>` should remove its Credential Manager records.
  - Repeat one read with PowerShell in Constrained Language Mode, if the machine can be set up
    that way.
- **Ctrl-C.** In cmd.exe, Ctrl-C in `kurmis.cmd claude` ends with "Terminate batch job (Y/N)?",
  which is how every npm command behaves there. In PowerShell there is no such question.
- **Daemon survives.** Start the daemon from a terminal, close the terminal window, and check
  `kurmis daemon status` in a new one. No console window should stay open for the daemon.
- **Started from ssh.** Without setup, over OpenSSH, `kurmis daemon start`, then disconnect and
  reconnect. The daemon should be gone, and the next `kurmis claude` or `kurmis codex` starts it
  again.
- **Autostart.** After `kurmis setup`, sign out and in. The daemon starts with no window
  showing. Also check: a user folder with non-ASCII letters or a `%` in its path, and Windows
  Script Host turned off (`HKCU\Software\Microsoft\Windows Script Host\Settings`, value
  `Enabled` = 0): setup should warn and say what to do.
- **Read-only settings.** Make `%USERPROFILE%\.claude\settings.json` read-only and run
  `kurmis setup`. It should refuse with an `attrib -R` command to run.
- **Junctions.** An extra Codex login's folders (`sessions`, `skills`, ...) are directory
  junctions into `%USERPROFILE%\.codex` (`dir /AL` in the login's folder shows them).
  `kurmis logout` of that login must leave `%USERPROFILE%\.codex` complete.
- **Excluded ports.** `netsh int ipv4 show excludedportrange protocol=tcp` lists ranges Windows
  keeps for itself (Hyper-V, WSL, Docker). Set kurmis' `port` inside one and start the daemon.
  The error should name that command and the `port` setting.
- **Elevated daemon.** Start the daemon from an Administrator terminal, then run
  `kurmis daemon stop` from a normal one. It should say it could not stop it, not that it
  stopped.
- **Program lookup.** A Node installed with fnm: `kurmis setup` should name the real Node path
  in the autostart entry, not one under `fnm_multishells`, and warn if it can only find a
  temporary one.
- **Codex sandbox.** Codex's Windows sandbox may ask for setup again on each extra login. Note
  whether it does.
