#!/usr/bin/env bash
# install-wasixcc.sh [DEST] — pinned WASIX toolchain for wasix-* host builds.
#
# Installs wasixcc + WASIX LLVM + binaryen + @ai-ecoverse/wasix-sysroot into
# DEST (default $WASIXCC_HOME, else ~/.wasixcc) using the layout wasixcc
# expects (bin/ llvm/ binaryen/ sysroot/). Every download is sha256-pinned.
# A stamp records the pin set; rerunning with the same pins is a no-op, so CI
# can restore DEST from actions/cache keyed on this file.
#
# Prints shell exports (PATH + WASIXCC_* locations) on stdout:
#   eval "$(bash scripts/install-wasixcc.sh)"
set -euo pipefail

WASIXCC_VERSION="0.4.7"
LLVM_VERSION="21.1.206"
BINARYEN_VERSION="133"
# -15 adds st_uid/st_gid = getuid()/getgid() (slicc_stat_owner) to -14,
# which wasix-m4 1.4.20-2 links against (fcntl F_SETFD fix); wasix-gnupg
# needs it for its homedir ownership checks. -17 adds slicc_fs modes; -18
# (wasix-python 3.14.2-12) select exceptfds/timeouts, physical chdir, POSIX
# TZ, socketpair flags, sigaction_set; -19 alarm/setitimer/getitimer in
# every variant, EINTR sleeps with the time left, raise()/pthread_kill(); -20
# process credentials from slicc-kernel (>= 1.44.0, no fallback) and %Z for a
# copied tm_zone; -21 per-descriptor terminals (slicc_tty; older kernels
# fall back) and file types from slicc_fs (S_IFIFO for pipes on kernels that
# report it); -22 the slicc.libc custom section in every linked program
# (libc generation marker for slicc-kernel) and a static itimer helper.
# Override with HOMESCOOP_WASIX_SYSROOT_VERSION + HOMESCOOP_WASIX_SYSROOT_SHA
# when a package needs another certified sysroot.
SYSROOT_VERSION="${HOMESCOOP_WASIX_SYSROOT_VERSION:-2025.9.30-22}"
SYSROOT_SHA="${HOMESCOOP_WASIX_SYSROOT_SHA:-806fbe6684e19538f8d349fd9d564682fc863f6e3eeb1dde512991cb4fd5464d}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    WASIXCC_TRIPLE="x86_64-unknown-linux-gnu"
    WASIXCC_SHA="d39db81b6b76d9567e0f61955f390b8586d932ab683816989e23305f27099c2f"
    LLVM_ASSET="LLVM-Linux-x86_64-gnu.tar.gz"
    LLVM_SHA="ab32cf976226dc9478c9cb8331fa877163ff34d78b190fb201d6eac92cb7dab0"
    BINARYEN_ASSET="binaryen-version_${BINARYEN_VERSION}-x86_64-linux.tar.gz"
    BINARYEN_SHA="2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489"
    ;;
  Darwin-arm64)
    WASIXCC_TRIPLE="aarch64-apple-darwin"
    WASIXCC_SHA="23a422875195814aae5ac42036baa6a1c3d7f3a6413c7d59afa47705e62013a8"
    LLVM_ASSET="LLVM-MacOS-aarch64.tar.gz"
    LLVM_SHA="0ca2393e0445928fd6614688625415063fdf7842cf41a29e22e68834e648539b"
    BINARYEN_ASSET="binaryen-version_${BINARYEN_VERSION}-arm64-macos.tar.gz"
    BINARYEN_SHA="ad66da82ac13f163e424b1643f16c6dfcccc98b5966296b43e52d3cab04f84a8"
    ;;
  *)
    echo "install-wasixcc: unsupported host $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

DEST="${1:-${WASIXCC_HOME:-$HOME/.wasixcc}}"
STAMP="$DEST/.homescoop-toolchain"
PIN="wasixcc=$WASIXCC_VERSION llvm=$LLVM_VERSION binaryen=$BINARYEN_VERSION sysroot=$SYSROOT_VERSION"

fetch() {
  # fetch <url> <sha256> <path>
  local url="$1" sha="$2" out="$3"
  echo "== install-wasixcc: fetch $url" >&2
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$url" -o "$out"
  echo "$sha  $out" | shasum -a 256 -c - >&2
}

if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$PIN" ]]; then
  echo "== install-wasixcc: $DEST already has $PIN" >&2
else
  if [[ -e "$DEST" && ! -f "$STAMP" && -z "${FORCE:-}" ]]; then
    echo "install-wasixcc: $DEST exists and was not installed by this script; set FORCE=1 or pass another DEST" >&2
    exit 1
  fi
  DL="$(mktemp -d)"
  trap 'rm -rf "$DL"' EXIT
  fetch "https://github.com/wasix-org/wasixcc/releases/download/v$WASIXCC_VERSION/wasixcc-$WASIXCC_TRIPLE.tar.gz" \
    "$WASIXCC_SHA" "$DL/wasixcc.tgz"
  fetch "https://github.com/wasix-org/llvm-project/releases/download/$LLVM_VERSION/$LLVM_ASSET" \
    "$LLVM_SHA" "$DL/llvm.tgz"
  fetch "https://github.com/WebAssembly/binaryen/releases/download/version_$BINARYEN_VERSION/$BINARYEN_ASSET" \
    "$BINARYEN_SHA" "$DL/binaryen.tgz"
  fetch "https://registry.npmjs.org/@ai-ecoverse/wasix-sysroot/-/wasix-sysroot-$SYSROOT_VERSION.tgz" \
    "$SYSROOT_SHA" "$DL/sysroot.tgz"

  rm -rf "$DEST"
  mkdir -p "$DEST/bin" "$DEST/llvm" "$DEST/binaryen" "$DEST/sysroot"
  tar xzf "$DL/wasixcc.tgz" -C "$DEST/bin"
  tar xzf "$DL/llvm.tgz" -C "$DEST/llvm"
  tar xzf "$DL/binaryen.tgz" -C "$DEST/binaryen" --strip-components=1
  tar xzf "$DL/sysroot.tgz" -C "$DEST/sysroot" --strip-components=1
  "$DEST/bin/wasixccenv" install-executables "$DEST/bin" >&2

  # The npm sysroot ships lib/wasm32-wasip1 (no package symlinks); clang 21
  # with wasixcc's --target=wasm32-wasi looks in lib/wasm32-wasi.
  for v in sysroot sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic; do
    test -d "$DEST/sysroot/$v/lib/wasm32-wasip1"
    ln -sfn wasm32-wasip1 "$DEST/sysroot/$v/lib/wasm32-wasi"
  done
  echo "$PIN" > "$STAMP"
  echo "== install-wasixcc: installed $PIN → $DEST" >&2
fi

cat <<EOF
export WASIXCC_HOME=$(printf %q "$DEST")
export WASIXCC_PREFIX=$(printf %q "$DEST")
export WASIXCC_LLVM_LOCATION=$(printf %q "$DEST/llvm")
export WASIXCC_BINARYEN_LOCATION=$(printf %q "$DEST/binaryen")
export WASIXCC_SYSROOT_PREFIX=$(printf %q "$DEST/sysroot")
export PATH=$(printf %q "$DEST/bin"):\$PATH
EOF
