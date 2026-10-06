#!/usr/bin/env bash
# GNU nano + static widec ncurses — same Emscripten/slicc path as wasm-less.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe nano
homescoop_load_recipe nano --source ncurses

NANO_VER="$VERSION"
NANO_TB="$WORK/nano-$NANO_VER.tar.gz"
NC_TB="$WORK/ncurses-$NCURSES_VER.tar.gz"
NC_SRC="$WORK/ncurses-$NCURSES_VER"
NANO_SRC="$WORK/nano-$NANO_VER"
HOST_PREFIX="$WORK/ncurses-host"
WASM_PREFIX="$WORK/ncurses-wasm-prefix"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$NANO_TB"
homescoop_fetch "$NCURSES_URL" "$NCURSES_SHA" "$NC_TB"

if [[ -n "${FORCE:-}" ]]; then
  rm -rf "$NC_SRC" "$NANO_SRC" "$HOST_PREFIX" "$WASM_PREFIX"
fi

# --- host tic/infocmp from the same ncurses ---
if [[ ! -x "$HOST_PREFIX/bin/tic" ]]; then
  echo "== nano: native ncurses (tic/infocmp)"
  HOST_SRC="$WORK/ncurses-host-src"
  rm -rf "$HOST_SRC"
  mkdir -p "$HOST_SRC"
  tar xzf "$NC_TB" -C "$HOST_SRC"
  (
    cd "$HOST_SRC/ncurses-$NCURSES_VER"
    ./configure --prefix="$HOST_PREFIX" \
      --without-shared --without-cxx --without-ada --without-tests \
      --without-manpages --enable-widec
    make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
    make install.progs
  )
fi
test -x "$HOST_PREFIX/bin/tic"
test -x "$HOST_PREFIX/bin/infocmp"

# --- wasm ncurses with compiled-in fallbacks ---
homescoop_extract "$NC_TB" "$NC_SRC"
MKF="$NC_SRC/ncurses/tinfo/MKfallback.sh"
if [[ -f "$MKF" ]] && grep -q 's/\\<short\\>/NCURSES_INT2/g' "$MKF"; then
  echo "== nano: patch MKfallback.sh for portable sed"
  perl -i -pe 's#s/\\<short\\>/NCURSES_INT2/g#s/^static short /static NCURSES_INT2 /#' "$MKF"
  grep -q 'static NCURSES_INT2' "$MKF"
fi

if [[ ! -f "$WASM_PREFIX/lib/libncursesw.a" || -n "${FORCE:-}" || -n "${FORCE_NCURSES:-}" ]]; then
  echo "== nano: emconfigure ncurses (widec, fallbacks)"
  (
    cd "$NC_SRC"
    if [[ -f Makefile ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    BUILD_TRIPLE="$(cc -dumpmachine 2>/dev/null || echo x86_64-pc-linux-gnu)"
    # Build helpers (make_hash) must be native — same flags as bash/screen.
    emconfigure ./configure \
      --with-tic-path="$HOST_PREFIX/bin/tic" \
      --with-infocmp-path="$HOST_PREFIX/bin/infocmp" \
      --host=wasm32-unknown-emscripten --build="$BUILD_TRIPLE" \
      --prefix="$WASM_PREFIX" --with-build-cc=cc \
      --without-shared --without-cxx --without-cxx-binding \
      --without-ada --without-progs --without-tests --without-manpages \
      --without-debug --enable-widec --disable-database --disable-stripping \
      --with-fallbacks=xterm-256color,xterm,vt100,dumb
    homescoop_fix_darwin_ar Makefile
    while IFS= read -r -d '' mf; do
      homescoop_fix_darwin_ar "$mf"
    done < <(find . -name Makefile -print0)
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" libs
    emmake make install.libs install.includes
  )
fi
test -f "$WASM_PREFIX/lib/libncursesw.a"
ln -sf libncursesw.a "$WASM_PREFIX/lib/libncurses.a"
ln -sf libncursesw.a "$WASM_PREFIX/lib/libtinfo.a"

homescoop_extract "$NANO_TB" "$NANO_SRC"

SLICC_A="$WORK/libslicc-nano.a"
homescoop_slicc_archive "$SLICC_A" less

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=2097152 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports)"

if [[ ! -f "$NANO_SRC/src/nano" && ! -f "$NANO_SRC/src/nano.js" || -n "${FORCE:-}" ]]; then
  echo "== nano: emconfigure + emmake"
  (
    cd "$NANO_SRC"
    if [[ -f Makefile ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    # No spell/libmagic; curses required. Disable tiny extras that need host tools.
    CPPFLAGS="-I$WASM_PREFIX/include -I$WASM_PREFIX/include/ncursesw" \
      LDFLAGS="-L$WASM_PREFIX/lib" \
      emconfigure ./configure --host=wasm32-unknown-emscripten \
        --disable-nls --disable-libmagic --disable-speller \
        --enable-utf8 \
        --with-curses="$WASM_PREFIX" \
        CC_FOR_BUILD=cc
    homescoop_fix_darwin_ar Makefile
    emmake make -j"${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}" \
      LIBS="-lncursesw $SLICC_A $CLI_LDFLAGS" LDFLAGS_FOR_BUILD=
  )
fi
# Binary may land as src/nano or src/nano.js+wasm depending on emcc output name
NANO_BIN=""
for cand in "$NANO_SRC/src/nano" "$NANO_SRC/src/nano.js" "$NANO_SRC/nano" "$NANO_SRC/nano.js"; do
  if [[ -f "$cand" ]]; then NANO_BIN="$cand"; break; fi
done
test -n "$NANO_BIN"
# homescoop_stage_cli expects basename without path suffix; stage from dir
homescoop_stage_cli "$(dirname "$NANO_BIN")" nano
homescoop_stage_license "$NANO_SRC"/COPYING "$NANO_SRC"/COPYING.DOC

PKG_JSON="$HOMESCOOP_PKG/package/package.json"
python3 - "$PKG_JSON" "$NANO_VER" <<'PY'
import json, sys
from pathlib import Path
path, ver = Path(sys.argv[1]), sys.argv[2]
pkg = {
    "name": "@ai-ecoverse/wasm-nano",
    "version": f"{ver}-1",
    "description": "GNU nano with static ncurses 6.5 for wasm / slicc (emscripten)",
    "license": "GPL-3.0-or-later",
    "repository": {
        "type": "git",
        "url": "git+https://github.com/ai-ecoverse/homescoop.git",
        "directory": "packages/nano/package",
    },
    "homepage": "https://github.com/ai-ecoverse/homescoop/tree/main/packages/nano",
    "keywords": ["wasm", "emscripten", "slicc", "homescoop", "nano", "editor"],
    "files": ["README.md", "LICENSE", "bin", "PRESTAGE.md"],
    "publishConfig": {"access": "public"},
    "homescoop": {"recipe": "nano", "upstream": ver, "ncurses": "6.5"},
    "slicc": {
        "abi": "emscripten",
        "commands": {
            "nano": {
                "glue": "bin/nano",
                "wasm": "bin/nano.wasm",
                "env": {"TERM": "xterm-256color"},
            }
        },
    },
}
if path.is_file():
    old = json.loads(path.read_text())
    if old.get("version", "").startswith(ver + "-"):
        pkg["version"] = old["version"]
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(pkg, indent=2) + "\n")
print("package.json", pkg["version"])
PY

cat > "$HOMESCOOP_PKG/package/README.md" <<EOF
# \`@ai-ecoverse/wasm-nano\`

GNU nano ${NANO_VER} with static widec ncurses 6.5 for slicc (Emscripten ABI,
same path as \`@ai-ecoverse/wasm-less\`). Full-screen editor in the panel
terminal; no PTY required.
EOF
cp "$HOMESCOOP_PKG/package/README.md" "$HOMESCOOP_PKG/README.md" 2>/dev/null || true

cat > "$HOMESCOOP_PKG/package/PRESTAGE.md" <<EOF
# wasm-nano ${NANO_VER}-1

Emscripten + static \`libncursesw\` (fallbacks: xterm-256color,xterm,vt100,dumb).
Same curses ABI as wasm-less. Interactive — certify in the **browser** harness.

## Smoke (host, non-interactive)
\`\`\`sh
SMOKE_WORKDIR=\$TMP node scripts/run-wasm-cli.mjs packages/nano/package/bin/nano -- --version
\`\`\`

## Browser acceptance
Open a file, edit, save (^O), exit (^X). TERM=xterm-256color.
EOF
cp "$HOMESCOOP_PKG/package/PRESTAGE.md" "$HOMESCOOP_PKG/PRESTAGE.md"

echo "== nano: staged → $HOMESCOOP_PKG/package"

