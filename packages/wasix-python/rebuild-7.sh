#!/usr/bin/env bash
# Rebuild wasix-python 3.14.2-7 from the -6 tree + stdout line-buffering patch.
# Stage only — do not publish.
set -euo pipefail

export PATH="/tmp/wasix-python-build/wasixcc-prefix/bin:/opt/homebrew/bin:$HOME/.wasixcc/binaryen/bin:/opt/homebrew/Cellar/wabt/1.0.41/bin:$HOME/.wasixcc/llvm/bin:$PATH"
export WASIXCC_RUN_WASM_OPT=no WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes
export WASIXCC_MODULE_KIND=dynamic-main WASIXCC_INCLUDE_CPP_SYMBOLS=yes
export AR=wasixar RANLIB=wasixranlib
unset FREETYPE FREETYPE_ROOT JPEG JPEG_ROOT PNG_ROOT ZLIB_ROOT VIRTUAL_ENV PYTHONPATH
unset PKG_CONFIG_LIBDIR ZLIB CFLAGS CPPFLAGS LDFLAGS CXX

BUILD=/tmp/wasix-python-build/Python-3.14.2/cross-build/wasm32-wasix-ehpic
SRC=/tmp/wasix-python-build/Python-3.14.2
PKG=/Users/trieloff/Developer/ai-ecoverse/homescoop/packages/wasix-python
STAGE=/tmp/wasix-python-stage-ehpic
SLICC=/Users/trieloff/Developer/ai-ecoverse/slicc-emscripten/tmp-wasi/staging/wasix-python
WASM_OPT="$HOME/.wasixcc/binaryen/bin/wasm-opt"
OPENSSL=/tmp/wasix-openssl-prefix
ZLIB=/tmp/wasix-zlib-prefix
COMP=/tmp/wasix-comp-prefix
STUB_CPP=/tmp/wasix-python-build/cpp-stubs/cpp_tls_stubs.o
STUB_DL=/tmp/wasix-python-build/ssl-stubs/dladdr_stub.o
STUB_DIR=/tmp/wasix-python-build/uid-stubs
WANT_EXT=".cpython-314-wasm32-wasix.so"
EXTRA_H="$PKG/fcntl_wasix_extra.h"
PATCH="$PKG/patches/cpython-stdout-line-buffer-nonreg.patch"

test -f "$COMP/lib/libbz2.a"
test -f "$STUB_CPP"
test -f "$STUB_DL"
test -f "$EXTRA_H"
test -f "$PATCH"
test -d "$BUILD"

echo "== apply stdout line-buffer patch =="
cd "$SRC"
if grep -q 'Line-buffer tty and stderr as usual. On WASIX' Python/pylifecycle.c; then
  echo "already patched"
elif ! patch -p1 --dry-run < "$PATCH" >/tmp/wasix-python-build/patch-7-dry.log 2>&1; then
  echo "FAIL: patch dry-run" >&2
  cat /tmp/wasix-python-build/patch-7-dry.log >&2
  exit 1
else
  patch -p1 < "$PATCH"
fi
grep -n 'S_ISREG\|Line-buffer tty' Python/pylifecycle.c | head

mkdir -p "$STUB_DIR"
wasixcc -c -O2 -fPIC -matomics -mbulk-memory -mmutable-globals -pthread \
  -o "$STUB_DIR/uid_stubs.o" "$PKG/uid_stubs.c"
wasixcc -c -O2 -fPIC -matomics -mbulk-memory -mmutable-globals -pthread \
  -o "$STUB_DIR/pwd_grp_stubs.o" "$PKG/pwd_grp_stubs.c"
wasixcc -c -O2 -fPIC -matomics -mbulk-memory -mmutable-globals -pthread \
  -I"$PKG" -include "$EXTRA_H" \
  -o "$STUB_DIR/lock_stubs.o" "$PKG/lock_stubs.c"
UID_STUB="$STUB_DIR/uid_stubs.o"
PWD_STUB="$STUB_DIR/pwd_grp_stubs.o"
LOCK_STUB="$STUB_DIR/lock_stubs.o"

WRAP_FLAGS=(
  -Wl,--wrap=getuid -Wl,--wrap=geteuid -Wl,--wrap=getgid -Wl,--wrap=getegid
  -Wl,--wrap=getpwuid -Wl,--wrap=getpwnam -Wl,--wrap=getpwuid_r -Wl,--wrap=getpwnam_r
  -Wl,--wrap=getgrgid -Wl,--wrap=getgrnam -Wl,--wrap=getgrgid_r -Wl,--wrap=getgrnam_r
  -Wl,--wrap=flock -Wl,--wrap=fcntl -Wl,--wrap=lockf
  -Wl,--export=__wrap_getuid -Wl,--export=__wrap_geteuid
  -Wl,--export=__wrap_getgid -Wl,--export=__wrap_getegid
  -Wl,--export=__wrap_flock -Wl,--export=__wrap_fcntl -Wl,--export=__wrap_lockf
)

cd "$BUILD"

echo "== ensure Makefile LIBS still has lock stubs + wraps =="
python3 - "$OPENSSL" "$ZLIB" "$COMP" "$STUB_CPP" "$STUB_DL" \
  "$UID_STUB" "$PWD_STUB" "$LOCK_STUB" <<'PY'
import re, sys
from pathlib import Path
OPENSSL, ZLIB, COMP = sys.argv[1:4]
STUB_CPP, STUB_DL, UID_STUB, PWD_STUB, LOCK_STUB = sys.argv[4:9]
wrap = (
    "-Wl,--wrap=getuid -Wl,--wrap=geteuid -Wl,--wrap=getgid -Wl,--wrap=getegid "
    "-Wl,--wrap=getpwuid -Wl,--wrap=getpwnam -Wl,--wrap=getpwuid_r -Wl,--wrap=getpwnam_r "
    "-Wl,--wrap=getgrgid -Wl,--wrap=getgrnam -Wl,--wrap=getgrgid_r -Wl,--wrap=getgrnam_r "
    "-Wl,--wrap=flock -Wl,--wrap=fcntl -Wl,--wrap=lockf "
    "-Wl,--export=__wrap_getuid -Wl,--export=__wrap_geteuid "
    "-Wl,--export=__wrap_getgid -Wl,--export=__wrap_getegid "
    "-Wl,--export=__wrap_flock -Wl,--export=__wrap_fcntl -Wl,--export=__wrap_lockf"
)
libs = (
    f"\t\t-ldl -lwasi-emulated-getpid -lwasi-emulated-process-clocks "
    f"-lwasi-emulated-mman -lpthread {STUB_CPP} {STUB_DL} {UID_STUB} {PWD_STUB} {LOCK_STUB} "
    f"{wrap} "
    f"-L{OPENSSL}/lib -lssl -lcrypto -L{ZLIB}/lib -lz "
    f"-L{COMP}/lib -lbz2 -llzma -lsqlite3 -lreadline -ltermcap"
)
for name in ("Makefile", "Makefile.pre"):
    p = Path(name)
    if not p.exists():
        continue
    t = p.read_text()
    t2, n = re.subn(r"^LIBS=\s*.*", f"LIBS={libs}", t, count=1, flags=re.M)
    print(f"{name}:LIBS->{n}")
    p.write_text(t2)
PY

export CFLAGS="-O3 -flto -fPIC -matomics -mbulk-memory -mmutable-globals -pthread -mthread-model posix -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_MMAN -include ${EXTRA_H}"
export CPPFLAGS="$CFLAGS -I${COMP}/include"
export LDFLAGS="-O3 -flto -fPIC -pthread -Wl,-pie -Wl,--export-dynamic -Wl,--shared-memory -Wl,--import-memory -Wl,--max-memory=4294967296 -Wl,--stack-first -z stack-size=16777216 -Wl,--initial-memory=41943040 -ldl -lwasi-emulated-getpid -lwasi-emulated-process-clocks -lwasi-emulated-mman -L${OPENSSL}/lib -L${ZLIB}/lib -L${COMP}/lib ${WRAP_FLAGS[*]}"

echo "== rebuild pylifecycle.o =="
rm -f Python/pylifecycle.o python.wasm
make AR=wasixar RANLIB=wasixranlib Python/pylifecycle.o 2>&1 | tee /tmp/wasix-python-build/make-pylife-7.log | tail -30
test -f Python/pylifecycle.o

echo "== link python.wasm =="
make AR=wasixar RANLIB=wasixranlib python.wasm 2>&1 | tee /tmp/wasix-python-build/make-link-7.log | tail -40
test -f python.wasm
PRE=$(stat -f%z python.wasm)
echo "pre-asyncify: $PRE"

# Prefer /usr/bin/strings — llvm strings on PATH mishandles -a / may miss literals.
STRINGS=(/usr/bin/strings strings)
for s in "${STRINGS[@]}"; do
  command -v "$s" >/dev/null 2>&1 || continue
  STRINGS_BIN=$s
  break
done
if ! "$STRINGS_BIN" -a python.wasm | grep -Fq "$WANT_EXT"; then
  echo "FAIL pre-async: missing $WANT_EXT" >&2
  exit 1
fi
if "$STRINGS_BIN" -a python.wasm | grep -Fq 'wasi-threads.so'; then
  echo "FAIL pre-async: wasi-threads.so still present" >&2
  exit 1
fi

echo "== asyncify + strip =="
ONLYLIST="fork,_fork_internal,_Fork,__wasi_proc_fork,__fork_handler,os_fork,subprocess_fork_exec,subprocess_fork_exec_impl,do_fork_exec,PyOS_BeforeFork,PyOS_AfterFork_Parent,PyOS_AfterFork_Child,PyOS_AfterFork,run_at_forkers,posix_spawn,posix_spawnp,__posix_spawn,os_posix_spawn,py_posix_spawn,os_posix_spawnp"
FEATS=(--enable-threads --enable-bulk-memory --enable-mutable-globals --enable-sign-ext --enable-nontrapping-float-to-int --enable-exception-handling)
"$WASM_OPT" --asyncify -O3 \
  --pass-arg=asyncify-imports@wasix_32v1.proc_fork,wasix_32v1.stack_checkpoint,wasix_32v1.stack_restore \
  --pass-arg=asyncify-onlylist@"$ONLYLIST" \
  --pass-arg=asyncify-ignore-indirect \
  "${FEATS[@]}" \
  python.wasm -o /tmp/py-async.wasm 2>&1 | tee /tmp/wasix-python-build/asyncify-7.log | tail -8
mkdir -p "$STAGE/bin"
"$WASM_OPT" -O3 --strip-debug --strip-producers "${FEATS[@]}" \
  /tmp/py-async.wasm -o "$STAGE/bin/python.wasm"
FINAL=$(stat -f%z "$STAGE/bin/python.wasm")
echo "final: $FINAL"

echo "== PRESTAGE =="
bash "$PKG/prestage-check.sh" "$STAGE/bin/python.wasm" "$PKG/package/lib/python3.14"

cp "$STAGE/bin/python.wasm" "$PKG/package/bin/python.wasm"
chmod 755 "$PKG/package/bin/python.wasm"

python3 - <<'PY'
import json
from pathlib import Path
pj = Path("/Users/trieloff/Developer/ai-ecoverse/homescoop/packages/wasix-python/package/package.json")
d = json.loads(pj.read_text())
d["version"] = "3.14.2-7"
d["description"] = "CPython 3.14 for slicc WASIX (commands python, python3; stdout line-buffered unless regular file)"
d["slicc"]["python"]["soabi"] = "cpython-314-wasm32-wasix"
d["slicc"]["python"]["platform"] = "wasix_wasm32"
pj.write_text(json.dumps(d, indent=2) + "\n")
print("version", d["version"])
PY

# README one-liner
python3 - <<'PY'
from pathlib import Path
p = Path("/Users/trieloff/Developer/ai-ecoverse/homescoop/packages/wasix-python/package/README.md")
t = p.read_text()
note = "stdout is line-buffered unless it is a regular file, so output streams and survives crashes"
if note not in t:
    # insert as a Features bullet before PRESTAGE or at end of Features list
    bullet = f"- {note}"
    if "- PRESTAGE:" in t:
        t = t.replace("- PRESTAGE:", bullet + "\n- PRESTAGE:", 1)
    elif "## Features" in t:
        # after first Features section bullets — append before blank line after features
        t = t.replace(
            "- wasix-libc `setitimer`/`alarm` patch:",
            bullet + "\n- wasix-libc `setitimer`/`alarm` patch:",
            1,
        )
    else:
        t = t.rstrip() + "\n\n- " + note + "\n"
    p.write_text(t)
    print("README updated")
else:
    print("README already notes line buffering")
PY

bash "$PKG/prestage-check.sh" "$PKG/package/bin/python.wasm" "$PKG/package/lib/python3.14"

mkdir -p "$SLICC/bin" "$SLICC/lib" "$SLICC/include"
cp "$PKG/package/bin/python.wasm" "$SLICC/bin/python.wasm"
cp "$PKG/package/package.json" "$PKG/package/README.md" "$PKG/package/LICENSE" "$PKG/package/SOABI.assert" "$SLICC/"
rsync -a --delete "$PKG/package/include/" "$SLICC/include/"
rsync -a --delete "$PKG/package/lib/" "$SLICC/lib/"
rsync -a --delete "$PKG/package/lib/" "$STAGE/lib/"
cp "$PKG/package/bin/python.wasm" "$STAGE/bin/python.wasm"

bash "$PKG/prestage-check.sh" "$SLICC/bin/python.wasm" "$SLICC/lib/python3.14"

# PRESTAGE.md for SLICC harness
cat > "$SLICC/PRESTAGE.md" <<'EOF'
# wasix-python 3.14.2-7 pre-stage

Stage only — not published until SLICC accepts.

## Change vs 3.14.2-6
`create_stdio()` in `Python/pylifecycle.c`: line-buffer **stdout** whenever it is
**not a regular file** (`fstat` + `!S_ISREG`). Terminals already line-buffer;
pipes / unknown `st_mode==0` (WASI) become line-buffered; `> file` stays
block-buffered. `PYTHONUNBUFFERED`/`-u` still win; stderr unchanged.

Patch: `packages/wasix-python/patches/cpython-stdout-line-buffer-nonreg.patch`

## Acceptance (SLICC)
- `python3 -c 'import sys; print(sys.stdout.line_buffering)' | cat` → True
- `python3 -c 'import sys; print(sys.stdout.line_buffering)' > f` → False
- print-then-trap keeps printed lines
- re-measure 50k `print(i)` pipe/file timings
- nptest, pdtest, mpltest, scitest unchanged

## PRESTAGE static
`prestage-check.sh` ALL CLEAR (SOABI wasix, uid wrap 1000, lock wraps).
EOF

echo "DONE wasix-python 3.14.2-7 staged PRE=$PRE FINAL=$FINAL (not published)"
