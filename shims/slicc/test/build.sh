#!/usr/bin/env bash
# Build the shim test programs (Emscripten) into test/out/:
# - resolve-test and nameinfo-test against the `net` profile, the archive
#   curl links;
# - pwd-test against `cli` (slicc_pwd.c, linked with --wrap);
# - cred-test against `cli` (process credentials, slicc-kernel K1);
# - selfkill-test against `cli` (raise/kill of the program itself);
# - rlimit-test against `cli` (setrlimit/getrlimit/prlimit, homescoop#178);
# - siginherit-test and flock-test against `cli` (homescoop#973, #947);
# - exec-test against `cli` (most packages) and exec-test-fork against
#   `fork` (bash, tar, findutils: fork emulation + Asyncify).
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
# shellcheck disable=SC2046
emcc -O2 -Wall -Wextra -Werror "$HERE/nameinfo-test.c" \
  $(homescoop_slicc_link_archive "$SLICC_A") $(homescoop_em_cli_ldflags) \
  -o "$OUT/nameinfo-test.js"
mv "$OUT/nameinfo-test.js" "$OUT/nameinfo-test"
echo "== built $OUT/nameinfo-test"

SLICC_CLI="$WORK/libslicc-cli.a"
homescoop_slicc_archive "$SLICC_CLI" cli
# shellcheck disable=SC2046
emcc -O2 -Wall -Wextra -Werror "$HERE/exec-test.c" \
  $(homescoop_slicc_link_archive "$SLICC_CLI") $(homescoop_em_cli_ldflags) \
  -o "$OUT/exec-test.js"
mv "$OUT/exec-test.js" "$OUT/exec-test"
echo "== built $OUT/exec-test"
# shellcheck disable=SC2046
emcc -O2 -Wall -Wextra -Werror "$HERE/pwd-test.c" \
  $(homescoop_slicc_link_archive "$SLICC_CLI") $(homescoop_em_cli_ldflags) \
  -o "$OUT/pwd-test.js"
mv "$OUT/pwd-test.js" "$OUT/pwd-test"
echo "== built $OUT/pwd-test"
# shellcheck disable=SC2046
emcc -O2 -Wall -Wextra -Werror "$HERE/cred-test.c" \
  $(homescoop_slicc_link_archive "$SLICC_CLI") $(homescoop_em_cli_ldflags) \
  -o "$OUT/cred-test.js"
mv "$OUT/cred-test.js" "$OUT/cred-test"
echo "== built $OUT/cred-test"
# shellcheck disable=SC2046
emcc -O2 -Wall -Wextra -Werror "$HERE/selfkill-test.c" \
  $(homescoop_slicc_link_archive "$SLICC_CLI") $(homescoop_em_cli_ldflags) \
  -o "$OUT/selfkill-test.js"
mv "$OUT/selfkill-test.js" "$OUT/selfkill-test"
echo "== built $OUT/selfkill-test"
# shellcheck disable=SC2046
emcc -O2 -Wall -Wextra -Werror "$HERE/uname-test.c" \
  $(homescoop_slicc_link_archive "$SLICC_CLI") $(homescoop_em_cli_ldflags) \
  -o "$OUT/uname-test.js"
mv "$OUT/uname-test.js" "$OUT/uname-test"
echo "== built $OUT/uname-test"
# shellcheck disable=SC2046
emcc -O2 -Wall -Wextra -Werror "$HERE/rlimit-test.c" \
  $(homescoop_slicc_link_archive "$SLICC_CLI") $(homescoop_em_cli_ldflags) \
  -o "$OUT/rlimit-test.js"
mv "$OUT/rlimit-test.js" "$OUT/rlimit-test"
echo "== built $OUT/rlimit-test"
# shellcheck disable=SC2046
emcc -O2 -Wall -Wextra -Werror "$HERE/siginherit-test.c" \
  $(homescoop_slicc_link_archive "$SLICC_CLI") $(homescoop_em_cli_ldflags) \
  -o "$OUT/siginherit-test.js"
mv "$OUT/siginherit-test.js" "$OUT/siginherit-test"
echo "== built $OUT/siginherit-test"
# shellcheck disable=SC2046
emcc -O2 -Wall -Wextra -Werror "$HERE/flock-test.c" \
  $(homescoop_slicc_link_archive "$SLICC_CLI") $(homescoop_em_cli_ldflags) \
  -o "$OUT/flock-test.js"
mv "$OUT/flock-test.js" "$OUT/flock-test"
echo "== built $OUT/flock-test"

SLICC_FORK="$WORK/libslicc-fork.a"
homescoop_slicc_archive "$SLICC_FORK" fork
HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain,sliccRunMain,sliccForkChild $(homescoop_slicc_fork_js_flags)"
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA
# shellcheck disable=SC2046
emcc -O2 -Wall -Wextra -Werror "$HERE/exec-test.c" \
  $(homescoop_slicc_link_archive "$SLICC_FORK") $(homescoop_em_cli_ldflags) \
  -o "$OUT/exec-test-fork.js"
mv "$OUT/exec-test-fork.js" "$OUT/exec-test-fork"
echo "== built $OUT/exec-test-fork"
