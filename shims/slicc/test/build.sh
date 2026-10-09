#!/usr/bin/env bash
# Build resolve-test (Emscripten) against the slicc `net` shim profile, the
# archive curl links. Output: test/out/resolve-test{,.wasm}.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export HOMESCOOP_ROOT="${HOMESCOOP_ROOT:-$(cd "$HERE/../../.." && pwd)}"
export HOMESCOOP_WORK="${HOMESCOOP_WORK:-$HERE/out/work}"
# shellcheck source=../../../scripts/build-common.sh
source "$HOMESCOOP_ROOT/scripts/build-common.sh"
OUT="$HERE/out"
mkdir -p "$OUT"
SLICC_A="$WORK/libslicc-net.a"
homescoop_slicc_archive "$SLICC_A" net
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
# shellcheck disable=SC2046
emcc -O2 -Wall -Wextra -Werror "$HERE/resolve-test.c" \
  $(homescoop_slicc_link_archive "$SLICC_A") $(homescoop_em_cli_ldflags) \
  -o "$OUT/resolve-test.js"
mv "$OUT/resolve-test.js" "$OUT/resolve-test"
echo "== built $OUT/resolve-test"
