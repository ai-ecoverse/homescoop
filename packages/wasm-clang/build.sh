#!/usr/bin/env bash
# @ai-ecoverse/wasm-clang: one multi-call module (clang, lld, llvm-ar, llvm-nm,
# llvm-objcopy, llvm-symbolizer) linked in CI from @ai-ecoverse/llvm-emscripten
# (llvm-project b158b0ae compiled by the patched emscripten 6.0.9 tree,
# homescoop#859 stage E), fetched by sha256, against today's shims/slicc, with
# the WASIX drivers and the clang 24 resource dir.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasm-clang --source wasix_sysroot
SYSROOT_URL="$WASIX_SYSROOT_SRC_URL"
SYSROOT_SHA="$WASIX_SYSROOT_SRC_SHA"
SYSROOT_VER="$WASIX_SYSROOT_VER"
homescoop_load_recipe wasm-clang
PKG="$HOMESCOOP_PKG/package"
PKG_VER="$(node -p 'require(process.argv[1]).version' "$PKG/package.json")"
BINARYEN_VER="$(node -p 'require(process.argv[1]).dependencies["@ai-ecoverse/wasm-binaryen"]' "$PKG/package.json")"
POST_JS="$ROOT/scripts/slicc-node-main.js"
TOOLS=(clang lld llvm-ar llvm-nm llvm-objcopy llvm-symbolizer)
# Every name the module answers to ships as a byte-copy of bin/llvm (emcc spawns
# paths under LLVM_ROOT; the glue locates llvm.wasm beside it).
ALIASES=(clang clang++ lld wasm-ld ld.lld llvm-ar llvm-ranlib llvm-nm \
  llvm-objcopy llvm-strip llvm-symbolizer)

echo "== wasm-clang: llvm-emscripten $(basename "$SRC_URL") and wasix-sysroot $SYSROOT_VER, by sha256"
LE_TGZ="$WORK/$(basename "$SRC_URL")"
LE="$WORK/llvm-emscripten"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$LE_TGZ"
rm -rf "$LE"
mkdir -p "$LE"
tar -xzf "$LE_TGZ" -C "$LE" --strip-components=1
SYS_TGZ="$WORK/$(basename "$SYSROOT_URL")"
homescoop_fetch "$SYSROOT_URL" "$SYSROOT_SHA" "$SYS_TGZ"
node -e '
const m = require(process.argv[1]);
const want = { llvm_commit: "b158b0ae6c559f87be325b8f427c5588e6a48823", eh: "js" };
for (const [k, v] of Object.entries(want)) if (m[k] !== v) { console.error(`homescoop: llvm-emscripten manifest ${k} is ${m[k]}, want ${v}`); process.exit(1); }
if (m.emscripten?.tag !== "6.0.9") { console.error(`homescoop: llvm-emscripten was built with emscripten ${m.emscripten?.tag}`); process.exit(1); }
if (!/128-byte/.test(m.sysroot?.sigset_t || "")) { console.error("homescoop: llvm-emscripten was not compiled against the 128-byte sigset_t"); process.exit(1); }
if (!m.llvm_patches?.["0001-main-executable-emscripten.patch"]) { console.error("homescoop: llvm-emscripten lacks the getMainExecutable patch (clang would spawn \"\" for -cc1 and the linker)"); process.exit(1); }
for (const t of process.argv.slice(2)) if (!m.tools[t]) { console.error(`homescoop: llvm-emscripten has no ${t}`); process.exit(1); }
' "$LE/manifest.json" "${TOOLS[@]}"

eval "$(bash "$ROOT/scripts/emscripten-tree.sh" "$WORK/wasm-clang-em")"
export EM_CONFIG="$EMSCRIPTEN_TREE_CONFIG"
EMCC=(python3 "$EMSCRIPTEN_TREE/emcc.py")
EMXX=(python3 "$EMSCRIPTEN_TREE/em++.py")
EMAR=(python3 "$EMSCRIPTEN_TREE/emar.py")
grep -q '__bits\[128/sizeof(long)\]' "$EMSCRIPTEN_TREE_CACHE/sysroot/include/bits/alltypes.h" 2>/dev/null \
  || grep -q '__bits\[128/sizeof(long)\]' "$EMSCRIPTEN_TREE/system/lib/libc/musl/arch/emscripten/bits/alltypes.h"

# multicall.cpp initializes LLVM per tool as the generated driver mains do:
# clang with (true, true), the others with the defaults. Fail if that changed.
for t in "${TOOLS[@]}"; do
  drv="$LE/drivers/$t-driver.cpp"
  test -f "$drv" || { echo "homescoop: llvm-emscripten has no drivers/$t-driver.cpp" >&2; exit 1; }
  init=$(grep -o 'InitLLVM X([^;]*' "$drv")
  if [[ $t == clang ]]; then
    want='InitLLVM X(argc, argv, /*InstallPipeSignalExitHandler=*/true, /*NeedsPOSIXUtilitySignalHandling=*/true)'
  else
    want='InitLLVM X(argc, argv)'
  fi
  [[ "$init" == "$want" ]] || {
    echo "homescoop: $t-driver.cpp has '$init'; multicall.cpp expects '$want'" >&2
    exit 1
  }
done

echo "== wasm-clang: libslicc (spawn, exec, signals, libc gaps with credentials)"
ODIR="$WORK/wasm-clang-objs"
rm -rf "$ODIR"
mkdir -p "$ODIR"
objs=()
for src in slicc_spawn slicc_exec slicc_libc_gaps slicc_signals; do
  "${EMCC[@]}" -O2 -c "$ROOT/shims/slicc/${src}.c" -o "$ODIR/${src}.o"
  objs+=("$ODIR/${src}.o")
done
"${EMCC[@]}" -O2 -c "$HOMESCOOP_PKG/keep-slicc-spawn.c" -o "$ODIR/keep-slicc-spawn.o"
objs+=("$ODIR/keep-slicc-spawn.o")
SLICC_A="$ODIR/libslicc-clang.a"
"${EMAR[@]}" rcs "$SLICC_A" "${objs[@]}"
grep -q sliccKernel "$ODIR/slicc_spawn.o"

echo "== wasm-clang: compile multicall.cpp with llvm-emscripten's clang-driver.cpp command"
MULTI_O="$ODIR/multicall.o"
node -e '
const { spawnSync } = require("child_process");
const [manifest, le, src, out] = process.argv.slice(1);
const m = require(manifest);
const args = [...m.multicall.args, "-c", src, "-o", out];
const r = spawnSync("python3", [require("path").join(process.env.EMSCRIPTEN_TREE, "em++.py"), ...args], { cwd: le, stdio: "inherit" });
process.exit(r.status ?? 1);
' "$LE/manifest.json" "$LE" "$HOMESCOOP_PKG/multicall.cpp" "$MULTI_O"
test -f "$MULTI_O"

OUT_DIR="$WORK/wasm-clang-link"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
echo "== wasm-clang: link ${TOOLS[*]} into one module"
python3 - "$LE" "$OUT_DIR/llvm" "$SLICC_A" "$POST_JS" "$ROOT/shims/slicc" "$MULTI_O" "${TOOLS[@]}" <<'PY'
import json, os, shlex, subprocess, sys
le, out, slicc_a, post_js, shims, multi_o, *tools = sys.argv[1:]
m = json.load(open(os.path.join(le, "manifest.json")))
objs, libs, sys_libs, flag_sets = [], [], [], []
for t in tools:
    e = m["tools"][t]
    for o in e["objects"]:
        if o.endswith("-driver.cpp.o"):
            sys.exit(f"homescoop: {t}: llvm-emscripten lists its generated driver main {o}")
        p = os.path.join(le, o)
        if not os.path.isfile(p):
            sys.exit(f"homescoop: {t}: missing {o}")
        objs.append(p)
    for lib in e["libs"]:
        p = os.path.join(le, lib)
        if not os.path.isfile(p):
            sys.exit(f"homescoop: {t}: missing {lib}")
        if p not in libs:
            libs.append(p)
    for s in e.get("system_libs", []):
        if s not in sys_libs:
            sys_libs.append(s)
    flags = [f for f in e["link_flags"] if f not in ("-Wl,--gc-sections", "--gc-sections")]
    for f in flags:
        if f.startswith("/") or "=/" in f or f.startswith(("-sENVIRONMENT", "-sEXIT_RUNTIME", "--extern-post-js")):
            sys.exit(f"homescoop: {t}: link flag {f} is a path or a realm flag; build.sh sets those")
    flag_sets.append(flags)
if any(f != flag_sets[0] for f in flag_sets):
    sys.exit(f"homescoop: the tools' link flags differ: {flag_sets}")
extra = [
    "-sDISABLE_EXCEPTION_CATCHING=0",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sSTACK_SIZE=8388608",
    "-sFORCE_FILESYSTEM=1",
    "-sINVOKE_RUN=0",
    "-sEXPORTED_RUNTIME_METHODS=FS,callMain",
    "-sENVIRONMENT=web,worker,node",
    "-sEXIT_RUNTIME=1",
    "-lnodefs.js",
    f"--js-library={shims}/slicc-writev.js",
    f"--js-library={shims}/slicc-linkat.js",
    f"--js-library={shims}/slicc-uname.js",
    f"--extern-post-js={post_js}",
    "-Wl,-u,slicc_raise",
    "-Wl,-u,slicc_sig_mask",
    "-Wl,-u,slicc_sigpipe",
    "-Wl,-u,slicc_cred_euid",
    "-Wl,-u,__syscall_wait4",
    "-Wl,-u,execve",
    "-Wl,-u,slicc_spawn_capture",
    "-Wl,-u,homescoop_keep_slicc_spawn",
    "-Wl,--wrap=raise",
    "-Wl,--whole-archive",
    slicc_a,
    "-Wl,--no-whole-archive",
    "-sEXPORTED_FUNCTIONS=_main,_homescoop_keep_slicc_spawn",
    "-sDECLARE_ASM_MODULE_EXPORTS=0",
]
cmd = ["python3", os.path.join(os.environ["EMSCRIPTEN_TREE"], "em++.py"), "-O3", "-fexceptions",
       multi_o, *objs, *libs, *sys_libs, *flag_sets[0], *extra, "-o", f"{out}.js"]
print(f"  em++ -O3 -fexceptions: {len(objs)} objects, {len(libs)} archives, flags {flag_sets[0]}")
sys.exit(subprocess.run(cmd).returncode)
PY
test -f "$OUT_DIR/llvm.js" && test -f "$OUT_DIR/llvm.wasm"
mv "$OUT_DIR/llvm.js" "$OUT_DIR/llvm"
grep -q "!Module\['noInitialRun'\]" "$OUT_DIR/llvm"
grep -q 'slicc_cred_js' "$OUT_DIR/llvm"
grep -q sliccKernel "$OUT_DIR/llvm"
grep -qE "locateFile\\([\"']llvm\\.wasm[\"']\\)" "$OUT_DIR/llvm"
if LC_ALL=C grep -aEq '/(home|Users|__w|private/var)/' "$OUT_DIR/llvm.wasm"; then
  echo "homescoop: llvm.wasm names a build path" >&2
  exit 1
fi

# wasm-opt lives in @ai-ecoverse/wasm-binaryen (driver finds it on PATH).
echo "== wasm-clang: stage package $PKG_VER (no bundled wasm-opt)"
rm -rf "$PKG/bin" "$PKG/lib"
mkdir -p "$PKG/bin" "$PKG/lib/clang"
cp "$OUT_DIR/llvm" "$PKG/bin/llvm"
cp "$OUT_DIR/llvm.wasm" "$PKG/bin/llvm.wasm"
chmod +x "$PKG/bin/llvm" "$PKG/bin/llvm.wasm"
for name in "${ALIASES[@]}"; do
  cp "$PKG/bin/llvm" "$PKG/bin/$name"
  chmod +x "$PKG/bin/$name"
done
cp -R "$LE/lib/clang/24" "$PKG/lib/clang/24"

# clang 24 --target=wasm32-wasip1 looks for builtins at
# $resource-dir/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a (not the
# sysroot's libclang_rt.builtins-wasm32.a name). From the pinned wasix-sysroot.
SYS_X="$WORK/wasix-sysroot-builtins"
rm -rf "$SYS_X"
mkdir -p "$SYS_X"
tar -xzf "$SYS_TGZ" -C "$SYS_X" package/sysroot-exnref-eh/lib/wasm32-wasip1/libclang_rt.builtins-wasm32.a package/THIRD-PARTY-NOTICES.md
BUILTINS_SRC="$SYS_X/package/sysroot-exnref-eh/lib/wasm32-wasip1/libclang_rt.builtins-wasm32.a"
test -f "$BUILTINS_SRC"
for triple in wasm32-unknown-wasip1 wasm32-unknown-wasi; do
  mkdir -p "$PKG/lib/clang/24/lib/$triple"
  cp "$BUILTINS_SRC" "$PKG/lib/clang/24/lib/$triple/libclang_rt.builtins.a"
  [[ ! -L "$PKG/lib/clang/24/lib/$triple/libclang_rt.builtins.a" ]]
done
echo "== wasm-clang: resource-dir builtins for wasip1/wasi from wasix-sysroot $SYSROOT_VER"

DRIVER="$HOMESCOOP_PKG/drivers/wasix-driver.sh"
test -f "$DRIVER"
for name in cc gcc c++ g++ wasixcc wasix++; do
  cp "$DRIVER" "$PKG/bin/$name"
  chmod +x "$PKG/bin/$name"
done
cp "$LE/LICENSE" "$PKG/LICENSE"
test -f "$LE/THIRD-PARTY-NOTICES.md" || { echo "homescoop: llvm-emscripten ships no THIRD-PARTY-NOTICES.md (homescoop#1098)" >&2; exit 1; }
grep -q 'Henry Spencer' "$LE/THIRD-PARTY-NOTICES.md"
grep -qi 'BLAKE3' "$LE/THIRD-PARTY-NOTICES.md"
grep -qi 'xxHash' "$LE/THIRD-PARTY-NOTICES.md"
homescoop_notices_begin "bin/llvm.wasm statically links the following."
homescoop_notice "Emscripten 6.0.9 (runtime and system libraries)" \
  "$EMSCRIPTEN_TREE/LICENSE" - \
  "$EMSCRIPTEN_TREE/system/lib/libc/musl/COPYRIGHT" - \
  "$EMSCRIPTEN_TREE/system/lib/libcxx/LICENSE.TXT" -
awk '/^## compiler-rt /{p=1; print; next} /^## /{p=0} p' "$SYS_X/package/THIRD-PARTY-NOTICES.md" | sed -e '1d' -e '/^```/d' > "$WORK/wasix-sysroot-compiler-rt.txt"
grep -q 'Apache License' "$WORK/wasix-sysroot-compiler-rt.txt"
homescoop_notice "wasix-sysroot $SYSROOT_VER (@ai-ecoverse/wasix-sysroot): compiler-rt builtins, lib/clang/24/lib/*/libclang_rt.builtins.a (Apache-2.0 WITH LLVM-exception)" \
  "$WORK/wasix-sysroot-compiler-rt.txt" -
printf '\n## llvm-project b158b0ae (from @ai-ecoverse/llvm-emscripten, whose objects bin/llvm.wasm links)\n\n' >>"$HOMESCOOP_NOTICES"
sed -e '1{/^# /d;}' "$LE/THIRD-PARTY-NOTICES.md" | sed -e 's/^## /### /' >>"$HOMESCOOP_NOTICES"
grep -q 'Henry Spencer' "$PKG/THIRD-PARTY-NOTICES.md"
grep -qi 'BLAKE3' "$PKG/THIRD-PARTY-NOTICES.md"
grep -qi 'xxHash' "$PKG/THIRD-PARTY-NOTICES.md"

node -e '
const fs = require("fs");
const [p, sysVer, binVer] = process.argv.slice(1);
const j = JSON.parse(fs.readFileSync(p, "utf8"));
if (j.dependencies["@ai-ecoverse/wasix-sysroot"] !== sysVer) { console.error(`homescoop: package.json pins wasix-sysroot ${j.dependencies["@ai-ecoverse/wasix-sysroot"]}, recipe ${sysVer}`); process.exit(1); }
if (!/^\d+\.\d+\.\d+-\d+$/.test(binVer)) { console.error(`homescoop: wasm-binaryen pin ${binVer} is not exact`); process.exit(1); }
const cmds = j.slicc.commands;
for (const name of ["cc", "gcc", "c++", "g++", "wasixcc", "wasix++"]) if (cmds[name]?.script !== "bin/" + name) process.exit(1);
for (const n of ["clang", "clang++", "lld", "wasm-ld", "ld.lld", "llvm-ar", "llvm-ranlib", "llvm-nm", "llvm-objcopy", "llvm-strip", "llvm-symbolizer"]) {
  if (cmds[n]?.glue !== "bin/llvm" || cmds[n]?.wasm !== "bin/llvm.wasm" || cmds[n]?.argv0 !== n) { console.error(`homescoop: slicc.commands.${n}`); process.exit(1); }
}
' "$PKG/package.json" "$SYSROOT_VER" "$BINARYEN_VER"

echo "== PRESTAGE: one module, alias glues, dispatch, no package links, no bundled wasm-opt"
wasms=$(cd "$PKG/bin" && ls -- *.wasm)
[[ "$wasms" == "llvm.wasm" ]] || { echo "homescoop: bin/ must hold only llvm.wasm, got: $wasms" >&2; exit 1; }
for name in "${ALIASES[@]}"; do
  cmp -s "$PKG/bin/llvm" "$PKG/bin/$name" || {
    echo "homescoop: alias glue bin/$name must be a byte-copy of bin/llvm" >&2
    exit 1
  }
  case $name in
    clang|clang++) want="clang version 24" ;;
    lld|wasm-ld|ld.lld) want="LLD 24" ;;
    *) want="LLVM version 24" ;;
  esac
  if [[ $name == lld ]]; then got=$(node "$PKG/bin/$name" -flavor wasm --version 2>&1 || true)
  else got=$(node "$PKG/bin/$name" --version 2>&1 || true); fi
  grep -q "$want" <<<"$got" || {
    echo "homescoop: bin/$name --version: expected '$want', got: $got" >&2
    exit 1
  }
  printf "  bin/%s -> %s\n" "$name" "$want"
done
# Real work, not just --version: clang with -mllvm (CommandLine registry)
# compiles, ar archives it, nm lists it, objcopy rewrites it, and wasm-ld links.
SMOKE="$WORK/wasm-clang-smoke"
rm -rf "$SMOKE"
mkdir -p "$SMOKE"
printf 'int smoke_add(int a, int b) { return a + b; }\n' > "$SMOKE/s.c"
SLICC_PRELOAD="/w/s.c=$SMOKE/s.c" SLICC_EXPORT_DIR="/w=$SMOKE/out" \
  node "$PKG/bin/clang" --target=wasm32-wasip1 -O2 -mllvm -disable-lsr -c /w/s.c -o /w/s.o
SLICC_PRELOAD="/w/s.o=$SMOKE/out/s.o" SLICC_EXPORT_DIR="/w=$SMOKE/out2" \
  node "$PKG/bin/llvm-ar" rcs /w/libs.a /w/s.o
nm_out=$(SLICC_PRELOAD="/w/libs.a=$SMOKE/out2/libs.a" node "$PKG/bin/llvm-nm" /w/libs.a)
grep -q "T smoke_add" <<<"$nm_out" || {
  echo "homescoop: clang -c | llvm-ar | llvm-nm smoke failed: $nm_out" >&2
  exit 1
}
SLICC_PRELOAD="/w/s.o=$SMOKE/out/s.o" SLICC_EXPORT_DIR="/w=$SMOKE/out3" \
  node "$PKG/bin/llvm-objcopy" --strip-all /w/s.o /w/t.o
test -s "$SMOKE/out3/t.o"
SLICC_PRELOAD="/w/s.o=$SMOKE/out/s.o" SLICC_EXPORT_DIR="/w=$SMOKE/out4" \
  node "$PKG/bin/wasm-ld" --no-entry --export=smoke_add /w/s.o -o /w/s.wasm
node -e 'const m = new WebAssembly.Module(require("fs").readFileSync(process.argv[1])); if (!WebAssembly.Module.exports(m).some((e) => e.name === "smoke_add")) process.exit(1)' "$SMOKE/out4/s.wasm"
sym=$(node "$PKG/bin/llvm-symbolizer" --version 2>&1 || true)
grep -q "LLVM version 24" <<<"$sym"
rm -rf "$SMOKE"
echo "  smoke: clang -mllvm -c, llvm-ar rcs, llvm-nm → T smoke_add, llvm-objcopy --strip-all, wasm-ld → exports smoke_add"
for need in clang clang++ llvm-ar llvm-ranlib llvm-nm llvm-objcopy llvm-strip wasm-ld llvm-symbolizer; do
  test -f "$PKG/bin/$need" || {
    echo "homescoop: missing LLVM_ROOT tool bin/$need for emcc path spawn" >&2
    exit 1
  }
done
[[ ! -e "$PKG/bin/wasm-opt" && ! -e "$PKG/bin/wasm-opt.wasm" ]] || {
  echo "homescoop: wasm-opt must not ship in wasm-clang (use wasm-binaryen)" >&2
  exit 1
}
[[ -d "$PKG/lib/clang/24/lib/wasm32-unknown-wasip1" && ! -L "$PKG/lib/clang/24/lib/wasm32-unknown-wasip1" ]]
homescoop_assert_no_package_links "$PKG"
du -sh "$PKG" "$PKG/bin/llvm.wasm"
echo "OK wasm-clang $PKG_VER"
