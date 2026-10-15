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
The same check refuses tarballs that contain hard links or symlinks: `npm pack`
keeps them, but the registry rejects the publish (E415 "Hard link is not allowed").

## Upstream versions in text (#355)

The committed package is the published one: `package.json` `version`,
`homescoop.upstream`, `description`, the recipe `summary` and
`package/README.md` all name the recipe's upstream version. There are no
templates; the text is plain.

When the upstream moves, `sync-package-version.mjs <pkg> --write` sets
`version` / `homescoop.upstream` and replaces the previous upstream string
(the old `homescoop.upstream`) with the new one in those three texts:

- exact matches only: the old string must not touch a letter, digit, `.`
  or `-` continuation, so `4.9` leaves `4.9.0-3` alone and `2.5` leaves
  `2.5.15` alone;
- a sentence with a `historical` cue word ("since 3.53.4", "before …",
  "until …") keeps its version;
- a version right after a `lead` (another component: `slicc-kernel ≥ `,
  `CPython `, `OpenSSL `) is kept;
- each replacement and each kept match is logged to stderr.

`package.json` is edited in place (one line per field) rather than
re-serialised. `--from <old>` rewrites text from an explicit old version
when the version fields are already right (jq 1.8.1 → 1.8.2 text).

`check-package-meta.mjs <pkg>` (run by `host-run.sh`, so by ladder-pr and
ladder-build) fails on drift, and `check-package-meta.mjs --drift --all`
runs only that rule over every non-retired package:

- `version` is not `<recipe>-N` (two-part and `.postN` upstreams padded
  as above), or is a plain `X.Y.Z`;
- `homescoop.upstream` is not the recipe version (or an allowed spelling);
- description, summary or README names a version with the recipe
  version's major that is not the recipe version, an allowed spelling, a
  prefix of it (`2.5` for 2.5.15) or an `X.Y.Z-N` packaging revision, and
  is neither in a historical sentence nor after a lead. Other components'
  versions usually have another major, which keeps the allow-list short.

The allow-list is `scripts/package-meta-versions.json`:

```json
{
  "historical": ["since", "before", "until"],
  "leads": { "*": ["slicc-kernel ≥ "], "libheif": ["libde265 ", "dav1d "] },
  "spellings": { "wasix-openssh": { "10.6.0": "10.6p1" } }
}
```

`leads` are matched against the text just before the version, with
Markdown links reduced to their label. They hold no version, so they do
not go stale. `spellings` are keyed by the recipe version and lapse on
the next bump.

## Exact `@ai-ecoverse` pins

Every `@ai-ecoverse/*` entry in `dependencies`, `peerDependencies` and
`optionalDependencies` of `packages/*/package/package.json` is an **exact**
version: `"@ai-ecoverse/wasix-python": "3.14.2-11"`, never `^3.14.2-9`,
`~…`, `>=…`, `*` or `latest`. A range lets `pnpm add -g` / `npm i -g` pull
whatever is newest on the registry rather than the version this package was
certified with, and a global add cannot override transitive versions. Pin
the dependency version that is `latest` on npm **and** certified.

`scripts/check-exact-pins.mjs` enforces it: the `exact-pins` job in
`ladder-pr` checks every package, and `host-run.sh` checks the package it
packs. Its `PENDING` set (empty now) is for a package whose exact-pin
re-release is still in flight; an entry that is already exact fails.

Moving a pin is a packaging-only release (`X-N+1`): set `repack.from` in
the recipe so the published tarball is reused byte for byte
([ladder-builds.md](ladder-builds.md#packaging-only-repack)).

## Cleaning up historical plain versions

Do **not** unpublish or deprecate from an agent session (npm 2FA). Lars
runs the cleanup. Generate the exact commands with:

```bash
node scripts/list-semver-cleanup.mjs          # print commands
node scripts/list-semver-cleanup.mjs --json   # machine-readable
```

See that script’s header for unpublish vs deprecate guidance.
