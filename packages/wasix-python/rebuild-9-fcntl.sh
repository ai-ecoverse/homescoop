#!/usr/bin/env bash
# Relink wasix-python against wasix-sysroot 2025.9.30-14 (fixed fcntl F_SETFD).
# Stage + bump to 3.14.2-9. Based on rebuild-7.sh (ehpic tree).
set -euo pipefail

export PATH="/tmp/wasix-python-build/wasixcc-prefix/bin:/opt/homebrew/bin:$HOME/.wasixcc/binaryen/bin:/opt/homebrew/Cellar/wabt/1.0.41/bin:$HOME/.wasixcc/llvm/bin:/usr/bin:/bin:$PATH"
export WASIXCC_RUN_WASM_OPT=no WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes
export WASIXCC_MODULE_KIND=dynamic-main WASIXCC_INCLUDE_CPP_SYMBOLS=yes
export AR=wasixar RANLIB=wasixranlib
unset FREETYPE FREETYPE_ROOT JPEG JPEG_ROOT PNG_ROOT ZLIB_ROOT VIRTUAL_ENV PYTHONPATH
unset PKG_CONFIG_LIBDIR ZLIB CFLAGS CPPFLAGS LDFLAGS CXX

BUILD=/tmp/wasix-python-build/Python-3.14.2/cross-build/wasm32-wasix-ehpic
PKG=/Users/trieloff/Developer/ai-ecoverse/homescoop/packages/wasix-python
STAGE=/tmp/wasix-python-stage-fcntl14
WASM_OPT="$HOME/.wasixcc/binaryen/bin/wasm-opt"
OPENSSL=/tmp/wasix-openssl-prefix
ZLIB=/tmp/wasix-zlib-prefix
COMP=/tmp/wasix-comp-prefix
STUB_CPP=/tmp/wasix-python-build/cpp-stubs/cpp_tls_stubs.o
STUB_DL=/tmp/wasix-python-build/ssl-stubs/dladdr_stub.o
STUB_DIR=/tmp/wasix-python-build/uid-stubs
WANT_EXT=".cpython-314-wasm32-wasix.so"
EXTRA_H="$PKG/fcntl_wasix_extra.h"
VER=3.14.2-9

test -d "$BUILD"
test -f "$COMP/lib/libbz2.a"
test -f "$STUB_CPP"
test -f "$STUB_DL"
test -f "$EXTRA_H"

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

echo "== relink python.wasm (pulls fixed fcntl from sysroot-ehpic) =="
rm -f python.wasm
make AR=wasixar RANLIB=wasixranlib python.wasm 2>&1 | tee /tmp/wasix-python-build/make-link-9.log | tail -40
test -f python.wasm
PRE=$(stat -f%z python.wasm)
echo "pre-asyncify: $PRE"

STRINGS_BIN=/usr/bin/strings
if ! "$STRINGS_BIN" -a python.wasm | grep -Fq "$WANT_EXT"; then
  echo "FAIL pre-async: missing $WANT_EXT" >&2
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
  python.wasm -o /tmp/py-async-9.wasm 2>&1 | tee /tmp/wasix-python-build/asyncify-9.log | tail -8
mkdir -p "$STAGE/bin" "$STAGE/lib"
"$WASM_OPT" -O3 --strip-debug --strip-producers "${FEATS[@]}" \
  /tmp/py-async-9.wasm -o "$STAGE/bin/python.wasm"
FINAL=$(stat -f%z "$STAGE/bin/python.wasm")
echo "final: $FINAL"

# Reuse packaged stdlib
rsync -a --delete "$PKG/package/lib/" "$STAGE/lib/"

echo "== PRESTAGE static =="
bash "$PKG/prestage-check.sh" "$STAGE/bin/python.wasm" "$STAGE/lib/python3.14"

cp "$STAGE/bin/python.wasm" "$PKG/package/bin/python.wasm"
chmod 755 "$PKG/package/bin/python.wasm"

python3 - <<PY
import json
from pathlib import Path
pj = Path("$PKG/package/package.json")
d = json.loads(pj.read_text())
d["version"] = "$VER"
d["description"] = "CPython 3.14 for slicc WASIX (fcntl F_SETFD CLOEXEC fix via wasix-sysroot 2025.9.30-14)"
pj.write_text(json.dumps(d, indent=2) + "\n")
print("version", d["version"])
PY

cat > "$PKG/package/PRESTAGE.md" <<'EOF'
# wasix-python 3.14.2-9

Relinked against wasix-sysroot **2025.9.30-14** (fixed `fcntl` F_SETFD:
`(flags & FD_CLOEXEC)`). `__wrap_fcntl` still forwards F_SETFD/F_GETFD to
`__real_fcntl` in libc.

## PRESTAGE (SLICC)

```python
import fcntl, subprocess, os
assert fcntl.fcntl(1, fcntl.F_SETFD, 0) == 0
assert fcntl.fcntl(1, fcntl.F_GETFD) == 0
r = subprocess.run(["echo", "x"], capture_output=True, text=True)
assert r.stdout.strip() == "x"
# os.execvp replaces the process — run as last check:
# os.execvp("echo", ["echo", "exec-ok"])
```
EOF
cp "$PKG/package/PRESTAGE.md" "$PKG/PRESTAGE.md"

bash "$PKG/prestage-check.sh" "$PKG/package/bin/python.wasm" "$PKG/package/lib/python3.14"
echo "DONE wasix-python $VER PRE=$PRE FINAL=$FINAL"
