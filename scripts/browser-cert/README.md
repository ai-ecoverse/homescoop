# Browser / CI cert (slicc-kernel CDP)

See [docs/ci-cert.md](../../docs/ci-cert.md).

```sh
npm install --prefix /tmp/cert-nm \
  @ai-ecoverse/slicc-kernel@^1.8.10 \
  @ai-ecoverse/slicc-shared-web@^1.4.1 \
  playwright-core@1.63.0
npx --prefix /tmp/cert-nm playwright-core install chromium
export HOMESCOOP_CERT_NODE_MODULES=/tmp/cert-nm/node_modules

# Full checklist (packages/<name>/cert/*.mjs)
node scripts/browser-cert/run.mjs --package jq --tarball path/to/package.tgz

# Negative proof (must fail)
node scripts/browser-cert/prove-negative.mjs --package jq --tarball path/to/package.tgz
```
