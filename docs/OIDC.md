# OIDC / trusted publishing

Token-less publishes from GitHub Actions on `ai-ecoverse/homescoop`.

## Workflows

| Workflow | Role |
| --- | --- |
| [`ladder-build.yml`](../.github/workflows/ladder-build.yml) | **Primary** — boots SLICC (`packages/github-workflow`), runs `build.jsh`, packs, `npm publish` with OIDC |
| [`release.yml`](../.github/workflows/release.yml) | Metadata / stub republish without a SLICC build |

Fledgling’s `"workflow"` is `ladder-build.yml`. Re-run `npm run trust` after
changing it. To also allow `release.yml`, add a second publisher per package:

```bash
npm trust github @ai-ecoverse/wasm-<name> \
  --repo ai-ecoverse/homescoop \
  --file release.yml \
  --allow-publish -y
```

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
