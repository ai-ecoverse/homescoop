#!/bin/sh
# homescoop wasi-rustc driver — default target + sysroot so `rustc hello.rs` works.
# Linker: currently rust-lld (bundled in rustc.wasm). Next cut: -C linker=wasm-ld
# from @ai-ecoverse/wasm-clang over WASIX spawn.
set -eu
# The package root, found without forking: Cargo runs this driver dozens
# of times per build, and every $(...) is a process. The realm passes the
# root in RUSTC_SYSROOT (the manifest's ${package}); otherwise it is the
# parent of this script's directory. The package has no symlinks.
if [ -z "${RUSTC_SYSROOT:-}" ]; then
  case $0 in
    /*) BINDIR=${0%/*} ;;
    */*) BINDIR=$PWD/${0%/*} ;;
    *) BINDIR=$(command -v "$0"); BINDIR=${BINDIR%/*} ;;
  esac
  RUSTC_SYSROOT=${BINDIR%/*}
fi
PKGROOT=$RUSTC_SYSROOT
BINDIR=$PKGROOT/bin
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
