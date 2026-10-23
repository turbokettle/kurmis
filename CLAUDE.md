# kurmis

Read `docs/scope.md` and `docs/architecture.md` before changing anything.

- `pnpm test` runs the tests, `pnpm bundle` writes `dist/kurmis.cjs`, and `pnpm check` runs the
  type check and lint. Commit `dist/` together with the source change that produced it.
- **Tests never touch the real machine.** Every test sets `KURMIS_HOME` and `HOME` to a
  temporary folder, uses the fakes in `test/fakes/`, and makes no network call. Nothing may read
  or write the real `~/.claude`, `~/.claude/settings.json` or Keychain.
- **No personal data in the repo.** No real names, emails, machine names, account ids, tokens or
  paths from a real machine, in code, tests, fixtures, docs or commit messages. Use
  `example.com` addresses and made-up ids.
- **Never log or store a token, a request body or a response body.**
- Windows has to work. Code that starts processes, links folders or detaches the daemon goes
  through `src/platform/`, and its Windows branch is written even when it can only be tested
  later.
