#!/bin/sh
# Prepare Cargo 0.99 (the submodule of Rust 1.98.1, rust-lang/cargo 797e8a9)
# for wasm32-wasip1-threads in SLICC:
#   prepare.sh <cargo-checkout>
# Applies cargo.patch, adds the WASIX Command bridge crate, and patches the
# crates.io sources of git2, home, filetime, tar and jobserver for WASI ([patch.crates-io]
# in cargo.patch points at slicc/<name>).
set -eu
src=$(CDPATH= cd -- "$1" && pwd)
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$src"
git apply "$here/cargo.patch"
cp -R "$here/../cargo/wasix-command" crates/wasix-command
mkdir -p slicc
for spec in git2:0.21.0 home:0.5.12 filetime:0.2.29 tar:0.4.46 jobserver:0.1.34; do
  name=${spec%%:*}
  version=${spec##*:}
  curl -fsSL --retry 3 "https://static.crates.io/crates/$name/$name-$version.crate" | tar -xz -C slicc
  mv "slicc/$name-$version" "slicc/$name"
  (cd "slicc/$name" && patch -p1 < "$here/$name.patch")
done
