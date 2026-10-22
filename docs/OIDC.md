# OIDC / trusted publishing

Token-less publishes from GitHub Actions on `ai-ecoverse/homescoop`.

## Workflow

| Workflow | Role |
| --- | --- |
| [`ladder-build.yml`](../.github/workflows/ladder-build.yml) | The one workflow, and the sole CI publisher: its `publish` job (`id-token: write`, GitHub-hosted) publishes on a push to `main` the `host-<pkg>-prN` artifact of the PR's green, reviewed run, with OIDC. It calls slicc-shared-web's pipeline as a reusable workflow for lint, tests and review; npm checks the *calling* workflow, so the trust stays on this file. |

Fledgling’s `"workflow"` is `ladder-build.yml`. Re-run `npm run trust` after
changing it. The root `package.json` has no `workspaces` (CI's `npm ci` needs a
lockfile that doesn't change with every recipe version), so `npm run trust`
goes through `scripts/trust.mjs`, which adds them for the fledgling run.

A former `release.yml` (metadata-only republish) was retired; use
`ladder-build` (or local `npm publish` with 2FA) instead.

## One-time setup

1. Stubs: `npm run reserve` (publish token).
2. `npm login` with 2FA (bypass-2FA GATs cannot run `npm trust`).
3. `npm run trust` (or `FLEDGLING_OTP_SECRET=… npm run trust`).
4. Optional: `SLICC_CONE_CONFIG` / `SLICC_SECRETS_ENV` repo secrets for the cone.
5. Emcc on the cone `PATH` for real builds (ladder toolchain).

## OIDC vs secrets

The **npm OIDC exchange runs on the GHA runner** (`permissions.id-token: write`).
That is required for trusted publishing. `SLICC_SECRETS_ENV` is for other
cone secrets (API keys, etc.), not a substitute for the runner OIDC publish
step. See [`ladder-builds.md`](ladder-builds.md).

Do **not** set `registry-url` on `actions/setup-node` and do **not**
`npm install -g npm@latest` before publish: both can write an empty
`_authToken` so npm 11 skips the OIDC exchange (`ENEEDAUTH`). Node 24 and 26
already ship npm ≥ 11.5.1. Re-run `npm run trust` after adding packages.
