#!/usr/bin/env bash
# Static PRESTAGE checks for wasix-python. Blocking — exit 1 on any failure.
# Usage: prestage-check.sh <python.wasm> <lib/python3.14>
set -euo pipefail

WASM=${1:?python.wasm}
PYLIB=${2:?lib/python3.14}
OBJDUMP="${WASM_OBJDUMP:-$(command -v wasm-objdump || true)}"
OBJDUMP="${OBJDUMP:-/opt/homebrew/Cellar/wabt/1.0.41/bin/wasm-objdump}"

WANT_SOABI='cpython-314-wasm32-wasix'
WANT_EXT=".cpython-314-wasm32-wasix.so"
WANT_MULTIARCH='wasm32-wasix'
BAD_THREADS='wasm32-wasi-threads'

fail() { echo "PRESTAGE FAIL: $*" >&2; exit 1; }
ok() { echo "PRESTAGE OK: $*"; }

test -f "$WASM" || fail "missing $WASM"
test -d "$PYLIB" || fail "missing $PYLIB"
[[ -x "$OBJDUMP" ]] || fail "wasm-objdump not found at $OBJDUMP"

# Binary substring counts (more reliable than strings|grep on large wasm)
eval "$(python3 - "$WASM" "$WANT_SOABI" "$WANT_EXT" "$BAD_THREADS" <<'PY'
import sys
from pathlib import Path
b = Path(sys.argv[1]).read_bytes()
soabi, ext, bad = (sys.argv[2].encode(), sys.argv[3].encode(), sys.argv[4].encode())
print(f"WASIX_N={b.count(soabi)}")
print(f"EXT_N={b.count(ext)}")
print(f"THREADS_N={b.count(bad)}")
print(f"THREADS_SO_N={b.count(b'.cpython-314-wasm32-wasi-threads.so')}")
PY
)"
[[ "$WASIX_N" -gt 0 ]] || fail "wasm: '$WANT_SOABI' count=$WASIX_N (need >0)"
[[ "$THREADS_N" -eq 0 ]] || fail "wasm: '$BAD_THREADS' count=$THREADS_N (need 0)"
[[ "$EXT_N" -gt 0 ]] || fail "wasm missing $WANT_EXT (count=$EXT_N)"
[[ "$THREADS_SO_N" -eq 0 ]] || fail "wasm still has wasi-threads.so suffix"
ok "wasm SOABI strings wasix=$WASIX_N ext=$EXT_N threads=$THREADS_N"

SC=$(echo "$PYLIB"/_sysconfigdata__wasi_*.py)
[[ -f "$SC" ]] || fail "no _sysconfigdata__wasi_*.py under $PYLIB"
[[ "$(basename "$SC")" == "_sysconfigdata__wasi_wasm32-wasix.py" ]] \
  || fail "sysconfigdata name is $(basename "$SC"), want _sysconfigdata__wasi_wasm32-wasix.py"
! ls "$PYLIB"/_sysconfigdata__wasi_wasm32-wasi-threads.py >/dev/null 2>&1 \
  || fail "stale _sysconfigdata__wasi_wasm32-wasi-threads.py present"

python3 - "$SC" "$WANT_SOABI" "$WANT_EXT" "$WANT_MULTIARCH" <<'PY' || fail "sysconfigdata fields disagree"
import sys
from pathlib import Path
path, soabi, ext, multi = sys.argv[1:5]
ns = {}
exec(Path(path).read_text(), ns)
v = ns["build_time_vars"]
assert v.get("SOABI") == soabi, (v.get("SOABI"), soabi)
assert v.get("EXT_SUFFIX") == ext, (v.get("EXT_SUFFIX"), ext)
assert v.get("MULTIARCH") == multi, (v.get("MULTIARCH"), multi)
for key in ("SOABI", "EXT_SUFFIX", "MULTIARCH"):
    assert "wasm32-wasi-threads" not in str(v.get(key, ""))
print("sysconfig", v["SOABI"], v["EXT_SUFFIX"], v["MULTIARCH"])
PY
ok "sysconfigdata $SC"

IMPORTS=$("$OBJDUMP" -x -j Import "$WASM") || fail "wasm-objdump cannot read $WASM"
if echo "$IMPORTS" | grep -Eiq 'getuid|geteuid|getgid|getegid'; then
  fail "getuid/geteuid/getgid/getegid still appear in Import section (bypass stub)"
fi
ok "uid not imported"

python3 - "$OBJDUMP" "$WASM" <<'PY' || fail "__wrap_getuid export/body check failed"
import re, subprocess, sys
objdump, wasm = sys.argv[1:3]
exp = subprocess.check_output([objdump, "-x", "-j", "Export", wasm], text=True, stderr=subprocess.STDOUT)
if "__wrap_getuid" not in exp:
    raise SystemExit("Export section missing __wrap_getuid")
dis = subprocess.check_output([objdump, "-d", wasm], text=True, stderr=subprocess.STDOUT)
# O3 may merge getuid/geteuid/getgid/getegid into one function
m = re.search(r"func\[\d+\] <__wrap_get(?:uid|euid|gid|egid)>:.*?(?=func\[\d+\]|\Z)", dis, re.S)
if not m:
    raise SystemExit("no __wrap_getuid family in disassembly")
body = m.group(0)[:400]
if "i32.const 1000" not in body and "41 e8 07" not in body:
    raise SystemExit("wrap body does not return 1000:\n" + body)
print("wrap ok", body.splitlines()[0])
PY
ok "getuid wrapped → 1000 (exported __wrap_getuid)"

# Advisory-lock wraps (SLICC realm no-ops; Emscripten parity).
# O3 may merge __wrap_flock/lockf with other return-0 stubs; resolve via Export.
python3 - "$OBJDUMP" "$WASM" <<'PY' || fail "lock wrap export check failed"
import re, subprocess, sys
objdump, wasm = sys.argv[1:3]
exp = subprocess.check_output([objdump, "-x", "-j", "Export", wasm], text=True, stderr=subprocess.STDOUT)
idxs = {}
for name in ("__wrap_flock", "__wrap_fcntl", "__wrap_lockf"):
    # e.g. ` - func[471] <_rl_null_function> -> "__wrap_flock"`
    m = re.search(rf'func\[(\d+)\][^\n]*->\s*"{re.escape(name)}"', exp)
    if not m:
        raise SystemExit(f"Export section missing {name}")
    idxs[name] = int(m.group(1))
dis = subprocess.check_output([objdump, "-d", wasm], text=True, stderr=subprocess.STDOUT)
fi = idxs["__wrap_flock"]
m = re.search(rf"func\[{fi}\][^:]*:.*?(?=func\[\d+\]|\Z)", dis, re.S)
if not m:
    raise SystemExit(f"no func[{fi}] (export __wrap_flock) in disassembly")
body = m.group(0)[:400]
if "i32.const 0" not in body and "41 00" not in body:
    raise SystemExit(f"__wrap_flock func[{fi}] does not return 0:\n" + body)
if idxs["__wrap_fcntl"] == idxs["__wrap_flock"]:
    raise SystemExit("__wrap_fcntl merged with flock — too aggressive")
print("lock wraps ok", idxs, body.splitlines()[0])
PY
ok "advisory locks wrapped (flock/fcntl/lockf no-ops)"

python3 - "$WASM" <<'PY' || fail "missing builtin init symbol string"
import sys
from pathlib import Path
b = Path(sys.argv[1]).read_bytes()
need = [
    b"PyInit__bz2", b"PyInit__lzma", b"PyInit__sqlite3", b"PyInit_readline",
    b"PyInit_pwd", b"PyInit_fcntl", b"PyInit_grp", b"PyInit_termios", b"PyInit_resource",
]
missing = [s.decode() for s in need if s not in b]
if missing:
    raise SystemExit("missing: " + ", ".join(missing))
print("ok", len(need))
PY
ok "builtin init symbols present"

echo "PRESTAGE ALL CLEAR: $WASM"
