#!/usr/bin/env bash
# Compare wasm GNU libiconv against host iconv(1) byte-for-byte.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${HOMESCOOP_OUT:-$ROOT/.homescoop-out}"
PREFIX="${PREFIX:-$OUT/prefix}"
WORKDIR="${HOMESCOOP_SMOKE_DIR:-$OUT/smoke}"
TGZ="${1:-${OUT}/package.tgz}"

mkdir -p "$PREFIX/lib" "$PREFIX/include" "$WORKDIR"
if [[ -f "$TGZ" ]]; then
  tmp="$(mktemp -d)"
  tar xzf "$TGZ" -C "$tmp"
  if [[ -d "$tmp/package/lib" ]]; then cp -R "$tmp/package/lib/." "$PREFIX/lib/"; fi
  if [[ -d "$tmp/package/include" ]]; then cp -R "$tmp/package/include/." "$PREFIX/include/"; fi
  rm -rf "$tmp"
fi
test -f "$PREFIX/lib/libiconv.a"

if ! command -v emcc >/dev/null 2>&1; then
  if [[ -d "$ROOT/node_modules/emsdk" ]]; then
    eval "$(node -e 'const e=require("emsdk"); const env=e.env(); for (const [k,v] of Object.entries(env)) console.log(`export ${k}=${JSON.stringify(String(v))}`)')"
  else
    (cd "$ROOT" && npm install --no-save --no-package-lock emsdk@0.4.0)
    eval "$(node -e 'const e=require("emsdk"); const env=e.env(); for (const [k,v] of Object.entries(env)) console.log(`export ${k}=${JSON.stringify(String(v))}`)')"
  fi
fi

echo "== libiconv compare: emcc smoke.c"
emcc -O0 "$ROOT/packages/libiconv/smoke.c" \
  -I"$PREFIX/include" -L"$PREFIX/lib" -liconv \
  -sNODERAWFS=1 -o "$WORKDIR/smoke.cjs"
node "$WORKDIR/smoke.cjs" "$WORKDIR"

utf8_cafe=$'caf\xc3\xa9'
utf8_jp=$'\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e'
utf8_hello='Hello'

enc_in() {
  case "$1" in
    SHIFT_JIS|EUC-JP) printf '%s' "$utf8_jp" ;;
    WINDOWS-1252|ISO-8859-1) printf '%s' "$utf8_cafe" ;;
    UTF-16|UTF-32) printf '%s' "$utf8_hello" ;;
  esac
}

echo "== libiconv compare: host $(command -v iconv)"
fails=0
for enc in SHIFT_JIS EUC-JP WINDOWS-1252 ISO-8859-1 UTF-16 UTF-32; do
  host_fwd="$WORKDIR/host-utf8-to-${enc}.bin"
  host_back="$WORKDIR/host-${enc}-to-utf8.bin"
  enc_in "$enc" | iconv -f UTF-8 -t "$enc" > "$host_fwd"
  iconv -f "$enc" -t UTF-8 < "$host_fwd" > "$host_back"
  wasm_fwd="$WORKDIR/wasm-utf8-to-${enc}.bin"
  wasm_back="$WORKDIR/wasm-${enc}-to-utf8.bin"
  echo "-- $enc"
  echo -n "   utf8->$enc wasm "; xxd -p -c 64 "$wasm_fwd"
  echo -n "   utf8->$enc host "; xxd -p -c 64 "$host_fwd"
  echo -n "   $enc->utf8 wasm "; xxd -p -c 64 "$wasm_back"
  echo -n "   $enc->utf8 host "; xxd -p -c 64 "$host_back"
  if ! cmp -s "$wasm_fwd" "$host_fwd"; then
    echo "   FAIL utf8->$enc"
    fails=$((fails + 1))
  else
    echo "   ok utf8->$enc"
  fi
  if ! cmp -s "$wasm_back" "$host_back"; then
    echo "   FAIL $enc->utf8"
    fails=$((fails + 1))
  else
    echo "   ok $enc->utf8"
  fi
done
if [[ "$fails" -ne 0 ]]; then
  echo "libiconv compare: $fails mismatch(es) vs host iconv"
  exit 1
fi
echo "libiconv compare: all encodings match host iconv byte-for-byte"
