#!/usr/bin/env bash
# Relink Binaryen 132 CLI tools against current libslicc and stage
# @ai-ecoverse/wasm-binaryen. Reuses .o/.a from slicc-emscripten/build/binaryen-wasm.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/wasm-binaryen"
VERSION="132"
PKG_VER="132.0.0-1"
PKG="$HOMESCOOP_PKG/package"
WORK="${HOMESCOOP_WORK:-${TMPDIR:-/tmp}/homescoop-work}/wasm-binaryen-relink"
mkdir -p "$WORK"
SLICC_EM="${SLICC_EMSCRIPTEN:-$ROOT/../slicc-emscripten}"
BINARYEN="${BINARYEN_WASM:-$SLICC_EM/build/binaryen-wasm}"
POST_JS="$SLICC_EM/slicc-node-main.js"

if [[ -x "$SLICC_EM/src/emscripten/em++" ]]; then
  export EM_CONFIG="${SLICC_EM}/emscripten-config"
  export EM_CACHE="${SLICC_EM}/cache"
  export EMSDK_PYTHON="${EMSDK_PYTHON:-/opt/homebrew/bin/python3.13}"
  EMXX="$SLICC_EM/src/emscripten/em++"
  EMCC="$SLICC_EM/src/emscripten/emcc"
  EMAR="$SLICC_EM/src/emscripten/emar"
else
  EMXX="$(command -v em++)"
  EMCC="$(command -v emcc)"
  EMAR="$(command -v emar)"
fi

for need in "$BINARYEN/lib/libbinaryen.a" "$POST_JS" \
  "$BINARYEN/src/tools/CMakeFiles/wasm-opt.dir/wasm-opt.cpp.o"
do
  test -f "$need" || { echo "homescoop: missing $need" >&2; exit 1; }
done

echo "== wasm-binaryen: libslicc spawn archive"
SLICC_A="$WORK/libslicc-binaryen.a"
ODIR="$WORK/slicc-objs"
rm -rf "$ODIR"
mkdir -p "$ODIR"
objs=()
for src in slicc_spawn slicc_exec slicc_libc_gaps slicc_signals; do
  echo "== slicc shim: $EMCC -c ${src}.c"
  "$EMCC" -O2 -c "$ROOT/shims/slicc/${src}.c" -o "$ODIR/${src}.o"
  objs+=("$ODIR/${src}.o")
done
KEEP_O="$ODIR/keep-slicc-spawn.o"
"$EMCC" -O2 -c "$HOMESCOOP_PKG/keep-slicc-spawn.c" -o "$KEEP_O"
objs+=("$KEEP_O")
rm -f "$SLICC_A"
"$EMAR" rcs "$SLICC_A" "${objs[@]}"
strings "$ODIR/slicc_spawn.o" | grep -q sliccKernel || {
  echo "homescoop: slicc_spawn.o missing sliccKernel string" >&2
  exit 1
}

# Classic Module glue (no EXPORT_ES6) + realm ENVIRONMENT + sliccKernel spawn.
# -lnodefs.js: host PRESTAGE via run-wasm-cli; slicc mounts its own VFS instead.
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=8388608 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -sDISABLE_EXCEPTION_CATCHING=0 -sEXPORTED_FUNCTIONS=_main,_homescoop_keep_slicc_spawn -lnodefs.js --extern-post-js=${POST_JS}"

relink_one() {
  local name=$1
  shift
  local -a tool_objs=("$@")
  local out_dir="$WORK/relink"
  mkdir -p "$out_dir"
  if [[ -f "$out_dir/$name" && -f "$out_dir/$name.wasm" ]]; then
    local existing
    existing=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().count("sliccKernel"))' "$out_dir/$name")
    if [[ "$existing" -gt 0 ]]; then
      echo "== relink $name: skip (already has $existing sliccKernel refs)"
      return 0
    fi
    echo "== relink $name: re-link (prior glue had 0 sliccKernel)"
  else
    echo "== relink $name"
  fi
  for o in "${tool_objs[@]}"; do
    test -f "$o" || { echo "homescoop: missing $o" >&2; exit 1; }
  done
  # shellcheck disable=SC2046,SC2086
  "$EMXX" -O3 -fexceptions -fno-rtti \
    "${tool_objs[@]}" \
    "$BINARYEN/lib/libbinaryen.a" \
    -Wl,--whole-archive "$SLICC_A" -Wl,--no-whole-archive \
    -Wl,-u,homescoop_keep_slicc_spawn \
    $(homescoop_em_cli_ldflags) \
    -o "$out_dir/$name.js"
  mv "$out_dir/$name.js" "$out_dir/$name"
  local n
  n=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().count("sliccKernel"))' "$out_dir/$name")
  echo "  $name sliccKernel refs: $n"
  [[ "$n" -gt 0 ]] || { echo "homescoop: $name glue has 0 sliccKernel" >&2; exit 1; }
}

B="$BINARYEN/src/tools/CMakeFiles"
S="$BINARYEN/src/tools/wasm-split/CMakeFiles"

relink_one wasm-opt \
  "$B/wasm-opt.dir/wasm-opt.cpp.o" \
  "$B/wasm-opt.dir/fuzzing/fuzzing.cpp.o" \
  "$B/wasm-opt.dir/fuzzing/heap-types.cpp.o" \
  "$B/wasm-opt.dir/fuzzing/random.cpp.o" \
  "$B/wasm-opt.dir/fuzzing/parameters.cpp.o"

relink_one wasm-metadce "$B/wasm-metadce.dir/wasm-metadce.cpp.o"
relink_one wasm-emscripten-finalize "$B/wasm-emscripten-finalize.dir/wasm-emscripten-finalize.cpp.o"
relink_one wasm-ctor-eval "$B/wasm-ctor-eval.dir/wasm-ctor-eval.cpp.o"
relink_one wasm2js "$B/wasm2js.dir/wasm2js.cpp.o"
relink_one wasm-as "$B/wasm-as.dir/wasm-as.cpp.o"
relink_one wasm-dis "$B/wasm-dis.dir/wasm-dis.cpp.o"
relink_one wasm-split \
  "$S/wasm-split.dir/wasm-split.cpp.o" \
  "$S/wasm-split.dir/split-options.cpp.o" \
  "$S/wasm-split.dir/instrumenter.cpp.o"

echo "== wasm-binaryen: stage package $PKG_VER"
rm -rf "$PKG/bin"
mkdir -p "$PKG/bin"

TOOLS=(wasm-opt wasm-metadce wasm-emscripten-finalize wasm-ctor-eval wasm-split wasm2js wasm-as wasm-dis)
for name in "${TOOLS[@]}"; do
  cp "$WORK/relink/$name" "$PKG/bin/$name"
  cp "$WORK/relink/$name.wasm" "$PKG/bin/$name.wasm"
  chmod +x "$PKG/bin/$name" "$PKG/bin/$name.wasm"
done

cp "$SLICC_EM/src/binaryen/LICENSE" "$PKG/LICENSE"

cat > "$PKG/README.md" <<'EOF'
# @ai-ecoverse/wasm-binaryen

Binaryen **132** CLI tools for the slicc wasm realm. Relinked with current
libslicc (`Module.sliccKernel` spawn) + `ENVIRONMENT=web,worker,node`.

Ships the Emscripten-facing tool set:

`wasm-opt`, `wasm-metadce`, `wasm-emscripten-finalize`, `wasm-ctor-eval`,
`wasm-split`, `wasm2js`, `wasm-as`, `wasm-dis`.

Used by `@ai-ecoverse/wasm-emscripten` (as `BINARYEN_ROOT`) and by
`@ai-ecoverse/wasm-clang` drivers for fork Asyncify (`wasm-opt --asyncify`).
EOF

node - "$PKG" "$PKG_VER" <<'JS'
const fs = require("fs");
const path = require("path");
const pkgDir = process.argv[2];
const ver = process.argv[3];
const tools = [
  "wasm-opt",
  "wasm-metadce",
  "wasm-emscripten-finalize",
  "wasm-ctor-eval",
  "wasm-split",
  "wasm2js",
  "wasm-as",
  "wasm-dis",
];
const commands = {};
for (const t of tools) {
  commands[t] = { glue: `bin/${t}`, wasm: `bin/${t}.wasm`, argv0: t };
}
const j = {
  name: "@ai-ecoverse/wasm-binaryen",
  version: ver,
  description: "Binaryen 132 wasm tools for slicc (wasm-opt and friends)",
  license: "Apache-2.0",
  repository: {
    type: "git",
    url: "git+https://github.com/ai-ecoverse/homescoop.git",
    directory: "packages/wasm-binaryen/package",
  },
  homepage: "https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasm-binaryen",
  keywords: ["wasm", "binaryen", "slicc", "homescoop", "wasm-opt", "emscripten"],
  files: ["README.md", "LICENSE", "bin"],
  publishConfig: { access: "public" },
  homescoop: { recipe: "wasm-binaryen", upstream: "132" },
  slicc: { abi: "emscripten", commands },
};
fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(j, null, 2) + "\n");
JS

echo "== wasm-binaryen: sizes"
du -sh "$PKG" "$PKG/bin"/wasm-opt.wasm

echo "== wasm-binaryen: PRESTAGE pack (no links)"
STAGE="$HOMESCOOP_PKG"
TGZ=$(homescoop_npm_pack_no_links "$PKG" "$STAGE")
echo "STAGED: $TGZ"
ls -lh "$TGZ"
