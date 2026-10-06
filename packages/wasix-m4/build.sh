#!/usr/bin/env bash
# Cross-build GNU m4 for slicc WASIX via wasixcc.
set -euo pipefail
HOMESCOOP_ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=/dev/null
source "$HOMESCOOP_ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-m4

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
VER="$VERSION"
WORK="${WASIX_M4_WORK:-$PKG/work}"
SRC="$WORK/m4-$VER"
WASM_OPT="${WASM_OPT:-$HOME/.wasixcc/binaryen/bin/wasm-opt}"

export PATH="${WASIXCC_PREFIX:-/tmp/wasix-python-build/wasixcc-prefix}/bin:/opt/homebrew/bin:$HOME/.wasixcc/binaryen/bin:$HOME/.wasixcc/llvm/bin:$PATH"
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS="${WASIXCC_WASM_EXCEPTIONS:-no}"
export WASIXCC_PIC=no
export WASIXCC_MODULE_KIND="${WASIXCC_MODULE_KIND:-static-main}"

command -v wasixcc >/dev/null
mkdir -p "$WORK" "$DEST/bin"

TARBALL="$WORK/m4-${VER}.tar.xz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"

if [[ ! -d "$SRC" || -n "${FORCE:-}" ]]; then
  rm -rf "$SRC"
  tar xJf "$TARBALL" -C "$WORK"
fi

homescoop_apply_patches "$SRC"

# Timeout wrapper — some gnulib link probes hang under wasixcc
CCWRAP="$WORK/wasixcc-timeout"
cat > "$CCWRAP" <<'WRAP'
#!/bin/bash
GT=$(command -v gtimeout || command -v timeout || true)
if [[ -n "$GT" ]]; then exec "$GT" 45 wasixcc "$@"; fi
exec wasixcc "$@"
WRAP
chmod +x "$CCWRAP"

SYSROOT="${WASIXCC_SYSROOT:-$HOME/.wasixcc/sysroot/sysroot}"
cd "$SRC"
if [[ ! -f config.status || -n "${FORCE_CONFIGURE:-}" ]]; then
  # Seed cache for probes that hang or mis-detect under wasm cross
  cat > config.cache <<'CACHE'
am_cv_langinfo_codeset=${am_cv_langinfo_codeset=no}
ac_cv_func_nl_langinfo=${ac_cv_func_nl_langinfo=no}
ac_cv_func_fork=${ac_cv_func_fork=yes}
ac_cv_func_pipe=${ac_cv_func_pipe=yes}
ac_cv_func_fcntl=${ac_cv_func_fcntl=yes}
gl_cv_func_printf_directive_n=${gl_cv_func_printf_directive_n=no}
gl_cv_malloc_ptrdiff=${gl_cv_malloc_ptrdiff=yes}
ac_cv_func_malloc_0_nonnull=${ac_cv_func_malloc_0_nonnull=yes}
ac_cv_func_getprogname=${ac_cv_func_getprogname=no}
CACHE
  ./configure \
    --host=wasm32-wasix \
    --build="$(uname -m)-apple-darwin" \
    --prefix=/usr \
    --disable-nls \
    --cache-file=config.cache \
    CC="$CCWRAP" LD=wasixcc AR=wasixar RANLIB=wasixranlib \
    CPP="$HOME/.wasixcc/llvm/bin/clang --target=wasm32-wasi --sysroot=$SYSROOT -E" \
    CFLAGS="-O2 -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_MMAN" \
    LDFLAGS="-lwasi-emulated-getpid -lwasi-emulated-process-clocks -lwasi-emulated-mman"
fi

make -j"${HOMESCOOP_JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}"
cp -f src/m4 "$DEST/bin/m4.wasm"
chmod +x "$DEST/bin/m4.wasm"

if [[ -x "$WASM_OPT" ]]; then
  "$WASM_OPT" --asyncify -O1 \
    --pass-arg=asyncify-imports@wasix_32v1.proc_fork,wasix_32v1.stack_checkpoint,wasix_32v1.stack_restore \
    "$DEST/bin/m4.wasm" -o "$DEST/bin/m4.wasm.tmp"
  mv "$DEST/bin/m4.wasm.tmp" "$DEST/bin/m4.wasm"
fi

homescoop_stage_license "$SRC/COPYING"
echo "== wasix-m4 staged $(du -sh "$DEST/bin/m4.wasm" | awk '{print $1}')"
