#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-html-to-markdown
field () { node "$ROOT/scripts/read-recipe.mjs" wasi-html-to-markdown --field "$1"; }

COMMIT="$(field source.commit)"
GO_VERSION="$(field toolchain.go)"
BUILD_DATE="$(field build.date)"
REPO="https://github.com/JohannesKaufmann/html-to-markdown"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) go_arch=linux-amd64; host=linux_x64 ;;
  Darwin-arm64) go_arch=darwin-arm64; host=macos_arm64 ;;
  *) echo "homescoop: no wasi-html-to-markdown toolchain pin for $(uname -sm)" >&2; exit 1 ;;
esac

TAG_COMMIT="$(git ls-remote "$REPO" "refs/tags/v$VERSION^{}" "refs/tags/v$VERSION" | awk 'NR==1 || /\^\{\}$/ { c = $1 } END { print c }')"
if [[ "$TAG_COMMIT" != "$COMMIT" ]]; then
  echo "homescoop: tag v$VERSION of $REPO is '${TAG_COMMIT:-missing}', the recipe pins $COMMIT; update source.url, sha256, commit and tree" >&2
  exit 1
fi

TOOLS="$WORK/wasi-html-to-markdown-tools"
mkdir -p "$TOOLS"
GO_TGZ="$TOOLS/go$GO_VERSION.$go_arch.tar.gz"
homescoop_fetch "https://go.dev/dl/go$GO_VERSION.$go_arch.tar.gz" "$(field "toolchain.go_sha256_$host")" "$GO_TGZ"
GOROOT_DIR="$TOOLS/go$GO_VERSION.$go_arch"
if [[ ! -x "$GOROOT_DIR/bin/go" ]]; then
  rm -rf "$GOROOT_DIR"
  mkdir -p "$GOROOT_DIR"
  tar -xzf "$GO_TGZ" -C "$GOROOT_DIR" --strip-components=1
fi
export PATH="$GOROOT_DIR/bin:$PATH"
export GOTOOLCHAIN=local GOFLAGS=-mod=vendor
export GOCACHE="$WORK/wasi-html-to-markdown-gocache" GOMODCACHE="$WORK/wasi-html-to-markdown-gomodcache"
[[ "$(go env GOVERSION)" == "go$GO_VERSION" ]] || { echo "homescoop: go is $(go env GOVERSION), want go$GO_VERSION" >&2; exit 1; }

SRC_TGZ="$WORK/html-to-markdown-$COMMIT.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRC_TGZ"
SRC="$WORK/html-to-markdown-$COMMIT"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$SRC_TGZ" -C "$SRC" --strip-components=1
(cd "$SRC" && GOFLAGS=-mod=mod go mod vendor)
homescoop_apply_patches "$SRC"

LDFLAGS="-s -w -buildid= -X main.version=$VERSION -X main.commit=$COMMIT -X main.date=$BUILD_DATE"
DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
(cd "$SRC" && GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false -ldflags="$LDFLAGS" -o "$DEST/bin/html2markdown.wasm" ./cli/html2markdown)
chmod 755 "$DEST/bin/html2markdown.wasm"

NATIVE="$WORK/wasi-html-to-markdown-native/html2markdown"
rm -rf "$(dirname "$NATIVE")"
(cd "$SRC" && env -u GOOS -u GOARCH CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false -ldflags="$LDFLAGS" -o "$NATIVE" ./cli/html2markdown)
"$NATIVE" --version
node "$HOMESCOOP_PKG/test/native-goldens.mjs" "$NATIVE" | tee "$WORK/wasi-html-to-markdown-goldens.log"
grep -q '^native-goldens: PASS ' "$WORK/wasi-html-to-markdown-goldens.log" || { echo "homescoop: no native-goldens verdict" >&2; exit 1; }

cp "$SRC/LICENSE" "$DEST/LICENSE"
(cd "$SRC" && GOOS=wasip1 GOARCH=wasm go list -deps -f '{{with .Module}}{{.Path}} {{.Version}}{{end}}' ./cli/html2markdown) \
  | sort -u > "$WORK/wasi-html-to-markdown-modules.txt"
MODS="$WORK/wasi-html-to-markdown-modules.txt"
VENDOR="$SRC/vendor"
NOTICED="github.com/JohannesKaufmann/dom github.com/agnivade/levenshtein github.com/andybalholm/cascadia github.com/aymanbagabas/go-osc52/v2 github.com/bmatcuk/doublestar/v4 github.com/lucasb-eyer/go-colorful github.com/mattn/go-isatty github.com/muesli/termenv github.com/rivo/uniseg golang.org/x/net"
LINKED="$(awk '$1 != "github.com/JohannesKaufmann/html-to-markdown/v2" && $2 != "" { print $1 }' "$MODS" | tr '\n' ' ' | sed 's/ $//')"
if [[ "$LINKED" != "$NOTICED" ]]; then
  echo "homescoop: html2markdown.wasm links '$LINKED', build.sh has notices for '$NOTICED'" >&2
  exit 1
fi
modver () { awk -v p="$1" '$1 == p { print $2 }' "$MODS"; }
homescoop_notices_begin "html2markdown.wasm is html-to-markdown $VERSION (MIT; see LICENSE). It statically links the Go runtime and these modules."
homescoop_notice "Go $GO_VERSION runtime and standard library (BSD-3-Clause)" "$GOROOT_DIR/LICENSE" - "$GOROOT_DIR/PATENTS" -
homescoop_notice "github.com/JohannesKaufmann/dom $(modver github.com/JohannesKaufmann/dom) (MIT)" "$VENDOR/github.com/JohannesKaufmann/dom/LICENSE" -
homescoop_notice "github.com/agnivade/levenshtein $(modver github.com/agnivade/levenshtein) (MIT)" "$VENDOR/github.com/agnivade/levenshtein/License.txt" -
homescoop_notice "github.com/andybalholm/cascadia $(modver github.com/andybalholm/cascadia) (BSD-2-Clause)" "$VENDOR/github.com/andybalholm/cascadia/LICENSE" -
homescoop_notice "github.com/aymanbagabas/go-osc52/v2 $(modver github.com/aymanbagabas/go-osc52/v2) (MIT)" "$VENDOR/github.com/aymanbagabas/go-osc52/v2/LICENSE" -
homescoop_notice "github.com/bmatcuk/doublestar/v4 $(modver github.com/bmatcuk/doublestar/v4) (MIT)" "$VENDOR/github.com/bmatcuk/doublestar/v4/LICENSE" -
homescoop_notice "github.com/lucasb-eyer/go-colorful $(modver github.com/lucasb-eyer/go-colorful) (MIT)" "$VENDOR/github.com/lucasb-eyer/go-colorful/LICENSE" -
homescoop_notice "github.com/mattn/go-isatty $(modver github.com/mattn/go-isatty) (MIT)" "$VENDOR/github.com/mattn/go-isatty/LICENSE" -
homescoop_notice "github.com/muesli/termenv $(modver github.com/muesli/termenv) (MIT)" "$VENDOR/github.com/muesli/termenv/LICENSE" -
homescoop_notice "github.com/rivo/uniseg $(modver github.com/rivo/uniseg) (MIT)" "$VENDOR/github.com/rivo/uniseg/LICENSE.txt" -
homescoop_notice "golang.org/x/net $(modver golang.org/x/net) (BSD-3-Clause)" "$VENDOR/golang.org/x/net/LICENSE" - "$VENDOR/golang.org/x/net/PATENTS" -

node -e '
  const m = new WebAssembly.Module(require("fs").readFileSync(process.argv[1]));
  const bad = WebAssembly.Module.imports(m).filter((i) => i.module !== "wasi_snapshot_preview1");
  if (bad.length) { console.error("wasi-html-to-markdown: unexpected imports " + bad.map((i) => i.module + "." + i.name).join(" ")); process.exit(1); }
  if (!WebAssembly.Module.exports(m).some((e) => e.name === "_start")) { console.error("wasi-html-to-markdown: no _start export"); process.exit(1); }' "$DEST/bin/html2markdown.wasm"
for prefix in "$SRC" "$WORK" "$HOME" "$GOROOT_DIR"; do
  if grep -qaF "$prefix" "$DEST/bin/html2markdown.wasm"; then
    echo "homescoop: host path $prefix leaked into html2markdown.wasm" >&2
    exit 1
  fi
done
shasum -a 256 "$DEST/bin/html2markdown.wasm"
echo "OK wasi-html-to-markdown $VERSION (html-to-markdown $COMMIT)"
