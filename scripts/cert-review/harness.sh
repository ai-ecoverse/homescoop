#!/usr/bin/env bash
set -euo pipefail

pkg=$1
prefix=$2
meta="packages/$pkg/cert/meta.json"

field() {
  node -e '
    const fs = require("fs");
    let j = {};
    try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
    const v = j[process.argv[2]];
    if (Array.isArray(v)) v.forEach((x) => console.log(x));
    else if (v !== undefined) console.log(v);
  ' "$meta" "$1"
}

install() {
  npm install --prefix "$prefix" --no-fund --no-audit "$@"
}

kernel=$(field kernel | head -1)
mkdir -p "$prefix"
install "${kernel:-@ai-ecoverse/slicc-kernel@1.9.0}" @ai-ecoverse/slicc-shared-web@^1.4.1 playwright-core@1.63.0

needs=$(node -e '
  const fs = require("fs");
  let j = {};
  try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
  for (const n of j.needsInstall || j.needs || []) console.log(n);
' "$meta")
while read -r dep; do
  [ -n "$dep" ] && install "$dep"
done <<< "$needs"

while read -r script; do
  [ -n "$script" ] || continue
  install "$(node "$script" | head -1)"
done <<< "$(field needsTarballScripts)"

repack=()
while read -r peer; do
  [ -n "$peer" ] || continue
  out="$prefix.repack/$peer"
  node scripts/repack-published.mjs "$peer" --out "$out" > /dev/null
  repack+=("$out/package.tgz")
done <<< "$(field needsRepack)"
[ ${#repack[@]} -eq 0 ] || install "${repack[@]}"

if [ "$(id -u)" = 0 ] || sudo -n true 2>/dev/null; then
  npx --prefix "$prefix" playwright-core install --with-deps chromium
else
  npx --prefix "$prefix" playwright-core install chromium
fi
