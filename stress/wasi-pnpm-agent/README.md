# wasi-pnpm agent stress fixture

Seven's agent install, the way bios runs it: `agent/` is bios's
`src/packages/agent` (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`),
and `agent-loop.mjs` installs it with `pnpm install --frozen-lockfile
--trust-lockfile` in a slicc-kernel page, again and again, to catch
homescoop#1127's intermittent wasm trap. It isn't a cert.

## What runs it

`.github/workflows/ladder-build.yml` has two jobs for it (see
[docs/ladder-builds.md](../../docs/ladder-builds.md)). Neither is in `ci`'s
needs.

- **`stress-lockfile`**, on every pull request that touches
  `stress/wasi-pnpm-agent/**`: upstream pnpm at wasi-pnpm's upstream version
  (`packages/wasi-pnpm/package/package.json` without its `-N`) runs `pnpm
  install --frozen-lockfile --lockfile-only` in `agent/`. That fails when
  the lockfile is behind `package.json` (homescoop#1729) or has entries
  pnpm's supply-chain policies reject.
- **`agent-loop`**, once a day at 05:47 UTC with 8 rounds, and on
  `workflow_dispatch` with `agent_loop_rounds` set: `agent-loop.mjs` on a
  GitHub-hosted runner, with npm's `@ai-ecoverse/wasi-pnpm` at
  `packages/wasi-pnpm`'s version, on the `@ai-ecoverse/slicc-kernel` that
  `agent/package.json` pins, under `users enforce`. A round takes about 2.5
  minutes warm and 4.5 cold (pnpm-agent-loop runs 39330831811 and
  39360271290), so the daily run takes about half an hour. Every fourth
  round starts from a cold store. The job log ends with `rounds.jsonl`, the
  kernel's wasm-memory admission at the start, and each failed round's whole
  log (no artifact: nothing but a pull request or `main` uploads one). A dispatch on `main` also
  runs the usual dispatch publish, so leave `packages` empty (a package
  already on npm is skipped) or dispatch from another branch.

`scripts/test/stress-agent-fixture.test.mjs` also checks, on every pull
request and inside `ci`, that the lockfile's importers name the
dependencies and specifiers of `package.json` and the overrides of
`pnpm-workspace.yaml`.

## Updating the lockfile

Renovate bumps `agent/package.json`. When its lockfile update fails,
regenerate the lockfile in `agent/` with the same pnpm the check uses:

```bash
npm install --prefix /tmp/pnpm-12 pnpm@12.9.1
cd stress/wasi-pnpm-agent/agent && /tmp/pnpm-12/node_modules/.bin/pnpm install --lockfile-only
```

pnpm's `minimumReleaseAge` (a day, by default) refuses a lockfile that
resolves a version published less than a day ago. `pnpm-workspace.yaml`
exempts `@ai-ecoverse/*` only. For anything else, wait out the day instead
of loosening the policy.
