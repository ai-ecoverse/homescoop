#!/bin/sh
# Build the offline proc-macro acceptance workspace for wasi-cargo:
#   make-proc-macro-fixture.sh <out-dir> [out.tgz]
# app uses serde/serde_json, thiserror and clap derives; boomer uses
# panicky's derive, which panics. Cargo.lock pins crates that the
# Cargo 1.83 fork can read (rust-version <= 1.83, no edition 2024).
# Needs network and a host cargo; the output builds with --offline.
set -eu
out=$(mkdir -p "$1" && CDPATH= cd -- "$1" && pwd)
tgz=
if [ $# -gt 1 ]; then
  tgz=$(CDPATH= cd -- "$(dirname -- "$2")" && pwd)/$(basename -- "$2")
fi
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
rm -rf "$out"
mkdir -p "$out"
cp -R "$here/fixtures/proc-macros/." "$out/"
cd "$out"
mkdir -p .cargo
cargo vendor --locked --versioned-dirs vendor > .cargo/config.toml
# windows-sys is never built for WASI; keep its manifest, drop 18 MB of sources.
rm -rf vendor/windows-sys-*/src
if [ -n "$tgz" ]; then
  tar -czf "$tgz" -C "$(dirname "$out")" "$(basename "$out")"
fi
