# Browser / CI cert (slicc-kernel CDP)

See [docs/ci-cert.md](../../docs/ci-cert.md).

```sh
npm install --prefix /tmp/cert-nm \
  @ai-ecoverse/slicc-kernel@^1.8.10 \
  @ai-ecoverse/slicc-shared-web@^1.4.1 \
  monocart-coverage-reports@3.0.0 \
  playwright-core@1.63.0
npx --prefix /tmp/cert-nm playwright-core install chromium
export HOMESCOOP_CERT_NODE_MODULES=/tmp/cert-nm/node_modules

# Full checklist (packages/<name>/cert/*.mjs)
node scripts/browser-cert/run.mjs --package jq --tarball path/to/package.tgz

# Negative proof (must fail): empties every command's wasm, then runs the specs
node scripts/browser-cert/prove-negative.mjs --package jq --tarball path/to/package.tgz [--kernel <spec>] [--users enforce]
```

A py-\*'s wasix-python range: one python on the floor and the newest, and the
specs again on the floor ([ci-cert.md](../../docs/ci-cert.md#py-python-range)):

```sh
node scripts/browser-cert/python-range.mjs py-numpy --tarball path/to/package.tgz [--lock-only]
```

Any kernel, any users mode, JSON results (what `compat.mjs` runs):

```sh
node scripts/browser-cert/run.mjs --package jq --tarball wasm-jq-1.8.2-2.tgz \
  --kernel @ai-ecoverse/slicc-kernel@1.81.0 --users off --json /tmp/jq.json
```

## By hand: no workflow runs these any more

The workflows that ran `compat.mjs`, `base-sweep/` and `selftest/` are gone
since #1697; `ladder-build.yml` runs only `run.mjs` and `cert-leg.mjs` (a PR's
own packages on the cert kernel) and the reviewers' browsers. These stay
because they still work by hand.

**Kernel compatibility** (do the published packages still pass their cert
specs on kernel X?): `compat.mjs` plans the published packages of slicc-bios's
base set and the `scripts/ci-certified.json` set (`--set`, default
`base,ci-certified`), runs each shard of the plan (the specs, and the base
sweep `base-sweep/` under users `report` and `enforce`), and writes one
report. `known-limits.json` and `timings.json` are its inputs. `--soft` is how
it calls `run.mjs`: published packages that still ship 0644 glue skip the
glue-by-path check. See [docs/ci-cert.md](../../docs/ci-cert.md#kernel-compatibility-scriptsbrowser-certcompatmjs).

```sh
node scripts/browser-cert/compat.mjs plan --kernel @ai-ecoverse/slicc-kernel@<version> --out /tmp/kc/plan
for i in $(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/kc/plan/plan.json","utf8")).shards.map((_, i) => i).join(" "))'); do
  node scripts/browser-cert/compat.mjs shard --plan /tmp/kc/plan/plan.json --index "$i" --out /tmp/kc/out
done
node scripts/browser-cert/compat.mjs report --plan /tmp/kc/plan/plan.json --results /tmp/kc/out --out /tmp/kc/report
```

**The harness's own specs** (`selftest/`: `ctx.serveWs`, `ctx.write` and
`ctx.readBytes`), after a change to `context.mjs`, `run.mjs` or `page/`, on
npm `latest` of wasm-curl with `selftest/meta.json`'s `needs` installed in
`$HOMESCOOP_CERT_NODE_MODULES`:

```sh
npm pack @ai-ecoverse/wasm-curl --pack-destination /tmp/curl
node scripts/browser-cert/run.mjs --package curl --tarball /tmp/curl/*.tgz --cert scripts/browser-cert/selftest
```
