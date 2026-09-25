# OIDC / trusted publishing

Token-less publishes from GitHub Actions (`ai-ecoverse/homescoop` →
`.github/workflows/release.yml`).

## One-time setup

1. **Stubs** (done): `npm run reserve` with a publish token claimed `@ai-ecoverse/wasm-*@0.0.0`.
2. **Login**: `npm login` with 2FA enabled. Granular tokens that *bypass* 2FA cannot run `npm trust`.
3. **Trust** (reconcile npm to repo config):

   ```bash
   # optional: TOTP secret so fledgling can OTP every package without prompts
   export FLEDGLING_OTP_SECRET=…   # or --otp <code> for a short run
   npm run trust                   # npx fledgling sync -y --skip-publish
   ```

   Equivalent per package:

   ```bash
   npm trust github @ai-ecoverse/wasm-<name> \
     --repo ai-ecoverse/homescoop \
     --file release.yml \
     --allow-publish -y
   ```

4. **Source of truth** is the root `package.json` `"fledgling"` block (`provider`, `workflow`, `repo`, `publish`). Re-run `npm run trust` after changing it or adding packages.

## CI publish

`release.yml` has `permissions.id-token: write` and runs `npm publish` with no
`NODE_AUTH_TOKEN` (and without `setup-node` `registry-url`, which would inject a
dummy token that overrides OIDC). Dispatch with `package=zlib` (or `all`).

Selective versioning (changesets / Bumpy) can land later; OIDC is independent of that.
