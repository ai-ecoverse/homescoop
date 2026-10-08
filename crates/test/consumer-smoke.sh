#!/usr/bin/env bash
# Vendors the crates into a copy of test/consumer (as a recipe does), builds
# it for wasm32-wasip1, and checks that the native graph still has the real
# ureq while WASI gets wasix-ureq. Usage: test/consumer-smoke.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
HOMESCOOP_ROOT=$(cd "$here/../.." && pwd)
export HOMESCOOP_ROOT
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -R "$here/consumer" "$tmp/consumer"
# shellcheck source=../../scripts/build-common.sh
HOMESCOOP_WORK="$tmp/work" source "$HOMESCOOP_ROOT/scripts/build-common.sh"
homescoop_vendor_crates "$tmp/consumer" wasix-ureq wasix-command
test -f "$tmp/consumer/homescoop-crates/wasix-net/Cargo.toml"
test ! -e "$tmp/consumer/homescoop-crates/wasix-net/tests"
cd "$tmp/consumer"
cargo build --target wasm32-wasip1
cargo tree --target wasm32-wasip1 -e normal --depth 1 | tee "$tmp/wasi.txt"
grep -q 'wasix-ureq v' "$tmp/wasi.txt"
if grep -q ' ureq v' "$tmp/wasi.txt"; then echo "real ureq in the WASI graph" >&2; exit 1; fi
host=$(rustc -vV | sed -n 's/^host: //p')
cargo tree --target "$host" -e normal --depth 1 | tee "$tmp/native.txt"
grep -q ' ureq v2' "$tmp/native.txt"
if grep -q 'wasix-ureq' "$tmp/native.txt"; then echo "wasix-ureq in the native graph" >&2; exit 1; fi
echo "consumer smoke: ok"
