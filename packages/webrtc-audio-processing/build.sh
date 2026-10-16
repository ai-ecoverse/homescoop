#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${HOMESCOOP_ROOT:-$(cd "$HERE/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe webrtc-audio-processing

JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
OUT="$HERE/package/dist"
WASM="$OUT/webrtc-audio-processing.wasm"
BUILD="$WORK/webrtc-audio-processing-$VERSION-build"
OBJ="$WORK/webrtc-audio-processing-$VERSION-wap.o"
CACHE="$SRC_DIR/subprojects/packagecache"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR" "$BUILD"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
homescoop_apply_patches "$SRC_DIR"

WRAP="$SRC_DIR/subprojects/abseil-cpp.wrap"
wrap_field() { sed -n "s/^$1 = //p" "$WRAP"; }
homescoop_load_recipe webrtc-audio-processing --source abseil
ABSEIL_FILE="$(wrap_field source_filename)"
if [[ "$(wrap_field source_hash)" != "$ABSEIL_SRC_SHA" || "$ABSEIL_FILE" != "$(basename "$ABSEIL_SRC_URL")" ]]; then
  echo "build.sh: $WRAP names $ABSEIL_FILE $(wrap_field source_hash), not the recipe's abseil $(basename "$ABSEIL_SRC_URL") $ABSEIL_SRC_SHA" >&2
  exit 1
fi
homescoop_load_recipe webrtc-audio-processing --source abseil-wrap
ABSEIL_PATCH="$(wrap_field patch_filename)"
if [[ "$(wrap_field patch_hash)" != "$ABSEIL_WRAP_SRC_SHA" || "$ABSEIL_PATCH" != "$(basename "$ABSEIL_WRAP_SRC_URL")" ]]; then
  echo "build.sh: $WRAP names the meson patch $ABSEIL_PATCH $(wrap_field patch_hash), not the recipe's abseil-wrap $ABSEIL_WRAP_SRC_SHA" >&2
  exit 1
fi
mkdir -p "$CACHE" "$OUT"
homescoop_fetch "$ABSEIL_SRC_URL" "$ABSEIL_SRC_SHA" "$CACHE/$ABSEIL_FILE"
homescoop_fetch "$ABSEIL_WRAP_SRC_URL" "$ABSEIL_WRAP_SRC_SHA" "$CACHE/$ABSEIL_PATCH"

homescoop_load_recipe webrtc-audio-processing --source meson
MESON_TB="$WORK/$(basename "$MESON_SRC_URL")"
MESON_DIR="$WORK/$(basename "$MESON_SRC_URL" .tar.gz)"
homescoop_fetch "$MESON_SRC_URL" "$MESON_SRC_SHA" "$MESON_TB"
homescoop_extract "$MESON_TB" "$MESON_DIR"
MESON=(python3 "$MESON_DIR/meson.py")
if ! command -v ninja >/dev/null 2>&1; then
  python3 -m venv "$WORK/ninja-venv"
  "$WORK/ninja-venv/bin/pip" install --quiet "ninja==1.13.0"
  export PATH="$WORK/ninja-venv/bin:$PATH"
fi
homescoop_load_recipe webrtc-audio-processing

DEFS=(-DWEBRTC_POSIX -DWEBRTC_LIBRARY_IMPL -DNDEBUG)
CROSS="$WORK/webrtc-audio-processing-emscripten.ini"
cat >"$CROSS" <<EOF
[binaries]
c = '$(command -v emcc)'
cpp = '$(command -v em++)'
ar = '$(command -v emar)'
ranlib = '$(command -v emranlib)'
strip = '$(command -v emstrip)'

[built-in options]
c_args = ['-DWEBRTC_POSIX']
cpp_args = ['-DWEBRTC_POSIX']

[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'
EOF

if [[ ! -f "$BUILD/build.ninja" ]]; then
  echo "== webrtc-audio-processing $VERSION: meson $MESON_DIR (emscripten cross)"
  (cd "$WORK" && "${MESON[@]}" setup "$(basename "$BUILD")" "$(basename "$SRC_DIR")" \
    --cross-file "$CROSS" --buildtype release -Db_ndebug=true \
    --default-library static --wrap-mode nodownload)
fi
LIBS=()
while IFS= read -r lib; do LIBS+=("$lib"); done < <(ninja -C "$BUILD" -t targets all | sed -n 's/^\([^:]*\.a\): .*/\1/p' | grep -v '\.p/' | sort)
ninja -C "$BUILD" -j"$JOBS" "${LIBS[@]}"
APM_LIB="webrtc/modules/audio_processing/libwebrtc-audio-processing-2.a"
test -f "$BUILD/$APM_LIB"
LINK=("$BUILD/$APM_LIB")
for lib in "${LIBS[@]}"; do
  [[ "$lib" == subprojects/abseil-cpp-*/libabsl_*.a ]] && LINK+=("$BUILD/$lib")
done

ABSEIL_DIR="$(wrap_field directory)"
test -f "$SRC_DIR/subprojects/$ABSEIL_DIR/LICENSE"
MAP=(-ffile-prefix-map="$SRC_DIR"=webrtc-audio-processing-"$VERSION" -ffile-prefix-map="$HERE"=packages/webrtc-audio-processing)
echo "== webrtc-audio-processing $VERSION: wap.cc → $WASM"
em++ -std=c++17 -O3 -fno-exceptions "${DEFS[@]}" "${MAP[@]}" \
  -I "$SRC_DIR/webrtc" -I "$SRC_DIR" -I "$SRC_DIR/subprojects/$ABSEIL_DIR" \
  -c "$HERE/src/wap.cc" -o "$OBJ"
em++ -O3 "$OBJ" "${LINK[@]}" -sSTANDALONE_WASM --no-entry \
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=262144 -o "$WASM"
rm -f "$OUT/webrtc-audio-processing.js"
chmod 644 "$WASM"

node -e '
const fs = require("fs");
const m = new WebAssembly.Module(fs.readFileSync(process.argv[1]));
const want = ["env.emscripten_notify_memory_growth", "wasi_snapshot_preview1.clock_time_get", "wasi_snapshot_preview1.fd_close", "wasi_snapshot_preview1.fd_seek", "wasi_snapshot_preview1.fd_write"];
const got = WebAssembly.Module.imports(m).map((i) => i.module + "." + i.name).sort();
const extra = got.filter((n) => !want.includes(n));
if (extra.length) { console.error("build.sh: the wasm imports " + extra.join(", ") + ", which index.js does not provide"); process.exit(1); }
const exps = WebAssembly.Module.exports(m).map((e) => e.name);
const need = ["memory", "_initialize", "wap_create", "wap_frame", "wap_mic", "wap_ref", "wap_out", "wap_process", "wap_voice", "wap_stats", "wap_destroy", "wap_alloc", "wap_free"];
const missing = need.filter((n) => !exps.includes(n));
if (missing.length) { console.error("build.sh: the wasm does not export " + missing.join(", ")); process.exit(1); }
const size = fs.statSync(process.argv[1]).size;
console.log("== webrtc-audio-processing: wasm " + size + " bytes, imports " + got.join(" "));
if (size > 2 * 1024 * 1024) console.log("::warning::webrtc-audio-processing.wasm is " + size + " bytes, over 2 MiB");
' "$WASM"

homescoop_stage_licenses "$SRC_DIR/COPYING" "$SRC_DIR/subprojects/$ABSEIL_DIR/LICENSE"
homescoop_notices_begin "dist/webrtc-audio-processing.wasm statically links the following. The JS wrapper (index.js, node.js) and src/wap.cc are homescoop's, Apache-2.0."
homescoop_notice "webrtc-audio-processing $VERSION (BSD-3-Clause, with WebRTC's patent grant)" \
  "$SRC_DIR/COPYING" - \
  "$SRC_DIR/webrtc/LICENSE" - \
  "$SRC_DIR/webrtc/PATENTS" -
homescoop_notice "$ABSEIL_DIR (Apache-2.0)" \
  "$SRC_DIR/subprojects/$ABSEIL_DIR/LICENSE" -
homescoop_notice "rnnoise (webrtc/third_party/rnnoise, BSD-3-Clause)" \
  "$SRC_DIR/webrtc/third_party/rnnoise/COPYING" -
homescoop_notice "pffft (webrtc/third_party/pffft, FFTPACK licence)" \
  "$SRC_DIR/webrtc/third_party/pffft/LICENSE" -
homescoop_notice "Ooura FFT (webrtc/common_audio/third_party/ooura)" \
  "$SRC_DIR/webrtc/common_audio/third_party/ooura/LICENSE" -
homescoop_notice "spl_sqrt_floor (webrtc/common_audio/third_party/spl_sqrt_floor, public domain)" \
  "$SRC_DIR/webrtc/common_audio/third_party/spl_sqrt_floor/LICENSE" -
homescoop_notice "fft (webrtc/modules/third_party/fft)" \
  "$SRC_DIR/webrtc/modules/third_party/fft/LICENSE" -
homescoop_notice_emscripten
ls -la "$OUT"
