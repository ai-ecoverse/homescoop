#!/bin/sh
# homescoop wasi-rustc driver — default target + sysroot so `rustc hello.rs` works.
# Linker: currently rust-lld (bundled in rustc.wasm). Next cut: -C linker=wasm-ld
# from @ai-ecoverse/wasm-clang over WASIX spawn.
set -eu
SCRIPT=$0
# The package has no symlinks. Resolve its directory with shell builtins so
# the driver works before coreutils has been installed into SLICC.
case $SCRIPT in
  */*) ;;
  *) SCRIPT=$(command -v "$SCRIPT") ;;
esac
BINDIR=$(CDPATH= cd -- "${SCRIPT%/*}" && pwd)
PKGROOT=$(CDPATH= cd -- "$BINDIR/.." && pwd)
RUSTC_SYSROOT=$PKGROOT
export RUSTC_SYSROOT

has_target=0
has_sysroot=0
for a in "$@"; do
  case "$a" in
    --target|--target=*) has_target=1 ;;
    --sysroot|--sysroot=*) has_sysroot=1 ;;
  esac
done

set -- "$@"
# Rebuild argv with optional defaults prepended
extra=
if [ "$has_sysroot" -eq 0 ]; then
  extra="$extra --sysroot=$PKGROOT"
fi
if [ "$has_target" -eq 0 ]; then
  extra="$extra --target=wasm32-wasip1"
fi
# shellcheck disable=SC2086
exec "$BINDIR/rustc.wasm" $extra "$@"
