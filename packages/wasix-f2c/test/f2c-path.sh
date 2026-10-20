#!/usr/bin/env bash
# homescoop#1197: bin/gfortran uses the pinned f2c even with another f2c first
# on PATH. A fake f2c that fails is put first; compiling test/fprobe.f must
# still work and must not run it.
#   bash packages/wasix-f2c/test/f2c-path.sh <package.tgz>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tgz="${1:?usage: f2c-path.sh <package.tgz>}"
w="$(mktemp -d)"
trap 'rm -rf "$w"' EXIT
tar xzf "$tgz" -C "$w"
mkdir -p "$w/fake"
printf '#!/bin/sh\necho fake-f2c-ran >&2\nexit 1\n' >"$w/fake/f2c"
chmod +x "$w/fake/f2c"
cp "$here/fprobe.f" "$w/fprobe.f"
# Only the translator is under test: a C compiler stub records its input and
# writes the object.
printf '#!/bin/sh\nout=; src=\nwhile [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; *.c) src=$1 ;; esac; shift; done\ncp "$src" "$out"\n' >"$w/fake/wasixcc-stub"
chmod +x "$w/fake/wasixcc-stub"
(cd "$w" && PATH="$w/fake:$PATH" WASIX_CC="$w/fake/wasixcc-stub" WASIX_F2C_CACHE="$w/cache" "$w/package/bin/gfortran" -c fprobe.f -o fprobe.o 2>"$w/err") || { cat "$w/err" >&2; echo "f2c-path: FAIL gfortran -c failed" >&2; exit 1; }
if grep -q fake-f2c-ran "$w/err"; then echo "f2c-path: FAIL bin/gfortran ran the f2c on PATH" >&2; exit 1; fi
grep -q "f2c" "$w/fprobe.o" || { echo "f2c-path: FAIL no f2c-translated C reached the compiler" >&2; exit 1; }
echo "f2c-path: PASS bin/gfortran used the pinned f2c with a fake f2c first on PATH"
