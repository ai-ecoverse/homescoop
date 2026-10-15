#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/emsdk-cache-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
CACHE="${EMSDK_TEST_CACHE:-$WORK/cache}"
mkdir -p "$WORK/bare/emsdk-patches"
cp "$HERE/install-emsdk.sh" "$WORK/bare/"
PATCHES=()
for p in "$HERE"/emsdk-patches/*.patch; do
  [[ -f "$p" ]] || continue
  PATCHES+=("$p")
done
((${#PATCHES[@]})) || { echo "test-install-emsdk: no emsdk patches to test" >&2; exit 1; }
root_of() { sed -n 's/^export EMSDK=//p' "$1"; }
fail() { echo "test-install-emsdk: $*" >&2; exit 1; }

EMSDK_CACHE="$CACHE" bash "$HERE/install-emsdk.sh" >"$WORK/patched.env"
PATCHED="$(root_of "$WORK/patched.env")"
EMSDK_CACHE="$CACHE" bash "$WORK/bare/install-emsdk.sh" >"$WORK/bare.env"
BARE="$(root_of "$WORK/bare.env")"
[[ "$BARE" == "$CACHE/0.4.0" ]] || fail "unpatched install at $BARE, not $CACHE/0.4.0"
[[ "$PATCHED" == "$CACHE"/0.4.0-* && "$PATCHED" != "$BARE" ]] || fail "patched install at $PATCHED"
for p in "${PATCHES[@]}"; do
  patch -d "$PATCHED/install/emscripten" -p1 -R --dry-run -s -f <"$p" >/dev/null || fail "$(basename "$p") not applied in $PATCHED"
  patch -d "$BARE/install/emscripten" -p1 --dry-run -s -f <"$p" >/dev/null || fail "$(basename "$p") applied in $BARE"
done
[[ ! -e "$PATCHED/install/emscripten/cache/sysroot/lib/wasm32-emscripten/libc.a" ]] || fail "patched install kept the prebuilt libc.a"
[[ -f "$BARE/install/emscripten/cache/sysroot/lib/wasm32-emscripten/libc.a" ]] || fail "unpatched install lost the prebuilt libc.a"
grep -q ' patches=none$' "$BARE/.homescoop-emsdk" || fail "unpatched stamp: $(cat "$BARE/.homescoop-emsdk")"
grep -q " patches=${PATCHED##*-}\$" "$PATCHED/.homescoop-emsdk" || fail "patched stamp: $(cat "$PATCHED/.homescoop-emsdk")"
for script in "$HERE/install-emsdk.sh" "$WORK/bare/install-emsdk.sh"; do
  EMSDK_CACHE="$CACHE" bash "$script" 2>"$WORK/again.log" >/dev/null
  grep -q 'already has' "$WORK/again.log" || fail "second run of $script reinstalled: $(cat "$WORK/again.log")"
done
echo "test-install-emsdk: patched $PATCHED and unpatched $BARE side by side; second runs reuse them"
