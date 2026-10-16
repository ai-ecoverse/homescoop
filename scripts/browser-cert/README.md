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

# Negative proof (must fail): empties every command's wasm, then runs the specs
node scripts/browser-cert/prove-negative.mjs --package jq --tarball path/to/package.tgz [--kernel <spec>] [--users enforce]
```

Any kernel, any users mode, JSON results (what `kernel-compat.yml` runs):

```sh
node scripts/browser-cert/run.mjs --package jq --tarball wasm-jq-1.8.2-2.tgz \
  --kernel @ai-ecoverse/slicc-kernel@1.81.0 --users off --json /tmp/jq.json
```

`compat.mjs` (`plan`, `shard`, `report`) drives the
kernel-compat jobs; see [docs/ci-cert.md](../../docs/ci-cert.md#kernel-compatibility-kernel-compatyml).
