#!/usr/bin/env bash
# GNU screen — Emscripten + slicc fork/ASYNCIFY (same path as bash/git).
# Requires SLICC PTY ioctls (PR #3733): /dev/ptmx, openpty, TIOCSCTTY, …
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe screen
homescoop_load_recipe screen --source ncurses

SRC_DIR="$WORK/screen-$VERSION"
TARBALL="$WORK/screen-$VERSION.tar.gz"
NC_TB="$WORK/ncurses-$NCURSES_VER.tar.gz"
NC_SRC="$WORK/ncurses-$NCURSES_VER"
HOST_PREFIX="$WORK/ncurses-host"
WASM_PREFIX="$WORK/ncurses-wasm-prefix"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
homescoop_fetch "$NCURSES_URL" "$NCURSES_SHA" "$NC_TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"

JOBS="${HOMESCOOP_JOBS:-4}"

# --- host tic/infocmp ---
if [[ ! -x "$HOST_PREFIX/bin/tic" ]]; then
  echo "== screen: native ncurses (tic/infocmp)"
  HOST_SRC="$WORK/ncurses-host-src"
  rm -rf "$HOST_SRC"
  mkdir -p "$HOST_SRC"
  tar xzf "$NC_TB" -C "$HOST_SRC"
  (
    cd "$HOST_SRC/ncurses-$NCURSES_VER"
    ./configure --prefix="$HOST_PREFIX" \
      --without-shared --without-cxx --without-ada --without-tests \
      --without-manpages --enable-widec
    make -j"$JOBS"
    make install.progs
  )
fi
test -x "$HOST_PREFIX/bin/tic"

# --- wasm ncurses (tgetent) ---
homescoop_extract "$NC_TB" "$NC_SRC"
MKF="$NC_SRC/ncurses/tinfo/MKfallback.sh"
if [[ -f "$MKF" ]] && grep -q 's/\\<short\\>/NCURSES_INT2/g' "$MKF"; then
  echo "== screen: patch MKfallback.sh for portable sed"
  perl -i -pe 's#s/\\<short\\>/NCURSES_INT2/g#s/^static short /static NCURSES_INT2 /#' "$MKF"
fi

if [[ ! -f "$WASM_PREFIX/lib/libncursesw.a" || -n "${FORCE_NCURSES:-}" ]]; then
  echo "== screen: emconfigure ncurses (widec, fallbacks)"
  (
    cd "$NC_SRC"
    if [[ -f Makefile ]]; then make distclean >/dev/null 2>&1 || true; fi
    BUILD_TRIPLE="$(cc -dumpmachine 2>/dev/null || echo x86_64-pc-linux-gnu)"
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
    emmake make -j"$JOBS" libs
    emmake make install.libs install.includes
  )
fi
test -f "$WASM_PREFIX/lib/libncursesw.a"
ln -sf libncursesw.a "$WASM_PREFIX/lib/libncurses.a"
ln -sf libncursesw.a "$WASM_PREFIX/lib/libtinfo.a"
ln -sf libncursesw.a "$WASM_PREFIX/lib/libtinfow.a"

SLICC_A="$WORK/libslicc-screen.a"
# netfork: AF_UNIX SOCK_STREAM (slicc_socket) + select/poll + fork/ASYNCIFY + jobs/signals
# (incl. __syscall_pause). whole-archive so socket syscalls beat SOCKFS.
homescoop_slicc_archive "$SLICC_A" netfork

# Emscripten libc omits legacy getdtablesize + shadow getspnam.
STUBS_O="$WORK/em-stubs.o"
emcc -c "$HOMESCOOP_PKG/em-stubs.c" -o "$STUBS_O"

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=2097152 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,ENV,callMain,sliccRunMain,sliccForkChild -lnodefs.js $(homescoop_slicc_fork_js_flags)"
LINK="$(homescoop_slicc_link_archive "$SLICC_A") $(homescoop_em_cli_ldflags) $STUBS_O"

CONFIG_LOG="$WORK/screen-configure-summary.txt"
# Relink when stubs change or FORCE set; objects may already exist.
if [[ ! -f "$SRC_DIR/screen" && ! -f "$SRC_DIR/screen.js" || -n "${FORCE:-}" || ! -f "$SRC_DIR/screen.wasm" ]]; then
  echo "== screen: emconfigure + emmake"
  (
    cd "$SRC_DIR"
    if [[ -f Makefile ]] && [[ -n "${FORCE:-}" ]]; then
      make distclean >/dev/null 2>&1 || true
    fi
    if [[ ! -f config.h ]]; then
    # Defaults we care about (see configure.ac):
    #   --enable-socket-dir default=no  → no SOCKET_DIR; use $SCREENDIR / $HOME/.screen
    #   --enable-pam default=yes        → disable (no libpam)
    #   --enable-utmp / --enable-telnet default=no
    CPPFLAGS="-I$WASM_PREFIX/include -I$WASM_PREFIX/include/ncursesw" \
      LDFLAGS="-L$WASM_PREFIX/lib" \
      emconfigure ./configure --host=wasm32-unknown-emscripten \
        --disable-pam --disable-utmp --disable-telnet \
        --disable-socket-dir \
        --with-system_screenrc=/etc/screenrc \
        --with-pty-mode=0622 --with-pty-group=0 \
        CC_FOR_BUILD=cc \
      2>&1 | tee "$WORK/screen-configure.log"
    test -f config.h
    awk '/^Configuration:/{p=1} p' "$WORK/screen-configure.log" >"$CONFIG_LOG"
    {
      echo "--- config.h highlights ---"
      grep -E 'HAVE_OPENPTY|SOCKET_DIR|ENABLE_PAM|ENABLE_UTMP|ENABLE_TELNET|PTY_MODE|PTY_GROUP|SYSTEM_SCREENRC' config.h || true
      echo "--- LIBS ---"
      grep -E '^LIBS |^LIBS=' Makefile | head -10 || true
    } | tee -a "$CONFIG_LOG"
    echo "== screen configure summary:"
    cat "$CONFIG_LOG"
    homescoop_fix_darwin_ar Makefile
    fi
    rm -f screen screen.js screen.wasm
    # Keep configure LIBS (ncurses/crypt/openpty); append slicc link flags + stubs.
    emmake make -j"$JOBS" LDFLAGS="-L$WASM_PREFIX/lib $LINK"
  )
fi
# Always attempt link if objects exist but binary missing (stubs fix path).
if [[ ! -f "$SRC_DIR/screen" && ! -f "$SRC_DIR/screen.js" ]]; then
  echo "== screen: relink with em-stubs"
  (
    cd "$SRC_DIR"
    rm -f screen screen.js screen.wasm
    emmake make -j"$JOBS" LDFLAGS="-L$WASM_PREFIX/lib $LINK"
  )
fi
test -f "$SRC_DIR/screen" || test -f "$SRC_DIR/screen.js"
homescoop_stage_cli "$SRC_DIR" screen
homescoop_stage_license "$SRC_DIR"/COPYING "$SRC_DIR"/LICENSE
homescoop_notices_begin "screen.wasm statically links the following."
homescoop_notice "ncurses $NCURSES_VER (built from the pinned source tarball)" "$NC_SRC"/COPYING -
homescoop_notice_emscripten

# package.json — SCREENDIR so sockets land in /tmp (AF_UNIX path-bound; -ls empty)
PKG_JSON="$HOMESCOOP_PKG/package/package.json"
python3 - "$PKG_JSON" "$VERSION" <<'PY'
import json, sys
from pathlib import Path
path, ver = Path(sys.argv[1]), sys.argv[2]
pkg = {
    "name": "@ai-ecoverse/wasm-screen",
    "version": f"{ver}-1",
    "description": "GNU screen for slicc (emscripten ABI; asyncify fork; PTY via musl+SLICC #3733)",
    "license": "GPL-3.0-or-later",
    "repository": {
        "type": "git",
        "url": "git+https://github.com/ai-ecoverse/homescoop.git",
        "directory": "packages/screen/package",
    },
    "homepage": "https://github.com/ai-ecoverse/homescoop/tree/main/packages/screen",
    "keywords": ["wasm", "emscripten", "slicc", "homescoop", "screen", "pty"],
    "files": ["README.md", "LICENSE", "bin", "PRESTAGE.md"],
    "publishConfig": {"access": "public", "tag": "next"},
    "homescoop": {"recipe": "screen", "upstream": ver, "pty": "emscripten+SLICC#3733"},
    "slicc": {
        "abi": "emscripten",
        "commands": {
            "screen": {
                "glue": "bin/screen",
                "wasm": "bin/screen.wasm",
                "env": {
                    "SCREENDIR": "/tmp/screens",
                    "TERM": "xterm-256color",
                },
            }
        },
    },
}
if path.is_file():
    old = json.loads(path.read_text())
    # Keep packaging rev if already bumped beyond -1
    if old.get("version", "").startswith(ver + "-"):
        pkg["version"] = old["version"]
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(pkg, indent=2) + "\n")
print("package.json", pkg["version"])
PY

cat > "$HOMESCOOP_PKG/package/README.md" <<EOF
# \`@ai-ecoverse/wasm-screen\`

GNU screen ${VERSION} for slicc (Emscripten ABI). Needs SLICC PTY ioctls
(PR #3733). Dist-tag \`next\` only until the kernel lands.

Sockets: \`SCREENDIR=/tmp/screens\` (no global SOCKET_DIR). \`screen -ls\` may
show nothing — AF_UNIX paths are not VFS-readdir visible yet.
EOF
cp "$HOMESCOOP_PKG/package/README.md" "$HOMESCOOP_PKG/README.md" 2>/dev/null || true

cat > "$HOMESCOOP_PKG/package/PRESTAGE.md" <<EOF
# wasm-screen ${VERSION}-5 (next)

Emscripten + asyncify fork. SLICC PR **#3733** (pseudo-terminals) has merged.
libc includes musl \`passwd/\` (reads \`/etc/passwd\` + \`/etc/group\` from VFS).
\`slicc_libc_gaps\` strong set*id/setgroups: succeed for uid/gid 1000, else EPERM.
Linked \`netfork\` profile: \`slicc_socket\` (AF_UNIX SOCK_STREAM) + \`slicc_select\` +
\`__syscall_pause\` (SLICC #3740).
\`slicc_sig_mask\` rebuilt against host emsdk musl (\`sizeof(sigaction)==140\`);
stale stride-20 objs made every disposition bit garbage (attacher SIGHUP → Hangup).

## Configure picks (this build)
\`\`\`
$(cat "$CONFIG_LOG" 2>/dev/null || echo "(run build to populate)")
\`\`\`

## Smoke (host)
\`\`\`sh
SMOKE_WORKDIR=\$TMP node scripts/run-wasm-cli.mjs packages/screen/package/bin/screen -- -v
SMOKE_ENV=SCREENDIR=/tmp/screens,HOME=/tmp,TERM=xterm-256color \\
  SMOKE_WORKDIR=\$TMP node scripts/run-wasm-cli.mjs packages/screen/package/bin/screen -- -dmS test sleep 2
\`\`\`
Browser: multi-window (^A c / ^A n / ^A "); clean frontend exit on backend SIG_BYE
(not \`[screen is terminating]\` + Hangup). \`screen -ls\` may be empty.
EOF
cp "$HOMESCOOP_PKG/package/PRESTAGE.md" "$HOMESCOOP_PKG/PRESTAGE.md"

echo "== screen: staged → $HOMESCOOP_PKG/package"
ls -la "$HOMESCOOP_PKG/package/bin"
