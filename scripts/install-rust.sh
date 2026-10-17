#!/usr/bin/env bash
set -euo pipefail
USAGE="usage: install-rust.sh <version> <dest-dir> [target ...]"
VERSION="${1:?$USAGE}"
DEST="${2:?$USAGE}"
shift 2
TARGETS=("$@")

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) HOST=x86_64-unknown-linux-gnu ;;
  Darwin-arm64) HOST=aarch64-apple-darwin ;;
  *) echo "install-rust: unsupported host $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

pin() {
  case "$1" in
    rustc-1.98.1-x86_64-unknown-linux-gnu) echo e974f036b28565f37c0f3bd92ddefa809bee16c04f9dcf07b9ed96e05aaaf7c4 ;;
    cargo-1.98.1-x86_64-unknown-linux-gnu) echo ea1de9f9e23107d97ee2b41a72c552f34064a593da503789218387aee59f3ba4 ;;
    rust-std-1.98.1-x86_64-unknown-linux-gnu) echo fa3ff450172a16c026944030230c5069947af93c728d9179971d44e5e0cfb561 ;;
    rustc-1.98.1-aarch64-apple-darwin) echo 738e3f60114b20550fcf4f8a57c9cea0544239f214709f45594ff3fde327f577 ;;
    cargo-1.98.1-aarch64-apple-darwin) echo de51d4fade4f31ad8ec405261cc96bedc000d905f98980027610d6e288dbe21b ;;
    rust-std-1.98.1-aarch64-apple-darwin) echo 2de831ef563ce772519a4d18ba2659f0f7428d497ef66dad24b5a35e8f8cd177 ;;
    rust-std-1.98.1-wasm32-wasip1) echo b5e91be9ed75c632a4c576d3c4c725ab143cd48c27c345133b97ccdf217b23e7 ;;
    rust-std-1.98.1-wasm32-wasip1-threads) echo d4bbde929a1a0bc2c36049222c2ed8ea2e3e52b3a73392e597bca1818c8ab3d5 ;;
    *) return 1 ;;
  esac
}

COMPONENTS=("rustc-$VERSION-$HOST" "cargo-$VERSION-$HOST" "rust-std-$VERSION-$HOST")
for t in ${TARGETS[@]+"${TARGETS[@]}"}; do
  COMPONENTS+=("rust-std-$VERSION-$t")
done
WANT=""
for c in "${COMPONENTS[@]}"; do
  sha="$(pin "$c")" || { echo "install-rust: no sha256 pin for $c.tar.xz in scripts/install-rust.sh" >&2; exit 1; }
  WANT+="$c $sha"$'\n'
done

STAMP="$DEST/.homescoop-rust"
if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$WANT" && -x "$DEST/bin/rustc" && -x "$DEST/bin/cargo" ]]; then
  echo "== install-rust: $DEST already has Rust $VERSION ($HOST ${TARGETS[*]-})" >&2
else
  mkdir -p "$(dirname "$DEST")"
  TMP="$(mktemp -d "$(dirname "$DEST")/.rust.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  rm -rf "$DEST"
  for c in "${COMPONENTS[@]}"; do
    sha="$(pin "$c")"
    url="https://static.rust-lang.org/dist/$c.tar.xz"
    echo "== install-rust: fetch $url" >&2
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$url" -o "$TMP/$c.tar.xz"
    echo "$sha  $TMP/$c.tar.xz" | shasum -a 256 -c - >&2
    tar -xJf "$TMP/$c.tar.xz" -C "$TMP"
    while read -r comp; do
      [[ -n "$comp" ]] || continue
      mkdir -p "$DEST"
      cp -R "$TMP/$c/$comp/." "$DEST/"
      rm -f "$DEST/manifest.in"
    done < "$TMP/$c/components"
    rm -rf "$TMP/$c" "$TMP/$c.tar.xz"
  done
  for lib in "$DEST"/lib/libLLVM*; do
    [[ -e "$lib" ]] || continue
    mkdir -p "$DEST/lib/rustlib/$HOST/lib"
    [[ -e "$DEST/lib/rustlib/$HOST/lib/$(basename "$lib")" ]] || ln -s "../../../$(basename "$lib")" "$DEST/lib/rustlib/$HOST/lib/$(basename "$lib")"
  done
  printf '%s' "$WANT" > "$STAMP"
  echo "== install-rust: installed Rust $VERSION ($HOST ${TARGETS[*]-}) → $DEST" >&2
fi
"$DEST/bin/rustc" --version >&2
printf 'export PATH=%q:"$PATH"\nexport RUSTC=%q\n' "$DEST/bin" "$DEST/bin/rustc"
