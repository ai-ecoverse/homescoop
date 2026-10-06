#!/usr/bin/env bash
# Apply wasix-libc patches needed by wasix-python (before sysroot rebuild).
# Usage: apply-wasix-libc-alarm-patch.sh /path/to/wasix-libc
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
LIBC="${1:?usage: $0 /path/to/wasix-libc}"
test -d "$LIBC/libc-top-half"
test -d "$LIBC/libc-bottom-half"

apply_one() {
  local patch="$1"
  test -f "$patch"
  patch -d "$LIBC" -p1 --forward --dry-run < "$patch" >/dev/null
  patch -d "$LIBC" -p1 --forward < "$patch"
  echo "applied $patch to $LIBC"
}

apply_one "$ROOT/patches/wasix-libc-setitimer-it-value.patch"
apply_one "$ROOT/patches/wasix-libc-clock-nanosleep-eintr.patch"
apply_one "$ROOT/patches/wasix-libc-advisory-locks-noop.patch"

echo "next: rebuild wasixcc sysroot (exnref-ehpic/ehpic), then relink wasix-python"
echo "host: wasix_32v1.proc_raise_interval2(sig:i32, initial:i64 ns, interval:i64 ns, repeat:i32) -> errno"
echo "legacy wasix_32v1.proc_raise_interval (3-arg) left unchanged"
echo "clock_nanosleep: poll_oneoff EINTR → EINTR (not ENOTSUP); fills *rem on relative sleep"
echo "advisory locks: flock/fcntl(F_SETLK*)/lockf are no-ops in the SLICC realm (Emscripten parity)"
