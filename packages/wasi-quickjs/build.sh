#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-quickjs
field() { node "$HOMESCOOP_ROOT/scripts/read-recipe.mjs" wasi-quickjs --field "$1"; }

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) sdk_host=linux_x64 ;;
  Darwin-arm64) sdk_host=macos_arm64 ;;
  *) echo "wasi-quickjs: no wasi-sdk pin for $(uname -sm)" >&2; exit 1 ;;
esac
HOMESCOOP_WASI_SDK_VERSION="$(field toolchain.wasi-sdk)"
HOMESCOOP_WASI_SDK_SHA="$(field "toolchain.wasi_sdk_sha256_$sdk_host")"
export HOMESCOOP_WASI_SDK_VERSION HOMESCOOP_WASI_SDK_SHA
eval "$(bash "$ROOT/scripts/install-wasi-sdk.sh" "$WORK/$(bash "$ROOT/scripts/install-wasi-sdk.sh" --name)")"
SDK="$WASI_SDK_PATH"
SDK_MAJOR="${HOMESCOOP_WASI_SDK_VERSION%%.*}"

SRC="$WORK/quickjs-${VERSION}"
BUILD="$WORK/wasi-quickjs-build"
TB="$WORK/quickjs-${VERSION}.tar.gz"

echo "== wasi-quickjs: QuickJS-NG ${VERSION} from the release source"
rm -rf "$SRC" "$BUILD"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
tar xzf "$TB" -C "$WORK"
test -f "$SRC/qjs.c"
QJS_VER="$(sed -En 's/^#define QJS_VERSION_(MAJOR|MINOR|PATCH) ([0-9]+)$/\2/p' "$SRC/quickjs.h" | paste -sd. -)"
[[ "$QJS_VER" == "$VERSION" ]] \
  || { echo "wasi-quickjs: quickjs.h is version ${QJS_VER:-?}, not ${VERSION}" >&2; exit 1; }
homescoop_apply_patches "$SRC"

echo "== wasi-quickjs: cmake (wasi-sdk ${HOMESCOOP_WASI_SDK_VERSION}, $("$SDK/bin/clang" --version | head -1))"
cmake -S "$SRC" -B "$BUILD" -G "Unix Makefiles" \
  -DCMAKE_TOOLCHAIN_FILE="$SDK/share/cmake/wasi-sdk-p1.cmake" \
  -DWASI_SDK_PREFIX="$SDK" \
  -DCMAKE_BUILD_TYPE=Release \
  -DQJS_BUILD_WERROR=ON \
  -DCMAKE_C_FLAGS="-ffile-prefix-map=$SRC=/quickjs -ffile-prefix-map=$BUILD=/build -ffile-prefix-map=$SDK=/wasi-sdk"
cmake --build "$BUILD" --target qjs_exe -j "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
WASM="$WORK/qjs.wasm"
cp "$BUILD/qjs" "$WASM"
"$SDK/bin/llvm-strip" --strip-all "$WASM"

node -e '
  const b = require("fs").readFileSync(process.argv[1]);
  const m = new WebAssembly.Module(b);
  const bad = WebAssembly.Module.imports(m).filter((i) => i.module !== "wasi_snapshot_preview1");
  if (bad.length) { console.error("wasi-quickjs: unexpected imports " + bad.map((i) => i.module + "." + i.name).join(" ")); process.exit(1); }
  const ex = WebAssembly.Module.exports(m);
  if (!ex.some((e) => e.name === "_start" && e.kind === "function")) { console.error("wasi-quickjs: no _start export"); process.exit(1); }
  if (!ex.some((e) => e.name === "memory" && e.kind === "memory")) { console.error("wasi-quickjs: no memory export"); process.exit(1); }
  let i = 8;
  const leb = () => { let r = 0, s = 0, x; do { x = b[i++]; r += (x & 127) * 2 ** s; s += 7; } while (x & 128); return r; };
  let pages = null;
  while (i < b.length) {
    const id = b[i++]; const len = leb(); const end = i + len;
    if (id === 5) { if (leb() !== 1) process.exit(1); const flags = b[i++]; if (flags & 2) { console.error("wasi-quickjs: shared memory"); process.exit(1); } pages = leb(); }
    i = end;
  }
  if (pages === null || pages > 24) { console.error("wasi-quickjs: initial memory " + pages + " pages (at most 24)"); process.exit(1); }
  console.log("wasi-quickjs: initial memory " + pages + " pages (" + (pages * 64) + " KiB), imports only wasi_snapshot_preview1");' "$WASM"
for prefix in "$SRC" "$BUILD" "$WORK" "$SDK" "$HOME" "$ROOT" "/Users/runner" "/home/runner"; do
  if grep -qaF "$prefix" "$WASM"; then
    echo "homescoop: host path $prefix leaked into qjs.wasm" >&2
    exit 1
  fi
done

echo "== wasi-quickjs: stage bin/qjs.wasm"
DEST="$HOMESCOOP_PKG/package/bin"
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$WASM" "$DEST/qjs.wasm"
chmod 755 "$DEST/qjs.wasm"
grep -q 'Copyright (c) 2017-2026 Fabrice Bellard' "$SRC/LICENSE" \
  || { echo "wasi-quickjs: unexpected LICENSE" >&2; exit 1; }
cp "$SRC/LICENSE" "$HOMESCOOP_PKG/package/LICENSE"

UNICODE="$WORK/notices/quickjs-unicode-LICENSE"
mkdir -p "$WORK/notices"
awk '/^UNICODE LICENSE V3$/ { on = 1 } on && /^\*\/$/ { exit } on { print }' "$SRC/libunicode-table.h" >"$UNICODE"
grep -q 'Copyright © 1991-' "$UNICODE" && grep -q 'Permission is hereby granted, free of charge' "$UNICODE" \
  || { echo "wasi-quickjs: no Unicode licence in libunicode-table.h" >&2; exit 1; }

homescoop_notices_begin "qjs.wasm is QuickJS-NG $VERSION (MIT; see LICENSE), with homescoop's three patches (packages/wasi-quickjs/*.patch), built with wasi-sdk ${HOMESCOOP_WASI_SDK_VERSION}. It statically links wasi-libc (with musl and cloudlibc) and compiler-rt's builtins from wasi-sdk, and QuickJS-NG compiles in Unicode data."
homescoop_notice "Unicode data (QuickJS-NG's libunicode-table.h; Unicode-3.0)" "$UNICODE" -
WL="https://raw.githubusercontent.com/WebAssembly/wasi-libc/wasi-sdk-$SDK_MAJOR"
[[ "$SDK_MAJOR" == 34 ]] || { echo "wasi-quickjs: no pinned wasi-libc licence sha256 for wasi-sdk $SDK_MAJOR" >&2; exit 1; }
homescoop_notice "wasi-libc (wasi-sdk-$SDK_MAJOR; Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT)" \
  "$WL/LICENSE" 2711a8b5a5cdfef0e639f96c1aca12ae23d7d64a02d0507f1bdf14d2b27bbc3a \
  "$WL/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WL/LICENSE-APACHE" a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2 \
  "$WL/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5
homescoop_notice "musl libc (wasi-libc's libc-top-half; MIT)" \
  "$WL/libc-top-half/musl/COPYRIGHT" b870108ec5e7790e9f9919064f1b9421d62d5f9b0e6c230c6adf7ea2da62e97b
homescoop_notice "cloudlibc (wasi-libc's libc-bottom-half; BSD-2-Clause)" \
  "$WL/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0
LLVM_COMMIT="$("$SDK/bin/clang" --version | sed -n 's/.*llvm-project \([0-9a-f]\{40\}\)).*/\1/p')"
[[ "$LLVM_COMMIT" == 895aa2c896ada719451be2e3673c83da8ddf1141 ]] \
  || { echo "wasi-quickjs: wasi-sdk's clang is llvm-project ${LLVM_COMMIT:-?}, not the pinned 895aa2c8" >&2; exit 1; }
homescoop_notice "compiler-rt builtins (wasi-sdk-$SDK_MAJOR's libclang_rt.builtins, llvm-project $LLVM_COMMIT; Apache-2.0 WITH LLVM-exception)" \
  "https://raw.githubusercontent.com/llvm/llvm-project/$LLVM_COMMIT/compiler-rt/LICENSE.TXT" 1a8f1058753f1ba890de984e48f0242a3a5c29a6a8f2ed9fd813f36985387e8d
shasum -a 256 "$DEST/qjs.wasm"
echo "OK wasi-quickjs $VERSION (qjs, $(wc -c <"$DEST/qjs.wasm" | tr -d ' ') bytes)"
