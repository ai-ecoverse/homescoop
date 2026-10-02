#!/usr/bin/env bash
# Zig 0.16.0 no-LLVM compiler → wasm32-wasi for slicc.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-zig

command -v zig >/dev/null || { echo "missing host zig" >&2; exit 1; }
# Host zig must not see staged/PRESTAGE WASI ZIG_* paths (e.g. ZIG_LIB_DIR=/lib).
unset ZIG_LIB_DIR ZIG_GLOBAL_CACHE_DIR ZIG_LOCAL_CACHE_DIR ZIG_EXE || true
HOST_ZIG_VER="$(zig version)"
if [[ "$HOST_ZIG_VER" != "$VER" ]]; then
  echo "homescoop: host zig is $HOST_ZIG_VER but recipe wants $VER" >&2
  exit 1
fi

PKG_WORK="$HOMESCOOP_PKG/work"
mkdir -p "$PKG_WORK"
TARBALL="$PKG_WORK/zig-${VER}.tar.xz"
SRC="$PKG_WORK/zig-${VER}"
BUILD="$PKG_WORK/build-wasi"
PREBUILT="$PKG_WORK/prebuilt"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
homescoop_extract "$TARBALL" "$SRC"

# Always (re)apply patches into zig-build so staged lib/ matches the compiler.
ZIG_SRC="$PKG_WORK/zig-build"
PATCH_MARKER="$ZIG_SRC/.homescoop-patches-applied"
PATCH_HASH="$(
  shopt -s nullglob
  { cat "$HOMESCOOP_PKG"/patches/*.patch 2>/dev/null || true; } | shasum -a 256 | awk '{print $1}'
)"
if [[ ! -f "$PATCH_MARKER" || "$(cat "$PATCH_MARKER" 2>/dev/null || true)" != "$PATCH_HASH" || -n "${FORCE:-}" ]]; then
  echo "== wasi-zig: prepare patched sources"
  rm -rf "$ZIG_SRC"
  cp -a "$SRC" "$ZIG_SRC"
  shopt -s nullglob
  for p in "$HOMESCOOP_PKG"/patches/*.patch; do
    echo "== patch $(basename "$p")"
    patch -d "$ZIG_SRC" -p1 < "$p"
  done
  shopt -u nullglob
  printf '%s\n' "$PATCH_HASH" > "$PATCH_MARKER"
  # Patches changed → force rebuild of zig.wasm
  rm -f "$BUILD/prefix/bin/zig.wasm"
fi

if [[ ! -f "$BUILD/prefix/bin/zig.wasm" || -n "${FORCE:-}" ]]; then
  echo "== wasi-zig: cross-build zig.wasm (ReleaseSmall, no-LLVM, single-threaded)"
  rm -rf "$BUILD"
  mkdir -p "$BUILD/prefix" "$BUILD/host-cache"
  (
    cd "$ZIG_SRC"
    zig build \
      -Dtarget=wasm32-wasi \
      -Doptimize=ReleaseSmall \
      -Denable-llvm=false \
      -Dsingle-threaded=true \
      -Dno-langref \
      -Dno-lib \
      --prefix "$BUILD/prefix" \
      --global-cache-dir "$BUILD/host-cache" \
      -j1
  )
fi
test -f "$BUILD/prefix/bin/zig.wasm"

# Host-prebuilt compiler_rt archives (wasm backend cannot emit full CRT).
echo "== wasi-zig: prebuild libcompiler_rt for wasm targets"
mkdir -p "$PREBUILT"
for triple in wasm32-wasi wasm32-freestanding; do
  out="$PREBUILT/libcompiler_rt-${triple}.a"
  if [[ ! -f "$out" || -n "${FORCE:-}" ]]; then
    cdir="$PKG_WORK/crt-${triple}"
    rm -rf "$cdir"
    mkdir -p "$cdir"
    (
      cd "$cdir"
      if [[ "$triple" == wasm32-freestanding ]]; then
        printf '%s\n' 'export fn _start() void {}' > h.zig
        zig build-exe h.zig -target "$triple" -fno-llvm -fno-entry -fcompiler-rt \
          -OReleaseSmall --name h --global-cache-dir "$cdir/g"
      else
        printf '%s\n' 'const std=@import("std"); pub fn main() void { std.debug.print("x\n", .{}); }' > h.zig
        zig build-exe h.zig -target "$triple" -fno-llvm -OReleaseSmall \
          --name h --global-cache-dir "$cdir/g"
      fi
    )
    cp "$cdir"/g/o/*/libcompiler_rt.a "$out"
  fi
  test -f "$out"
done

# Stage package tree.
export PKG="$HOMESCOOP_PKG/package"
rm -rf "$PKG/bin" "$PKG/lib"
mkdir -p "$PKG/bin" "$PKG/lib/prebuilt"

echo "== wasi-zig: stage zig.wasm"
cp "$BUILD/prefix/bin/zig.wasm" "$PKG/bin/zig.wasm"
chmod 755 "$PKG/bin/zig.wasm"

echo "== wasi-zig: stage trimmed lib/ (from patched tree — includes wasix std)"
LIBSRC="$ZIG_SRC/lib"
if [[ ! -d "$LIBSRC/std" ]]; then
  echo "homescoop: missing patched lib at $LIBSRC (FORCE rebuild?)" >&2
  exit 1
fi
cp -a "$LIBSRC/std" "$PKG/lib/"
cp -a "$LIBSRC/compiler_rt.zig" "$LIBSRC/compiler_rt" "$PKG/lib/"
cp -a "$LIBSRC/ubsan_rt.zig" "$PKG/lib/"
cp -a "$LIBSRC/c.zig" "$LIBSRC/c" "$LIBSRC/zig.h" "$PKG/lib/"
cp -a "$LIBSRC/compiler" "$PKG/lib/"
cp -a "$LIBSRC/init" "$PKG/lib/"
mkdir -p "$PKG/lib/libc/include"
cp -a "$LIBSRC/libc/wasi" "$PKG/lib/libc/"
cp -a "$LIBSRC/libc/include/wasm-wasi-musl" "$PKG/lib/libc/include/"
cp -a "$LIBSRC/libc/include/generic-musl" "$PKG/lib/libc/include/"
# top-level libc helpers (non-platform dirs)
for f in "$LIBSRC/libc"/*; do
  base=$(basename "$f")
  case "$base" in
    wasi|include|mingw|musl|glibc|darwin|freebsd|netbsd|openbsd) ;;
    *) cp -a "$f" "$PKG/lib/libc/" ;;
  esac
done
cp "$PREBUILT"/*.a "$PKG/lib/prebuilt/"

# Dereference any symlinks under lib/ (npm tarballs must not contain links).
echo "== wasi-zig: flatten symlinks under lib/"
find "$PKG/lib" -type l -print0 | while IFS= read -r -d '' link; do
  target=$(readlink "$link" || true)
  if [[ -z "$target" ]]; then
    rm -f "$link"
    continue
  fi
  # Resolve relative to link dir
  dir=$(dirname "$link")
  if [[ "$target" = /* ]]; then
    real="$target"
  else
    real="$dir/$target"
  fi
  if [[ -f "$real" ]]; then
    rm -f "$link"
    cp "$real" "$link"
  elif [[ -d "$real" ]]; then
    rm -f "$link"
    cp -a "$real" "$link"
  else
    echo "homescoop: dangling symlink $link -> $target" >&2
    rm -f "$link"
  fi
done

homescoop_stage_license "$SRC/LICENSE"

# package.json + slicc metadata
echo "== wasi-zig: write package.json"
node <<'NODE'
const fs = require('fs');
const path = require('path');
const pkgDir = process.env.HOMESCOOP_PKG + '/package';
const ver = process.env.VERSION;
// Packaging rev: -11 = Build.WebServer usize; host PRESTAGE compiles build_runner for wasm32 run/test.
const npmVer = process.env.HOMESCOOP_NPM_VER || `${ver}-11`;
const j = {
  name: '@ai-ecoverse/wasi-zig',
  version: npmVer,
  description: 'Zig 0.16.0 compiler for slicc WASI (build-exe / wasm targets)',
  license: 'MIT',
  repository: {
    type: 'git',
    url: 'git+https://github.com/ai-ecoverse/homescoop.git',
    directory: 'packages/wasi-zig/package',
  },
  homepage: 'https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasi-zig',
  keywords: ['wasm', 'wasi', 'slicc', 'homescoop', 'zig'],
  files: ['README.md', 'LICENSE', 'PRESTAGE.md', 'bin', 'lib'],
  publishConfig: { access: 'public' },
  homescoop: { recipe: 'wasi-zig', upstream: ver },
  slicc: {
    abi: 'wasi',
    commands: {
      zig: {
        wasm: 'bin/zig.wasm',
        env: {
          ZIG_LIB_DIR: '${package}/lib',
          // SLICC expands ${NAME} from caller env (PR #3716); case-sensitive HOME.
          ZIG_GLOBAL_CACHE_DIR: '${HOME}/.cache/zig',
          // Bare command name — SLICC resolves to this package for child spawns.
          ZIG_EXE: 'zig',
        },
      },
    },
    env: {
      ZIG_LIB_DIR: '${package}/lib',
      ZIG_GLOBAL_CACHE_DIR: '${HOME}/.cache/zig',
      ZIG_EXE: 'zig',
    },
  },
};
fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(j, null, 2) + '\n');
NODE

cat > "$PKG/README.md" <<'EOF'
# @ai-ecoverse/wasi-zig

Zig 0.16.0 compiler built for **wasm32-wasi** (no LLVM) for use under slicc.

## First cut (accepted on SLICC)

- Works: `zig version`, `zig build-exe`, `zig run`, `zig build`, `zig build run`, `zig build test`, `zig test`, `-ofmt=c`, `ReleaseSmall`
- Unavailable in this cut: **`zig cc` / `zig c++`** — this package is a no-LLVM wasm32-wasi host; those frontends need LLVM/clang extensions. Use `@ai-ecoverse/wasm-clang` for C/C++ instead.

## Environment

`slicc.env` sets absolute paths (SLICC preopens `/`):

- `ZIG_LIB_DIR=${package}/lib`
- `ZIG_GLOBAL_CACHE_DIR=${HOME}/.cache/zig` (spawn-time `${NAME}` expansion; case-sensitive)
- `ZIG_EXE=zig` (bare command name for child spawns; SLICC resolves it)

Without those env vars, upstream `zig env` discovery expects WASI preopens named `/lib` and `/cache`.

## Wasm output (WASI command ABI)

`build-exe -target wasm32-wasi` exports `_start` and does **not** emit a Wasm start section
(section id 8). Hosts that bind memory after instantiate (SLICC, `node:wasi`) must call
`_start` themselves — matching `wasm-ld`.

## WASIX (compiler host only)

The compiler binary imports `wasix_32v1` (`proc_spawn3`, `proc_join`, `fd_pipe`, …) so
`zig run` / `zig build` can spawn on SLICC. User programs built with
`-target wasm32-wasi` do **not** import wasix unless they call `std.process.spawn`
themselves (dead-code elimination).

## compiler_rt

The wasm backend cannot fully compile `compiler_rt.zig` (object-mode TODOs). This package ships host-prebuilt archives under `lib/prebuilt/libcompiler_rt-wasm32-*.a` and loads them automatically on the no-LLVM host.
EOF

cat > "$PKG/PRESTAGE.md" <<'EOF'
# wasi-zig PRESTAGE

- `tar tvzf … | grep -E '^[lh]'` empty (no symlinks/hardlinks in the npm tarball)
- `zig version` → `0.16.0` under wasmtime/slicc with `/lib`+`/cache` preopens (or `ZIG_*` on SLICC)
- `zig build-exe hello.zig -target wasm32-wasi -OReleaseSmall` produces `hello.wasm`
- `hello.wasm` has **no** start section (id 8); exports `_start`
- `hello.wasm` runs under **node:wasi** (not only wasmtime)
- `hello.wasm` has **no** `wasix_32v1` imports (pure preview1)
- `process.Init` user program (`io.zig`) compiles + runs for wasm32-wasi (Args.Vector stays void)
- `zig build` on a trivial `build.zig` installs `zig-out/bin/app.wasm` (needs WASIX spawn; SLICC)
- `zig build run` / `zig build test` with `addRunArtifact` + `addTest` (Run step; needs WASIX; SLICC)
- `zig.wasm` **does** import `wasix_32v1` (spawn for run/build on SLICC)
- package.json `ZIG_GLOBAL_CACHE_DIR` is `${HOME}/.cache/zig`; `ZIG_EXE` is `zig`
EOF

cp "$PKG/PRESTAGE.md" "$HOMESCOOP_PKG/PRESTAGE.md"

# PRESTAGE smoke — zig.wasm imports wasix_32v1; wasmtime stubs unknowns with -W.
# Use Zig's native WASI preopen names (/lib, /cache). SLICC sets absolute ZIG_* with '/' preopen.
echo "== wasi-zig: PRESTAGE wasmtime build-exe hello"
export SMOKE="$PKG_WORK/prestage-smoke"
rm -rf "$SMOKE"
mkdir -p "$SMOKE/cwd" "$SMOKE/cache"
cat > "$SMOKE/cwd/hello.zig" <<'Z'
const std = @import("std");
pub fn main() void {
    std.debug.print("hello from zig wasi\n", .{});
}
Z
# process.Init repro from SLICC acceptance (Args must stay plain-WASI / void vector)
cat > "$SMOKE/cwd/io.zig" <<'Z'
const std = @import("std");
pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    var list: std.ArrayList(u8) = .empty;
    defer list.deinit(init.gpa);
    try list.appendSlice(init.gpa, "args:");
    for (args) |a| {
        try list.append(init.gpa, ' ');
        try list.appendSlice(init.gpa, a);
    }
    try list.append(init.gpa, '\n');
    std.debug.print("{s}", .{list.items});
}
Z
cat > "$SMOKE/cwd/build.zig" <<'Z'
const std = @import("std");
pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .wasi,
    });
    const optimize = b.standardOptimizeOption(.{});
    const exe = b.addExecutable(.{
        .name = "app",
        .root_module = b.createModule(.{
            .root_source_file = b.path("app.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    const run_step = b.step("run", "Run the app");
    run_step.dependOn(&run_cmd.step);

    const unit_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("app.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    const run_tests = b.addRunArtifact(unit_tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_tests.step);
}
Z
cat > "$SMOKE/cwd/app.zig" <<'Z'
pub fn main() void {}
test "ok" {}
Z
run_zig() {
  # Prefer WASI preopens /lib+/cache (getPreopen). Absolute ZIG_LIB_DIR needs '/' preopen (SLICC).
  wasmtime run -W unknown-imports-trap \
    --dir "$SMOKE/cwd::." \
    --dir "$PKG/lib::/lib" \
    --dir "$SMOKE/cache::/cache" \
    --env ZIG_EXE=zig \
    "$PKG/bin/zig.wasm" "$@"
}
run_zig version | grep -qx "$VER"
echo "  PRESTAGE: zig version OK"
run_zig build-exe hello.zig -target wasm32-wasi -OReleaseSmall --name hello
test -s "$SMOKE/cwd/hello.wasm"
run_zig build-exe io.zig -target wasm32-wasi -OReleaseSmall --name io
test -s "$SMOKE/cwd/io.wasm"
echo "  PRESTAGE: process.Init io.zig build-exe OK"
out_io="$(wasmtime run "$SMOKE/cwd/io.wasm" -- hello world 2>&1 | tr -d '\r')"
echo "$out_io" | grep -q 'args:'
echo "  PRESTAGE: process.Init io.wasm run OK"

# Assert: no Wasm start section (id 8); _start is exported.
node <<'NODE'
const fs = require('fs');
const path = process.env.SMOKE + '/cwd/hello.wasm';
const buf = fs.readFileSync(path);
if (buf.readUInt32LE(0) !== 0x6d736100) throw new Error('bad wasm magic');
let i = 8;
const sections = [];
while (i < buf.length) {
  const id = buf[i++];
  let n = 0, shift = 0, b;
  do { b = buf[i++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
  sections.push(id);
  i += n;
}
if (sections.includes(8)) {
  console.error('PRESTAGE FAIL: wasm has start section (id 8); sections=', sections);
  process.exit(1);
}
console.log('  PRESTAGE: no start section OK (sections=' + sections.join(',') + ')');

function importModules(buf) {
  let i = 8;
  const mods = new Set();
  while (i < buf.length) {
    const id = buf[i++];
    let n = 0, shift = 0, b;
    do { b = buf[i++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const body = buf.subarray(i, i + n); i += n;
    if (id !== 2) continue;
    let j = 0;
    const u = () => { let v = 0, s = 0; for (;;) { const x = body[j++]; v |= (x & 0x7f) << s; s += 7; if (!(x & 0x80)) return v; } };
    const cnt = u();
    for (let k = 0; k < cnt; k++) {
      const ml = u(); const mod = body.subarray(j, j + ml).toString(); j += ml;
      const nl = u(); j += nl;
      const kind = body[j++];
      if (kind === 0) u();
      else if (kind === 1) { j++; u(); }
      else if (kind === 2) { j++; u(); u(); }
      else if (kind === 3) { j++; u(); }
      mods.add(mod);
    }
  }
  return mods;
}
const helloMods = importModules(buf);
if (helloMods.has('wasix_32v1')) {
  console.error('PRESTAGE FAIL: hello.wasm imports wasix_32v1 (must stay preview1-only)');
  process.exit(1);
}
console.log('  PRESTAGE: hello.wasm no wasix_32v1 OK');
const zigMods = importModules(fs.readFileSync(process.env.PKG + '/bin/zig.wasm'));
if (!zigMods.has('wasix_32v1')) {
  console.error('PRESTAGE FAIL: zig.wasm missing wasix_32v1 imports');
  process.exit(1);
}
console.log('  PRESTAGE: zig.wasm imports wasix_32v1 OK');
NODE

out="$(wasmtime run "$SMOKE/cwd/hello.wasm" 2>&1 | tr -d '\r')"
echo "$out" | grep -qx 'hello from zig wasi'
echo "  PRESTAGE: wasmtime run hello OK"

# node:wasi — binds memory then calls _start (SLICC-like); start section would break this.
node <<'NODE'
const fs = require('fs');
const { WASI } = require('node:wasi');
const path = require('path');
const wasmPath = path.join(process.env.SMOKE, 'cwd', 'hello.wasm');
const wasi = new WASI({
  version: 'preview1',
  args: ['hello'],
  env: process.env,
  preopens: { '/': process.env.SMOKE + '/cwd' },
  returnOnExit: true,
});
(async () => {
  const { instance } = await WebAssembly.instantiate(
    fs.readFileSync(wasmPath),
    { wasi_snapshot_preview1: wasi.wasiImport },
  );
  if (!instance.exports._start) {
    console.error('PRESTAGE FAIL: no _start export');
    process.exit(1);
  }
  const code = wasi.start(instance);
  if (code !== 0 && code !== undefined) {
    console.error('PRESTAGE FAIL: node:wasi exit', code);
    process.exit(1);
  }
  console.log('  PRESTAGE: node:wasi run hello OK');
})().catch((e) => {
  console.error('PRESTAGE FAIL: node:wasi', e);
  process.exit(1);
});
NODE

grep -q '"ZIG_GLOBAL_CACHE_DIR": "${HOME}/.cache/zig"' "$PKG/package.json"
echo "  PRESTAGE: package.json \${HOME} OK"
grep -q '"ZIG_EXE": "zig"' "$PKG/package.json"
echo "  PRESTAGE: package.json ZIG_EXE=zig OK"

# Host-compile build_runner with staged lib + stage2_wasm to catch Feature.Set / vector TODOs
# before SLICC (wasmtime cannot spawn WASIX children for a full `zig build`).
echo "== wasi-zig: PRESTAGE host stage2_wasm build_runner (+ Feature.Set scalar loops)"
BR_OUT="$SMOKE/build-runner-check"
rm -rf "$BR_OUT"
mkdir -p "$BR_OUT"
# Compile only far enough that Target.Cpu.Feature.Set is codegen'd for wasm.
# Full build_runner may hit more TODOs; we require at least Feature.Set path to succeed.
# Use `zig build` via wasi zig — trap on spawn is OK only AFTER build_runner cached.
# First: probe compile of a tiny program that exercises Feature.Set (same as build_runner).
cat > "$SMOKE/cwd/featset.zig" <<'Z'
const std = @import("std");
pub fn main() void {
    var set: std.Target.Cpu.Feature.Set = .empty;
    const other: std.Target.Cpu.Feature.Set = .empty;
    set.addFeatureSet(other);
    set.removeFeatureSet(other);
    _ = set.isSuperSetOf(other);
}
Z
run_zig build-exe featset.zig -target wasm32-wasi -OReleaseSmall --name featset
test -s "$SMOKE/cwd/featset.wasm"
echo "  PRESTAGE: Feature.Set scalar loops compile OK"

# Attempt full zig build; on WASIX-capable hosts this installs app.wasm.
# Under wasmtime, WASIX spawn traps — but the build_runner MUST compile first.
# Gate: app.wasm OR cached build.wasm OR stderr shows spawn/trap after a clean compile.
# Do NOT accept generic "exit != 0" as success (that shipped -8 with MultiReader type errors).
echo "== wasi-zig: PRESTAGE zig build (must compile build_runner; spawn may trap under wasmtime)"
set +e
run_zig build -j1 >"$SMOKE/zig-build.out" 2>"$SMOKE/zig-build.err"
zb_ec=$?
set -e
runner_wasm=""
if [[ -f "$SMOKE/cwd/zig-out/bin/app.wasm" ]]; then
  echo "  PRESTAGE: zig build installed zig-out/bin/app.wasm OK"
elif runner_wasm="$(find "$SMOKE/cwd/.zig-cache" -name 'build.wasm' 2>/dev/null | head -1)" && [[ -n "$runner_wasm" ]]; then
  echo "  PRESTAGE: zig build_runner compiled ($runner_wasm); full install needs WASIX/SLICC (exit=$zb_ec)"
elif grep -E 'error: ' "$SMOKE/zig-build.err" >/dev/null; then
  echo "PRESTAGE FAIL: zig build_runner failed to compile (must reach spawn):" >&2
  cat "$SMOKE/zig-build.err" >&2
  exit 1
elif grep -Ei 'proc_spawn|wasix_32v1|wasm trap|unreachable|out of bounds|stack overflow' "$SMOKE/zig-build.err" >/dev/null; then
  echo "  PRESTAGE: zig build reached spawn/trap path OK (exit=$zb_ec; full install needs WASIX/SLICC)"
  tail -8 "$SMOKE/zig-build.err" || true
else
  echo "PRESTAGE FAIL: zig build did not compile runner or reach spawn (exit=$zb_ec):" >&2
  cat "$SMOKE/zig-build.err" >&2
  exit 1
fi

# Host-compile the project build_runner for wasm32-wasi. This analyzes Run.zig /
# WebServer.zig / test paths that wasmtime may stack-overflow before reporting.
# Catches u64→usize and similar 32-bit gaps that 64-bit hosts never see.
echo "== wasi-zig: PRESTAGE host-compile build_runner (wasm32-wasi, addRunArtifact+addTest)"
BR_HOST="$SMOKE/build-runner-wasm32"
rm -rf "$BR_HOST"
mkdir -p "$BR_HOST"
cat > "$BR_HOST/dependencies.zig" <<'Z'
pub const packages = struct {};
pub const root_deps: []const struct { []const u8, []const u8 } = &.{};
Z
# Use staged package lib (same bits SLICC gets).
unset ZIG_LIB_DIR ZIG_GLOBAL_CACHE_DIR ZIG_LOCAL_CACHE_DIR ZIG_EXE || true
set +e
(
  cd "$BR_HOST"
  ZIG_LIB_DIR="$PKG/lib" zig build-exe \
    -OReleaseSmall -target wasm32-wasi \
    --cache-dir "$BR_HOST/cache" --global-cache-dir "$BR_HOST/gcache" \
    --name build_runner_wasi \
    -fcompiler-rt \
    --dep "@build" --dep "@dependencies" \
    -Mroot="$PKG/lib/compiler/build_runner.zig" \
    -M"@build=$SMOKE/cwd/build.zig" \
    -M"@dependencies=$BR_HOST/dependencies.zig"
) >"$BR_HOST/out.txt" 2>"$BR_HOST/err.txt"
br_ec=$?
set -e
if [[ $br_ec -ne 0 || ! -f "$BR_HOST/build_runner_wasi.wasm" ]]; then
  echo "PRESTAGE FAIL: host wasm32 build_runner (run+test build.zig) did not compile (exit=$br_ec):" >&2
  cat "$BR_HOST/err.txt" >&2
  exit 1
fi
echo "  PRESTAGE: host wasm32 build_runner (addRunArtifact+addTest) compile OK"

# Helper: zig build <step> under wasmtime — spawn may trap; fail hard on .zig compile errors.
prestage_zig_build_step() {
  local step="$1"
  local label="$2"
  local out="$SMOKE/zig-build-${step}.out"
  local err="$SMOKE/zig-build-${step}.err"
  set +e
  run_zig build "$step" -j1 >"$out" 2>"$err"
  local ec=$?
  set -e
  if grep -E '\.zig:[0-9]+:[0-9]+: error:' "$err" >/dev/null; then
    echo "PRESTAGE FAIL: zig build $step failed to compile ($label):" >&2
    cat "$err" >&2
    exit 1
  fi
  if grep -Ei 'TODO: intMulOverflow|TODO: Wasm backend' "$err" >/dev/null; then
    echo "PRESTAGE FAIL: zig build $step hit backend TODO ($label):" >&2
    cat "$err" >&2
    exit 1
  fi
  if [[ $ec -eq 0 ]]; then
    echo "  PRESTAGE: zig build $step OK (exit=0)"
    return 0
  fi
  echo "  PRESTAGE: zig build $step compiled ($label; exit=$ec; full run needs WASIX/SLICC)"
}

echo "== wasi-zig: PRESTAGE zig build run (Run step)"
prestage_zig_build_step run "addRunArtifact"
echo "== wasi-zig: PRESTAGE zig build test (Run step / addTest)"
prestage_zig_build_step test "addTest"

echo "== wasi-zig: PRESTAGE pack (no links)"
TGZ="$(homescoop_npm_pack_no_links "$PKG" "$PKG_WORK")"
echo "  PRESTAGE: packed $(basename "$TGZ")"

echo "== wasi-zig: staged → $PKG ($(node -p "require('$PKG/package.json').version"))"
du -sh "$PKG/bin/zig.wasm" "$PKG/lib" "$TGZ"
