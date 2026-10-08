# npm versioning

Each `@ai-ecoverse/wasm-*` package version tracks the matching
`packages/<name>/recipe.yaml` `version` (the upstream library release),
published as a **packaging revision** `X.Y.Z-N`.

| Situation | npm version |
| --- | --- |
| First publish of upstream X | `X-1` (e.g. `1.3.1-1`) — **never** a plain `X` |
| Packaging / rebuild fix, same upstream | `X-N` with N ≥ 2 (e.g. `1.3.1-2`) |
| New upstream | `Y-1` from the recipe (Renovate + sync) |

## Why never publish plain `X.Y.Z`

Semver treats `X.Y.Z-N` as a *prerelease* of `X.Y.Z`. A plain
`1.35.0` therefore **outranks** every `1.35.0-N`, so a range like
`^1.35.0-2` resolves to `1.35.0` (the oldest, broken build).

`ladder-build.yml` still publishes with `--tag latest` so the intended
revision is the default install target when no range is given — but
caret/tilde ranges and many lockfiles ignore `latest` and compare
semver. Plain versions break those.

Publish is gated: `sync-package-version.mjs --assert-publishable`,
`host-run.sh` before `npm pack`, and `ladder-build` before
`npm publish` all refuse a plain `X.Y.Z`.

Keep `package/package.json` `"version"` and optional `"homescoop.upstream"`
in sync when releasing. Recipe bumps from Renovate do not publish by
themselves — bump the npm version (`sync-package-version.mjs` → `X-1`
for a new upstream) and dispatch `ladder-build`.

If upstream is two-component (e.g. GNU which `2.23`, lcms2 `2.17`),
`sync-package-version.mjs` **pads** to a three-part npm base (`2.23.0-1`).
Never publish `X.Y-N` — `npm pack` may accept it, but `npm publish` rejects
it as an invalid version (caught on which 2.23-1). Keep `homescoop.upstream`
as the true upstream string.

`host-run.sh` and `ladder-pr` validate the **packed** tarball with
`sync-package-version.mjs --assert-tarball` so non-semver versions fail in
CI before certification, not at publish.

## Cleaning up historical plain versions

Do **not** unpublish or deprecate from an agent session (npm 2FA). Lars
runs the cleanup. Generate the exact commands with:

```bash
node scripts/list-semver-cleanup.mjs          # print commands
node scripts/list-semver-cleanup.mjs --json   # machine-readable
```

See that script’s header for unpublish vs deprecate guidance.
