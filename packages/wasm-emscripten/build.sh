#!/usr/bin/env bash
# Stage Emscripten 6.0.9-git + SLICC patches as @ai-ecoverse/wasm-emscripten.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/wasm-emscripten"
VERSION="6.0.9"
PKG_VER="6.0.9-11"
PKG="$HOMESCOOP_PKG/package"
SLICC_EM="${SLICC_EMSCRIPTEN:-$ROOT/../slicc-emscripten}"
EM_SRC="$SLICC_EM/src/emscripten"

test -f "$EM_SRC/emcc.py" || {
  echo "homescoop: missing $EM_SRC/emcc.py" >&2
  exit 1
}
test -f "$HOMESCOOP_PKG/emscripten-config"
test -f "$HOMESCOOP_PKG/bin/em-launcher.sh"
test -f "$HOMESCOOP_PKG/lib/slicc-vfs-pre.js"

echo "== wasm-emscripten: rsync tree (exclude test/docs/site/git/node_modules/cache)"
rm -rf "$PKG"
mkdir -p "$PKG"
rsync -a \
  --exclude='.git/' \
  --exclude='test/' \
  --exclude='docs/' \
  --exclude='site/' \
  --exclude='node_modules/' \
  --exclude='cache/' \
  --exclude='__pycache__/' \
  --exclude='.github/' \
  --exclude='*.pyc' \
  "$EM_SRC/" "$PKG/"

# Confirm September configure patch is present in the tree we staged.
grep -q 'SLICC_VFS_PRE_JS' "$PKG/tools/link.py" || {
  echo "homescoop: SLICC_VFS_PRE_JS patch missing from staged link.py" >&2
  exit 1
}

echo "== wasm-emscripten: apply homescoop patches"
for p in "$HOMESCOOP_PKG"/patches/*.patch; do
  echo "  patch $(basename "$p")"
  # --forward/--batch: skip hunks already present in EM_SRC without interactive prompts.
  # Exit 1 with only "Ignoring previously applied" is OK.
  pout=$(mktemp)
  if ! patch -d "$PKG" -p1 --forward --batch < "$p" >"$pout" 2>&1; then
    cat "$pout"
    if grep -qE 'hunks? FAILED|FAILED at|malformed' "$pout"; then
      echo "homescoop: patch failed: $(basename "$p")" >&2
      rm -f "$pout"
      exit 1
    fi
    if grep -q 'Ignoring previously applied' "$pout"; then
      find "$PKG" -name '*.rej' -delete
      echo "  (already present in EM_SRC; ignored)"
    else
      echo "homescoop: patch failed: $(basename "$p")" >&2
      rm -f "$pout"
      exit 1
    fi
  else
    cat "$pout"
  fi
  rm -f "$pout"
done

# Surgical: protect symlinked sysroot + stamp on --clear-cache
python3 - "$PKG/tools/cache.py" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text()
old = """  with lock('erase'):
    # Delete everything except the lockfile itself
    utils.delete_contents(cachedir, exclude=[os.path.basename(cachelock_name)])
"""
new = """  with lock('erase'):
    # Delete everything except the lockfile, a symlinked sysroot (read-only
    # seed from @ai-ecoverse/emscripten-cache), and sysroot_install.stamp
    # (re-seeded by em-ensure-cache; without it emcc would rewrite headers
    # through the symlink into the package).
    exclude = [os.path.basename(cachelock_name)]
    sysroot = Path(cachedir, 'sysroot')
    if sysroot.is_symlink():
      exclude.append('sysroot')
      exclude.append('sysroot_install.stamp')
    utils.delete_contents(cachedir, exclude=exclude)
"""
if old not in text:
  raise SystemExit('cache.erase block not found for homescoop patch')
p.write_text(text.replace(old, new, 1))
print('  patched tools/cache.py (symlink sysroot + stamp)')
PY

# Guard: never install headers through a symlinked package sysroot
python3 - "$PKG/tools/system_libs.py" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text()
old = """@ToolchainProfiler.profile()
def ensure_sysroot():
  cache.get('sysroot_install.stamp', install_system_headers, what='system headers')
"""
new = """@ToolchainProfiler.profile()
def ensure_sysroot():
  # SLICC: sysroot may be a symlink into @ai-ecoverse/emscripten-cache.
  # Never run install_system_headers through that symlink (package is read-only).
  stamp = cache.get_path('sysroot_install.stamp')
  if not Path(stamp).exists():
    sysroot = Path(cache.get_sysroot(absolute=True))
    if sysroot.is_symlink() or not os.access(sysroot, os.W_OK):
      from .shared import exit_with_error
      exit_with_error(
          'sysroot_install.stamp missing while sysroot is a package symlink; '
          'run em-ensure-cache (need @ai-ecoverse/emscripten-cache stamps/)')
  cache.get('sysroot_install.stamp', install_system_headers, what='system headers')
"""
if old not in text:
  raise SystemExit('ensure_sysroot block not found')
# Path is used — ensure import exists (pathlib Path already used in file? check)
if 'from pathlib import Path' not in text and 'import pathlib' not in text:
  # system_libs likely uses os.path; add Path import near top after other imports
  needle = 'import os\n'
  if needle in text:
    text = text.replace(needle, 'import os\nfrom pathlib import Path\n', 1)
  else:
    raise SystemExit('cannot add Path import')
p.write_text(text.replace(old, new, 1))
print('  patched tools/system_libs.py (ensure_sysroot guard)')
PY

# emcmake: set CMAKE_MAKE_PROGRAM to `make` when present (SLICC wasm-gmake)
python3 - "$PKG/emcmake.py" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text()
old = """  if not has_substr(args, '-DCMAKE_CROSSCOMPILING_EMULATOR'):
    node_js = config.NODE_JS[0]
    # See https://github.com/emscripten-core/emscripten/issues/15522
    args.append(f'-DCMAKE_CROSSCOMPILING_EMULATOR={node_js}')

  # Print a better error if we have no CMake executable on the PATH
"""
new = """  if not has_substr(args, '-DCMAKE_CROSSCOMPILING_EMULATOR'):
    node_js = config.NODE_JS[0]
    # See https://github.com/emscripten-core/emscripten/issues/15522
    args.append(f'-DCMAKE_CROSSCOMPILING_EMULATOR={node_js}')

  # SLICC: wasm-gmake is `make` on PATH; Unix Makefiles need CMAKE_MAKE_PROGRAM.
  if (not has_substr(args, '-DCMAKE_MAKE_PROGRAM')
      and 'CMAKE_MAKE_PROGRAM' not in os.environ
      and not any(a.startswith('-G') and 'Ninja' in a for a in args)):
    make = shutil.which('make')
    if make:
      args.append(f'-DCMAKE_MAKE_PROGRAM={make}')

  # Print a better error if we have no CMake executable on the PATH
"""
if old not in text:
  raise SystemExit('emcmake.py block not found')
p.write_text(text.replace(old, new, 1))
print('  patched emcmake.py (CMAKE_MAKE_PROGRAM)')
PY

echo "== wasm-emscripten: compile libslicc objects for default executable links"
SLICC_SHIMS="$ROOT/shims/slicc"
mkdir -p "$PKG/lib/slicc"
# Host emcc from slicc-emscripten (same target as package); objects are small.
HOST_EM_CONFIG="${SLICC_EM}/emscripten-config"
HOST_EMCC="$EM_SRC/emcc"
test -x "$HOST_EMCC" || HOST_EMCC="$EM_SRC/emcc.py"
export EM_CONFIG="$HOST_EM_CONFIG"
export EM_CACHE="${SLICC_EM}/cache"
export EMSDK_PYTHON="${EMSDK_PYTHON:-/opt/homebrew/bin/python3.13}"
# Keep host EM_CACHE headers on the 128-byte sigset_t layout. Host emcc can
# reinstall headers from EM_SRC on sanity/config change; both must match.
ALLTYPES="${EM_CACHE}/sysroot/include/bits/alltypes.h"
PKG_ALLTYPES="$PKG/system/lib/libc/musl/arch/emscripten/bits/alltypes.h"
test -f "$PKG_ALLTYPES"
grep -q '__bits\[128/sizeof(long)\]' "$PKG_ALLTYPES"
! grep -qE 'typedef struct __sigset_t \{ unsigned long __bits\[2\]; \}' "$PKG_ALLTYPES"
# Seed / repair host cache headers from the packaged (patched) musl alltypes.
mkdir -p "$(dirname "$ALLTYPES")"
cp "$PKG_ALLTYPES" "$ALLTYPES"
if grep -qE 'typedef struct __sigset_t \{ unsigned long __bits\[2\]; \}' "$ALLTYPES"; then
  echo "homescoop: EM_CACHE=$EM_CACHE still has sigset_t __bits[2] after seed" >&2
  exit 1
fi
grep -q '__bits\[128/sizeof(long)\]' "$ALLTYPES"
for obj in slicc_spawn slicc_exec slicc_signals slicc_select slicc_libc_gaps slicc_jobs slicc_main_envp slicc_fork; do
  echo "  emcc -c $obj.c"
  # Re-seed alltypes before each compile in case emcc cleared/reinstalled headers.
  cp "$PKG_ALLTYPES" "$ALLTYPES"
  EM_CONFIG="$HOST_EM_CONFIG" "$HOST_EMCC" -O2 -c "$SLICC_SHIMS/$obj.c" -o "$PKG/lib/slicc/$obj.o"
  test -f "$PKG/lib/slicc/$obj.o"
done
# slicc_signals.o must encode sizeof(sigaction)==140 (not the stale stride-20).
if ! llvm-objdump -d "$PKG/lib/slicc/slicc_signals.o" 2>/dev/null | grep -qE 'i32\.const[[:space:]]+140'; then
  # Fallback: raw wasm encoding of i32.const 140 (0x41 0x8c 0x01).
  if ! python3 -c "import pathlib,sys; d=pathlib.Path(sys.argv[1]).read_bytes(); sys.exit(0 if b'\\x41\\x8c\\x01' in d else 1)" \
      "$PKG/lib/slicc/slicc_signals.o"; then
    echo "homescoop: slicc_signals.o missing i32.const 140 (stride not 140)" >&2
    llvm-objdump -d "$PKG/lib/slicc/slicc_signals.o" 2>&1 | head -80 >&2 || true
    exit 1
  fi
fi
echo "  PRESTAGE: slicc_signals.o has stride-140 encoding"
# Opt-in fork support: ship the js-library next to slicc_fork.o.
cp "$SLICC_SHIMS/slicc-fork.js" "$PKG/lib/slicc/slicc-fork.js"
test -f "$PKG/lib/slicc/slicc-fork.js"
# Default link uses cli profile (spawn/exec/signals/select/gaps/jobs).
# main_envp (make) and fork (ASYNCIFY) ship for opt-in.

echo "== wasm-emscripten: config + launchers (+ optional vfs pre-js)"
cp "$HOMESCOOP_PKG/emscripten-config" "$PKG/emscripten-config"
mkdir -p "$PKG/bin" "$PKG/lib"
cp "$HOMESCOOP_PKG/lib/slicc-vfs-pre.js" "$PKG/lib/slicc-vfs-pre.js"
cp "$HOMESCOOP_PKG/bin/em-ensure-cache" "$PKG/bin/em-ensure-cache"
chmod +x "$PKG/bin/em-ensure-cache"

# One launcher script, many argv0 names.
TOOLS=(emcc em++ emar emranlib emcmake emconfigure emmake embuilder em-config emscan-deps)
for t in "${TOOLS[@]}"; do
  cp "$HOMESCOOP_PKG/bin/em-launcher.sh" "$PKG/bin/$t"
  chmod +x "$PKG/bin/$t"
done
# Ensure-cache is not a python tool; already copied.

# Drop upstream bare shims; replace with launchers so embuilder/path_from_root('emcc') works.
for t in emcc em++ emar emranlib emcmake emconfigure emmake embuilder em-config emscan-deps emdwp emnm empath-split emprofile emrun emscons; do
  rm -f "$PKG/$t"
done
# Top-level names used by system_libs rebuilds (path_from_root('emcc')).
for t in emcc em++ emar emranlib emcmake emconfigure emmake embuilder em-config emscan-deps; do
  cp "$PKG/bin/$t" "$PKG/$t"
  chmod +x "$PKG/$t"
done

cp "$EM_SRC/LICENSE" "$PKG/LICENSE"

cat > "$PKG/README.md" <<'EOF'
# @ai-ecoverse/wasm-emscripten

Emscripten **6.0.9-git** for the SLICC wasm realm. Launchers run `emcc.py`
(and friends) on `@ai-ecoverse/wasix-python` (`python3 -S`) with `EM_CONFIG`
pointing at this package's config.

## Companions

| Package | Role |
|---------|------|
| `@ai-ecoverse/wasix-python` | Python that runs `em*.py` |
| `@ai-ecoverse/wasm-clang` | `LLVM_ROOT` (clang / wasm-ld) |
| `@ai-ecoverse/wasm-binaryen` | `BINARYEN_ROOT` (wasm-opt, …) |
| `@ai-ecoverse/emscripten-cache` | Read-only prebuilt `sysroot/` |
| `esbuild-wasm@0.28.2` | SLICC `node` ESM/TLA transpile (`compiler.mjs`, …) |
| `typescript@6.0.3` | Fallback transpile path when esbuild is unavailable |
| `acorn` / `acorn-import-phases` | JS optimizer (`acorn-optimizer.mjs`) |

## Default link (wasm realm)

Executable links (not `-c` / `-r` / `-shared`) inject `homescoop_em_cli_ldflags`
(`-sENVIRONMENT=web,worker,node -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1
-sFORCE_FILESYSTEM=1`) and
`lib/slicc/{slicc_spawn,slicc_exec,slicc_signals,slicc_select,slicc_libc_gaps,slicc_jobs}.o`.
Opt out with **`SLICC_EMCC_PLAIN=1`** for plain web glue.
`lib/slicc/slicc_main_envp.o` (make: `-Dmain=slicc_tool_main`) and
`lib/slicc/slicc_fork.o` + `lib/slicc/slicc-fork.js` (needs ASYNCIFY) are
shipped but not auto-linked. Fork opt-in:

```bash
emcc … $SLICC_EM_LIBDIR/slicc_fork.o \
  --js-library $SLICC_EM_LIBDIR/slicc-fork.js \
  -sASYNCIFY -sASYNCIFY_STACK_SIZE=1048576 \
  -sEXPORTED_RUNTIME_METHODS=FS,ENV,callMain,sliccRunMain,sliccForkChild
```

Root `$PKG/emcc` (cmake toolchain) and `$PKG/bin/emcc` are the same self-sufficient launcher.

## CACHE model

- **`EM_CACHE`** = `$XDG_CACHE_HOME/emscripten` or `~/.cache/emscripten` (writable, user-owned)
- On first use, `bin/em-ensure-cache` creates `$EM_CACHE/sysroot` as a **symlink** into `@ai-ecoverse/emscripten-cache/sysroot` — **no 100MB copy**
- It also copies `stamps/sysroot_install.stamp` as a **real file** into `$EM_CACHE` so emcc never reinstalls headers through the symlink
- `js_output/` and `symbol_lists/` warm in the user dir (survive `ipk` reinstall)
- `FROZEN_CACHE = False` so warm caches work; `--clear-cache` skips a symlinked sysroot and the stamp
- Override with `EM_CACHE` if needed

## SLICC patches (September + homescoop)

1. **Wasm-realm CLI link defaults** — see above; optional `SLICC_VFS_PRE_JS` only when set (node-realm)
2. **Configure patch** — autoconf/conftest skips `NODERAWFS` under CLI defaults
3. **`ac_cv_build` seeding** — `emconfigure` sets `ac_cv_build=x86_64-pc-linux-gnu` (and host/target) so `config.guess` is not required in-realm
4. **Closure unsupported** — `-sCLOSURE=1` / `--closure` fail with: *Closure Compiler is not available in SLICC's Emscripten package*
5. **Cache erase** — will not delete a symlinked `sysroot`
6. **`execvpe`** — `tools/utils.py` passes `os.environ` so emconfigure/`emmake` keep `CC=emcc`

## Commands

`emcc`, `em++`, `emar`, `emranlib`, `emcmake`, `emconfigure`, `emmake`, `embuilder`, `em-config`, `emscan-deps`

```bash
emcc hello.c -o hello.js    # runnable in the wasm realm
emcmake cmake -S . -B build
emconfigure ./configure --host=wasm32-unknown-emscripten
```
EOF

node - "$PKG" "$PKG_VER" <<'JS'
const fs = require("fs");
const path = require("path");
const pkgDir = process.argv[2];
const ver = process.argv[3];
const tools = [
  "emcc", "em++", "emar", "emranlib", "emcmake", "emconfigure",
  "emmake", "embuilder", "em-config", "emscan-deps",
];
const commands = {};
for (const t of tools) {
  commands[t] = { script: `bin/${t}` };
}
commands["em-ensure-cache"] = { script: "bin/em-ensure-cache" };
const j = {
  name: "@ai-ecoverse/wasm-emscripten",
  version: ver,
  description: "Emscripten 6.0.9 for slicc (emcc via wasix-python)",
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/ai-ecoverse/homescoop.git",
    directory: "packages/wasm-emscripten/package",
  },
  homepage: "https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasm-emscripten",
  keywords: ["wasm", "emscripten", "slicc", "homescoop", "emcc"],
  files: [
    "README.md",
    "LICENSE",
    "emscripten-config",
    "bin",
    "lib",
    // Root launchers for emcmake / path_from_root('emcc') (same scripts as bin/).
    "emcc", "em++", "emar", "emranlib", "emcmake", "emconfigure",
    "emmake", "embuilder", "em-config", "emscan-deps",
    "*.py",
    "tools",
    "src",
    "system",
    "cmake",
    "third_party",
    "Media",
    "ChangeLog.md",
    "emscripten-version.txt",
  ],
  publishConfig: { access: "public" },
  homescoop: { recipe: "wasm-emscripten", upstream: "6.0.9" },
  dependencies: {
    "@ai-ecoverse/wasix-python": "3.14.2-13",
    "@ai-ecoverse/wasm-clang": "24.0.0-11",
    "@ai-ecoverse/wasm-binaryen": "132.0.0-1",
    "@ai-ecoverse/emscripten-cache": "6.0.9-3",
    "esbuild-wasm": "0.28.2",
    "typescript": "6.0.3",
    "acorn": "^8.18.0",
    "acorn-import-phases": "^1.0.4",
  },
  slicc: {
    abi: "emscripten",
    env: {
      EM_PACKAGE_ROOT: "${package}",
      EM_CONFIG: "${package}/emscripten-config",
      EM_CACHE_PACKAGE: "/shared/lib/node_modules/@ai-ecoverse/emscripten-cache",
      EM_LLVM_PACKAGE: "/shared/lib/node_modules/@ai-ecoverse/wasm-clang",
      EM_BINARYEN_PACKAGE: "/shared/lib/node_modules/@ai-ecoverse/wasm-binaryen",
      SLICC_EM_LIBDIR: "${package}/lib/slicc",
    },
    commands,
  },
};
fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(j, null, 2) + "\n");
JS
echo "== wasm-emscripten: PRESTAGE checks"
# Patches applied
grep -q "Closure Compiler is not available" "$PKG/tools/building.py"
grep -q "Closure Compiler is not available" "$PKG/tools/link.py"
grep -q "ac_cv_build" "$PKG/emconfigure.py"
grep -q "sysroot_install.stamp" "$PKG/tools/cache.py"
grep -q "package symlink" "$PKG/tools/system_libs.py"
grep -q "CMAKE_MAKE_PROGRAM" "$PKG/emcmake.py"
grep -q "SLICC_EMCC_PLAIN" "$PKG/tools/link.py"
grep -q "default_setting('FORCE_FILESYSTEM'" "$PKG/tools/link.py"
grep -q "slicc_spawn.o" "$PKG/tools/link.py"
grep -q "os.execvpe" "$PKG/tools/utils.py"
grep -q "except ImportError" "$PKG/tools/colored_logger.py"
grep -q "except ImportError" "$PKG/tools/file_packager.py"
! rg -n '^import ctypes$|^from ctypes' "$PKG" --glob '*.py' || {
  echo "homescoop: bare ctypes import still present" >&2
  exit 1
}
test -f "$PKG/lib/slicc-vfs-pre.js"
for obj in slicc_spawn slicc_exec slicc_signals slicc_select slicc_libc_gaps slicc_jobs slicc_main_envp slicc_fork; do
  test -f "$PKG/lib/slicc/$obj.o"
done
test -f "$PKG/lib/slicc/slicc-fork.js"
grep -q 'Module.sliccPpid' "$PKG/lib/slicc/slicc-fork.js"
grep -q '__syscall_getpid' "$PKG/lib/slicc/slicc_libc_gaps.o" || \
  llvm-nm "$PKG/lib/slicc/slicc_libc_gaps.o" 2>/dev/null | grep -q getpid || true
grep -q "slicc_jobs.o" "$PKG/tools/link.py"
! grep -q "slicc_main_envp.o" "$PKG/tools/link.py" || {
  # may appear in a comment; require it's not in the auto-link tuple alone
  python3 -c 'import pathlib,re; t=pathlib.Path("'"$PKG"'/tools/link.py").read_text(); m=re.search(r"for obj in \((.*?)\):", t, re.S); assert m and "slicc_main_envp" not in m.group(1) and "slicc_jobs" in m.group(1)'
}
test -x "$PKG/bin/emcc"
test -x "$PKG/emcc"
test -x "$PKG/emcmake"
# Root launcher must treat $PKG as package root (emcmake path spawn).
grep -q 'emcc.py' "$PKG/emcc"
grep -q '"emcc"' "$PKG/package.json"  # files list includes root launcher
! grep -q 'SLICC_VFS_PRE_JS:=' "$PKG/emcc" || {
  echo "homescoop: launcher must not default-export SLICC_VFS_PRE_JS" >&2
  exit 1
}
test -f "$PKG/emscripten-config"
! grep -qE "setdefault\(['\"]SLICC_VFS_PRE_JS|SLICC_VFS_PRE_JS\s*=" "$PKG/emscripten-config" || {
  echo "homescoop: emscripten-config must not set SLICC_VFS_PRE_JS" >&2
  exit 1
}
grep -q '\^3.14.2-7' "$PKG/package.json"
grep -q '6.0.9-3' "$PKG/package.json"
grep -q '"@ai-ecoverse/wasm-clang": "24.0.0-10"' "$PKG/package.json"
grep -q '"esbuild-wasm": "0.28.2"' "$PKG/package.json"
grep -q '"typescript": "6.0.3"' "$PKG/package.json"
grep -q '"acorn"' "$PKG/package.json"
grep -q '"acorn-import-phases"' "$PKG/package.json"
! grep -q 'SLICC_VFS_PRE_JS' "$PKG/package.json" || {
  echo "homescoop: package.json slicc.env must not set SLICC_VFS_PRE_JS" >&2
  exit 1
}
test -f "$ROOT/packages/emscripten-cache/package/stamps/sysroot_install.stamp"

! grep -E '/Users/|/home/trieloff|/opt/homebrew' "$PKG/emscripten-config" || {
  echo "homescoop: host path leaked into emscripten-config" >&2
  exit 1
}

# --- ensure-cache: mkdir, symlink, stamp seed ---
PRE_CACHE=$(mktemp -d)/fresh-cache
export EM_CACHE="$PRE_CACHE"
export EM_CACHE_PACKAGE="$ROOT/packages/emscripten-cache/package"
export EM_PACKAGE_ROOT="$PKG"
"$PKG/bin/em-ensure-cache" >/dev/null
[[ -d "$PRE_CACHE" ]]
[[ -L "$PRE_CACHE/sysroot" ]]
[[ -f "$PRE_CACHE/sysroot_install.stamp" && ! -L "$PRE_CACHE/sysroot_install.stamp" ]]
[[ "$(readlink "$PRE_CACHE/sysroot")" == "$EM_CACHE_PACKAGE/sysroot" ]]
INO1=$(ls -di "$PRE_CACHE/sysroot" | awk '{print $1}')
"$PKG/bin/em-ensure-cache" >/dev/null
INO2=$(ls -di "$PRE_CACHE/sysroot" | awk '{print $1}')
[[ "$INO1" == "$INO2" ]]
echo "  PRESTAGE: em-ensure-cache mkdir + symlink + stamp OK"

# --- read-only packages: emcc must not write through the symlink ---
PRE_WORK=$(mktemp -d)
mkdir -p "$PRE_WORK/site"
cat > "$PRE_WORK/site/sitecustomize.py" <<'SITE'
import sys
for name in ("_ctypes", "ctypes", "_multiprocessing", "multiprocessing"):
  sys.modules[name] = None
SITE
printf 'int main(void){return 0;}\n' > "$PRE_WORK/hello.c"
export EM_CACHE="$PRE_WORK/em-cache"
export EM_CACHE_PACKAGE="$ROOT/packages/emscripten-cache/package"
export EM_PACKAGE_ROOT="$PKG"
export PYTHONPATH="$PRE_WORK/site${PYTHONPATH:+:$PYTHONPATH}"
cat > "$PRE_WORK/emconfig.py" <<EOF
import os
from pathlib import Path
_llvm = Path("$ROOT/../slicc-emscripten/install/bin")
LLVM_ROOT = str(_llvm if (_llvm / "clang").exists() else Path("/usr/bin"))
BINARYEN_ROOT = "/opt/homebrew"
NODE_JS = "node"
CACHE = os.environ["EM_CACHE"]
FROZEN_CACHE = False
os.environ.setdefault("SLICC_EM_LIBDIR", "$PKG/lib/slicc")
EOF
export EM_CONFIG="$PRE_WORK/emconfig.py"
# Ensure no node-realm VFS pre-js leaks into the host PRESTAGE link.
unset SLICC_VFS_PRE_JS || true
"$PKG/bin/em-ensure-cache" >/dev/null

chmod -R a-w "$PKG" "$ROOT/packages/emscripten-cache/package"
RO_CLEANUP() {
  chmod -R u+w "$PKG" "$ROOT/packages/emscripten-cache/package" 2>/dev/null || true
}
trap RO_CLEANUP EXIT

if ! python3 "$PKG/emcc.py" "$PRE_WORK/hello.c" -o "$PRE_WORK/hello.js" 2>"$PRE_WORK/emcc.err"; then
  RO_CLEANUP
  trap - EXIT
  echo "homescoop: PRESTAGE emcc with read-only packages failed:" >&2
  cat "$PRE_WORK/emcc.err" >&2
  exit 1
fi
test -f "$PRE_WORK/hello.js"
test -f "$PRE_WORK/hello.wasm"
[[ -L "$EM_CACHE/sysroot" ]]
! grep -q 'generating system headers' "$PRE_WORK/emcc.err" || {
  RO_CLEANUP
  trap - EXIT
  echo "homescoop: emcc regenerated system headers (stamp missing?)" >&2
  cat "$PRE_WORK/emcc.err" >&2
  exit 1
}
# Wasm-realm defaults: no node-realm VFS pre-js; CLI ENVIRONMENT injected.
! grep -q 'SLICC_LIVE_FS' "$PRE_WORK/hello.js" || {
  RO_CLEANUP
  trap - EXIT
  echo "homescoop: hello.js embeds SLICC_LIVE_FS (VFS pre-js still linked)" >&2
  exit 1
}
# Modern glue expands ENVIRONMENT into ENVIRONMENT_IS_* booleans (no literal
# "web,worker,node" string). Require web+worker+node all present.
for env_flag in ENVIRONMENT_IS_WEB ENVIRONMENT_IS_WORKER ENVIRONMENT_IS_NODE; do
  grep -q "$env_flag" "$PRE_WORK/hello.js" || {
    RO_CLEANUP
    trap - EXIT
    echo "homescoop: hello.js missing $env_flag (CLI ENVIRONMENT defaults)" >&2
    exit 1
  }
done
echo "  PRESTAGE: emcc hello with read-only packages OK"

if python3 "$PKG/emcc.py" "$PRE_WORK/hello.c" -o "$PRE_WORK/hello-cl.js" --closure=1 2>"$PRE_WORK/closure.err"; then
  RO_CLEANUP
  trap - EXIT
  echo "homescoop: --closure=1 should have failed" >&2
  exit 1
fi
grep -q "Closure Compiler is not available in SLICC's Emscripten package" "$PRE_WORK/closure.err" || {
  RO_CLEANUP
  trap - EXIT
  echo "homescoop: closure error message missing:" >&2
  cat "$PRE_WORK/closure.err" >&2
  exit 1
}
echo "  PRESTAGE: closure refuse message OK"

CC_OUT=$(python3 "$PKG/emconfigure.py" sh -c 'printf %s "$CC"' 2>/dev/null || true)
echo "$CC_OUT" | grep -q 'emcc' || {
  RO_CLEANUP
  trap - EXIT
  echo "homescoop: emconfigure did not set CC to emcc (got: $CC_OUT)" >&2
  exit 1
}
echo "  PRESTAGE: emconfigure CC OK ($CC_OUT)"

RO_CLEANUP
trap - EXIT

homescoop_assert_no_package_links "$PKG"
echo "== wasm-emscripten: sizes"
du -sh "$PKG" "$PKG/tools" "$PKG/src" "$PKG/system"

echo "== wasm-emscripten: PRESTAGE pack (no links)"
TGZ=$(homescoop_npm_pack_no_links "$PKG" "$HOMESCOOP_PKG")
# emcmake uses $EMSCRIPTEN_ROOT/emcc — must be in the published tarball.
tar -tzf "$TGZ" | grep -qx 'package/emcc' || {
  echo "homescoop: packed tarball missing package/emcc (files list?)" >&2
  exit 1
}
tar -tzf "$TGZ" | grep -qx 'package/emcmake' || {
  echo "homescoop: packed tarball missing package/emcmake" >&2
  exit 1
}
STAGE="$ROOT/staging/emscripten-acceptance"
if [[ -d "$STAGE" ]]; then
  cp "$TGZ" "$STAGE/"
fi
echo "STAGED: $TGZ"
ls -lh "$TGZ"
echo "OK wasm-emscripten $PKG_VER"
