# OIDC / trusted publishing

1. Publish 0.0.0 stubs once (`npm run reserve`) with a human/token session.
2. For each package: `npm trust github @ai-ecoverse/wasm-<name> --repo ai-ecoverse/homescoop --file release.yml --allow-publish -y`
   (or `npx fledgling sync` after stubs exist). Use the 5-minute 2FA skip for bulk.
3. Wire changesets + `release.yml` to publish only changed packages via OIDC (`id-token: write`).
