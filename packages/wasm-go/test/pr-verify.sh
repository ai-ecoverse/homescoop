#!/usr/bin/env bash
set -uo pipefail
export HOMESCOOP_CERT_NODE_MODULES="$RUNNER_TEMP/homescoop-browser-cert-nm/node_modules"
V="$RUNNER_TEMP/pr-verify"
mkdir -p "$V"
summary=()

echo "== negative: published @ai-ecoverse/wasm-go@1.27.4-1 against cert/go.mjs"
mkdir -p "$V/pub"
npm pack @ai-ecoverse/wasm-go@1.27.4-1 --pack-destination "$V/pub" --silent
if node scripts/browser-cert/run.mjs --package wasm-go --tarball "$V"/pub/*.tgz --spec go.mjs > "$V/pub.log" 2>&1; then
  summary+=("negative 1.27.4-1: UNEXPECTED PASS")
else
  summary+=("negative 1.27.4-1: fails as expected: $(grep -m1 -A3 'AssertionError' "$V/pub.log" | tr '\n' ' ' | cut -c1-400)")
fi
grep -E 'browser-cert: (ok|FAIL)' "$V/pub.log"

echo "== negative: this build with bbfc9642's driver against cert/go.mjs"
mkdir -p "$V/old"
tar -xzf .homescoop-out/package.tgz -C "$V/old"
curl -fsSL "https://raw.githubusercontent.com/ai-ecoverse/homescoop/bbfc96424d2df0dc022f61f37ac8c499019081ec/packages/wasm-go/src/go.mjs" -o "$V/old/package/bin/go.mjs"
sha256sum "$V/old/package/bin/go.mjs"
(cd "$V/old" && tar -czf ../old.tgz package)
if node scripts/browser-cert/run.mjs --package wasm-go --tarball "$V/old.tgz" --spec go.mjs > "$V/old.log" 2>&1; then
  summary+=("negative old driver: UNEXPECTED PASS")
else
  summary+=("negative old driver: fails as expected: $(grep -m1 -A3 'AssertionError' "$V/old.log" | tr '\n' ' ' | cut -c1-400)")
fi
grep -E 'browser-cert: (ok|FAIL)' "$V/old.log"

for k in 1.80.0 1.85.0 1.88.0 1.90.0 1.93.0 1.94.0 1.96.0 1.98.0 1.100.0; do
  echo "== floor probe slicc-kernel $k"
  if node scripts/browser-cert/run.mjs --package wasm-go --tarball .homescoop-out/package.tgz --kernel "@ai-ecoverse/slicc-kernel@$k" --spec go.mjs > "$V/k$k.log" 2>&1; then
    summary+=("floor $k: PASS")
  else
    summary+=("floor $k: FAIL $(grep -m1 -A3 'AssertionError' "$V/k$k.log" | tr '\n' ' ' | cut -c1-300)")
  fi
  grep -E 'browser-cert: (kernel|file modes|ok|FAIL)' "$V/k$k.log"
done

echo "== real modules: okf v0.5.2 and yq v4.54.3 through proxy.golang.org"
mkdir -p "$V/real"
cp packages/wasm-go/test/real-modules.mjs "$V/real/"
node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync("packages/wasm-go/cert/meta.json","utf8"));m.runTimeoutMs=1800000;fs.writeFileSync(process.argv[1],JSON.stringify(m,null,2))' "$V/real/meta.json"
t0=$(date +%s)
node scripts/browser-cert/run.mjs --package wasm-go --tarball .homescoop-out/package.tgz --cert "$V/real" > "$V/real.log" 2>&1
rc=$?
grep -E 'real-modules:|browser-cert: (ok|FAIL)|AssertionError' "$V/real.log" | cut -c1-600
summary+=("real modules: rc $rc in $(( $(date +%s) - t0 )) s")

echo "== pr-verify summary"
printf '%s\n' "${summary[@]}"
exit 0
