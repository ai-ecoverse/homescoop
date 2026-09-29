#!/bin/bash
# GNU bash with readline (line editing, history, completion) over ncurses' terminfo:
# the interactive variant of build-wasm-bash.sh, for the panel terminal.
# Scripts first: no readline or history yet. Job control stays on: only
# jobs.c records every pipeline stage (PIPESTATUS, pipefail).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export EM_CONFIG="$ROOT/emscripten-config" EM_CACHE="$ROOT/cache" EMSDK_PYTHON=/opt/homebrew/bin/python3.13
export PATH="$ROOT/install/bin:$PATH"
EM="$ROOT/src/emscripten"
OUT="$ROOT/build/bash-rl-wasm"
NC="$ROOT/build/less-wasm/prefix"
SRC="$OUT/bash-5.3"
mkdir -p "$OUT"
if [ ! -f "$SRC/configure" ]; then
  tar xzf "$ROOT/src/bash-5.3.tar.gz" -C "$OUT"
  # Emscripten calls main(argc, argv) only: bash reads environ instead.
  patch -d "$SRC" -p1 < "$ROOT/patches/bash-5.3-emscripten-environ.patch"
fi
cd "$SRC"
# configure runs its test programs under node on the host, so a few answers
# describe the host (or a failed probe), not slicc:
# - wait statuses are encoded exit << 8 (musl, slicc_spawn.c);
# - slicc has no /dev/fd or /dev/stdin;
# - Emscripten's musl has POSIX signals, and getcwd(NULL, 0) allocates (else
#   bash walks .. comparing inode numbers, which the slicc VFS mount fails);
# - <sys/random.h> declares getrandom, which libc lacks: hide the header so
#   bash's own fallback (getentropy) doesn't clash with the declaration.
export bash_cv_wexitstatus_offset=8 bash_cv_dev_fd=absent bash_cv_dev_stdin=absent \
  bash_cv_signal_vintage=posix bash_cv_getcwd_malloc=yes ac_cv_header_sys_random_h=no
if [ ! -f Makefile ] || [ "${RECONFIGURE:-}" ]; then
  [ -f Makefile ] && make distclean >/dev/null 2>&1 || true
  "$EM/emconfigure" ./configure --host=wasm32-unknown-emscripten --without-bash-malloc \
    --disable-nls --with-curses --enable-readline --enable-history --without-installed-readline \
    CPPFLAGS="-I$NC/include -I$NC/include/ncursesw" LDFLAGS="-L$NC/lib" \
    CC_FOR_BUILD=cc >"$OUT/configure.log" 2>&1
fi
# fork/execve (slicc/lib/slicc_fork.c, slicc-fork.js, slicc_exec.c) over
# slicc_spawn.c; the
# glue exports sliccRunMain, which run-tool.js calls instead of callMain.
"$EM/emcc" -O2 -c "$ROOT/slicc/lib/slicc_spawn.c" -o "$OUT/slicc_spawn.o"
"$EM/emcc" -O2 -c "$ROOT/slicc/lib/slicc_exec.c" -o "$OUT/slicc_exec.o"
"$EM/emcc" -O2 -c "$ROOT/slicc/lib/slicc_fork.c" -o "$OUT/slicc_fork.o"
"$EM/emcc" -O2 -c "$ROOT/slicc/lib/slicc_signals.c" -o "$OUT/slicc_signals.o"
"$EM/emcc" -O2 -c "$ROOT/slicc/lib/slicc_libc_gaps.c" -o "$OUT/slicc_libc_gaps.o"
"$EM/emcc" -O2 -c "$ROOT/slicc/lib/slicc_jobs.c" -o "$OUT/slicc_jobs.o"
"$EM/emcc" -O2 -c "$ROOT/slicc/lib/slicc_select.c" -o "$OUT/slicc_select.o"
LINK="$OUT/slicc_spawn.o $OUT/slicc_exec.o $OUT/slicc_fork.o $OUT/slicc_signals.o $OUT/slicc_libc_gaps.o $OUT/slicc_jobs.o $OUT/slicc_select.o --js-library $ROOT/slicc/lib/slicc-fork.js -sASYNCIFY \
  -sASYNCIFY_STACK_SIZE=1048576 -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 \
  -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain,sliccRunMain,sliccForkChild -sENVIRONMENT=web,worker,node"
rm -f bash bash.wasm shell.o
# Signal names come from the target's <signal.h> at run time (bash's cross
# mode): mksignames runs on the build machine, whose numbers differ (macOS
# SIGUSR1 is 30, SIGCHLD 20). Drop a header generated the host way.
if ! grep -q "extern char \*signal_names" lsignames.h 2>/dev/null; then
  rm -f lsignames.h signames.h mksignames mksignames.o buildsignames.o signames.o trap.o
fi
# LDFLAGS_FOR_BUILD would otherwise inherit the wasm link flags (via LDFLAGS).
"$EM/emmake" make -j8 ADDON_LDFLAGS="$LINK" LDFLAGS_FOR_BUILD= \
  LOCAL_DEFS="-DSHELL -DCROSS_COMPILING" SIGNAMES_O=signames.o >"$OUT/build.log" 2>&1 || {
  grep -E "error:|undefined symbol" "$OUT/build.log" | sort | uniq -c | sort -rn | head -20
  exit 1
}
ls -la bash bash.wasm
