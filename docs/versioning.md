# npm versioning

Each `@ai-ecoverse/wasm-*` package version tracks the matching
`packages/<name>/recipe.yaml` `version` (the upstream library release).

| Situation | npm version |
| --- | --- |
| First publish of upstream X | `X` (e.g. `1.3.1`) |
| Packaging / rebuild fix, same upstream | `X-N` (e.g. `1.3.1-1`, `1.3.1-2`) |
| New upstream | new `X` from the recipe (Renovate PR) |

Keep `package/package.json` `"version"` and optional `"homescoop.upstream"`
in sync when releasing. Recipe bumps from Renovate do not publish by
themselves — bump the npm version and dispatch `release.yml`.
