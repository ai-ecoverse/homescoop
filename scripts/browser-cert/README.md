# Browser cert (slicc-kernel CDP)

PR gate for emscripten CLIs: run the host-built tarball inside
`@ai-ecoverse/slicc-kernel` in headless Chromium, driven by
`@ai-ecoverse/slicc-shared-web/harness` (same CDP stack as slicc-kernel’s
integration tests).

```sh
npm install --prefix /tmp/cert-nm \
  @ai-ecoverse/slicc-kernel@^1.8.10 \
  @ai-ecoverse/slicc-shared-web@^1.4.1 \
  playwright-core@1.63.0
npx --prefix /tmp/cert-nm playwright-core install chromium
export HOMESCOOP_CERT_NODE_MODULES=/tmp/cert-nm/node_modules
export NODE_PATH=$HOMESCOOP_CERT_NODE_MODULES
node scripts/browser-cert/run.mjs --package jq --tarball path/to/package.tgz
```

Optional `packages/<name>/browser-cert.json`:

```json
{ "argv": ["jq", "-n", "1+1"], "stdout": "2\n", "status": 0 }
```

Default when missing: first `slicc.commands` entry with `--version`, status 0.
Packages without emscripten `slicc.commands` skip (libs use `host-smoke.sh`).
