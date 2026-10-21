# kurmis

Kurmis lets one person use several Claude Code and Codex subscription logins on one machine.
`kurmis claude` sends each request through a small background process that picks a login with
room left and moves on to another one when a login hits its usage limit. `kurmis codex` starts
Codex on a login that has room left.

## Requirements

- **Node.js 22 or newer.** Node 22 is the oldest Node line that still gets security fixes, and
  the bundle is built for it.
- **git**, and ssh access to the `turbokettle/kurmis` repository on GitHub, because npm clones it.
- Claude Code (`claude`) and/or Codex (`codex`) installed as usual.
- macOS or Windows. Linux should work but is not tested.

## Install

```sh
npm i -g git+ssh://git@github.com/turbokettle/kurmis.git
```

To install a given release or branch, add it after `#`:

```sh
npm i -g "git+ssh://git@github.com/turbokettle/kurmis.git#v0.1.0"
npm i -g "git+ssh://git@github.com/turbokettle/kurmis.git#main"
```

The repository holds the built program (`dist/kurmis.cjs`), so the install runs no build step
and installs no other packages. Run the same command again to update. Check it with
`kurmis --version`.

## Uninstall

```sh
kurmis setup --undo      # only if you ran "kurmis setup"
npm uninstall -g kurmis
```

Kurmis keeps its data in `~/.kurmis` (`%USERPROFILE%\.kurmis` on Windows). Uninstalling leaves
that folder; delete it to remove the extra logins' settings too. On macOS an extra Claude login's
credentials are in the Keychain; `kurmis logout <id>` before uninstalling removes them.

## Use

```sh
kurmis --help
kurmis help claude
```

## More

[docs/scope.md](docs/scope.md) says what kurmis does and leaves out, and
[docs/architecture.md](docs/architecture.md) how it works.

## Development

`pnpm install`, then `pnpm test`, `pnpm check` (type check and lint) and `pnpm build` (writes
`dist/kurmis.cjs`, which is committed together with the change that produced it).
