#!/usr/bin/env bash
set -euo pipefail
built="${1:?usage: packaging-only.sh <package.tgz>}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
node scripts/packaging-only-wasi-pnpm.mjs "$out"
a=$(sha256sum "$built" | cut -d' ' -f1)
b=$(sha256sum "$out/package.tgz" | cut -d' ' -f1)
printf 'from source            %s\npackaging-only repack   %s\n' "$a" "$b"
if [[ "$a" == "$b" ]]; then
  echo "wasi-pnpm: the from-source tarball is the packaging-only repack of the published one"
  exit 0
fi
mkdir -p "$out/a" "$out/b"
tar -xzf "$built" -C "$out/a"
tar -xzf "$out/package.tgz" -C "$out/b"
(cd "$out" && diff -r a b) || true
tar -tvzf "$built"
tar -tvzf "$out/package.tgz"
echo "::error::wasi-pnpm: the from-source tarball differs from the packaging-only repack"
exit 1
