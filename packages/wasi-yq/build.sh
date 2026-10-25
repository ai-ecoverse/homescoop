#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-yq
field () { node "$ROOT/scripts/read-recipe.mjs" wasi-yq --field "$1"; }

COMMIT="$(field source.commit)"
GO_VERSION="$(field toolchain.go)"
REPO="https://github.com/mikefarah/yq"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) go_arch=linux-amd64; host=linux_x64 ;;
  Darwin-arm64) go_arch=darwin-arm64; host=macos_arm64 ;;
  *) echo "homescoop: no wasi-yq toolchain pin for $(uname -sm)" >&2; exit 1 ;;
esac

TAG_COMMIT="$(git ls-remote "$REPO" "refs/tags/v$VERSION^{}" "refs/tags/v$VERSION" | awk 'NR==1 || /\^\{\}$/ { c = $1 } END { print c }')"
if [[ "$TAG_COMMIT" != "$COMMIT" ]]; then
  echo "homescoop: tag v$VERSION of $REPO is '${TAG_COMMIT:-missing}', the recipe pins $COMMIT; update source.url, sha256, commit and tree" >&2
  exit 1
fi

TOOLS="$WORK/wasi-yq-tools"
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
export GOCACHE="$WORK/wasi-yq-gocache" GOMODCACHE="$WORK/wasi-yq-gomodcache"
[[ "$(go env GOVERSION)" == "go$GO_VERSION" ]] || { echo "homescoop: go is $(go env GOVERSION), want go$GO_VERSION" >&2; exit 1; }

SRC_TGZ="$WORK/yq-$COMMIT.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRC_TGZ"
SRC="$WORK/yq-$COMMIT"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$SRC_TGZ" -C "$SRC" --strip-components=1
(cd "$SRC" && GOFLAGS=-mod=mod go mod vendor)
grep -q "Version = \"v$VERSION\"" "$SRC/cmd/version.go" || { echo "homescoop: cmd/version.go is not v$VERSION" >&2; exit 1; }

LDFLAGS="-s -w -buildid="
DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
(cd "$SRC" && GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false -ldflags="$LDFLAGS" -o "$DEST/bin/yq.wasm" .)
chmod 755 "$DEST/bin/yq.wasm"

NATIVE="$WORK/wasi-yq-native/yq"
rm -rf "$(dirname "$NATIVE")"
(cd "$SRC" && env -u GOOS -u GOARCH CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false -ldflags="$LDFLAGS" -o "$NATIVE" .)
"$NATIVE" --version
node "$HOMESCOOP_PKG/test/native-goldens.mjs" "$NATIVE" | tee "$WORK/wasi-yq-goldens.log"
grep -q '^native-goldens: PASS ' "$WORK/wasi-yq-goldens.log" || { echo "homescoop: no native-goldens verdict" >&2; exit 1; }

cp "$SRC/LICENSE" "$DEST/LICENSE"
(cd "$SRC" && GOOS=wasip1 GOARCH=wasm go list -deps -f '{{with .Module}}{{.Path}} {{.Version}}{{end}}' .) \
  | sort -u > "$WORK/wasi-yq-modules.txt"
MODS="$WORK/wasi-yq-modules.txt"
VENDOR="$SRC/vendor"
NOTICED="github.com/a8m/envsubst github.com/agext/levenshtein github.com/alecthomas/participle/v2 github.com/apparentlymart/go-textseg/v17 github.com/dimchansky/utfbom github.com/elliotchance/orderedmap github.com/fatih/color github.com/go-ini/ini github.com/goccy/go-json github.com/goccy/go-yaml github.com/google/go-cmp github.com/hashicorp/hcl/v2 github.com/jinzhu/copier github.com/magiconair/properties github.com/mattn/go-colorable github.com/mattn/go-isatty github.com/mitchellh/go-wordwrap github.com/pelletier/go-toml/v2 github.com/spf13/cobra github.com/spf13/pflag github.com/yuin/gopher-lua github.com/zclconf/go-cty go.yaml.in/yaml/v4 golang.org/x/net golang.org/x/text"
LINKED="$(awk '$1 != "github.com/mikefarah/yq/v4" && $2 != "" { print $1 }' "$MODS" | tr '\n' ' ' | sed 's/ $//')"
if [[ "$LINKED" != "$NOTICED" ]]; then
  echo "homescoop: yq.wasm links '$LINKED', build.sh has notices for '$NOTICED'" >&2
  exit 1
fi
modver () { awk -v p="$1" '$1 == p { print $2 }' "$MODS"; }
homescoop_notices_begin "yq.wasm is yq $VERSION (MIT; see LICENSE). It statically links the Go runtime and these modules."
homescoop_notice "Go $GO_VERSION runtime and standard library (BSD-3-Clause)" "$GOROOT_DIR/LICENSE" - "$GOROOT_DIR/PATENTS" -
homescoop_notice "github.com/a8m/envsubst $(modver github.com/a8m/envsubst) (MIT)" "$VENDOR/github.com/a8m/envsubst/LICENSE" -
homescoop_notice "github.com/agext/levenshtein $(modver github.com/agext/levenshtein) (Apache-2.0)" "$VENDOR/github.com/agext/levenshtein/LICENSE" - "$VENDOR/github.com/agext/levenshtein/NOTICE" -
homescoop_notice "github.com/alecthomas/participle/v2 $(modver github.com/alecthomas/participle/v2) (MIT)" "$VENDOR/github.com/alecthomas/participle/v2/COPYING" -
homescoop_notice "github.com/apparentlymart/go-textseg/v17 $(modver github.com/apparentlymart/go-textseg/v17) (MIT)" "$VENDOR/github.com/apparentlymart/go-textseg/v17/LICENSE" -
homescoop_notice "github.com/dimchansky/utfbom $(modver github.com/dimchansky/utfbom) (Apache-2.0)" "$VENDOR/github.com/dimchansky/utfbom/LICENSE" -
homescoop_notice "github.com/elliotchance/orderedmap $(modver github.com/elliotchance/orderedmap) (MIT)" "$VENDOR/github.com/elliotchance/orderedmap/LICENSE" -
homescoop_notice "github.com/fatih/color $(modver github.com/fatih/color) (MIT)" "$VENDOR/github.com/fatih/color/LICENSE.md" -
homescoop_notice "github.com/go-ini/ini $(modver github.com/go-ini/ini) (Apache-2.0)" "$VENDOR/github.com/go-ini/ini/LICENSE" -
homescoop_notice "github.com/goccy/go-json $(modver github.com/goccy/go-json) (MIT)" "$VENDOR/github.com/goccy/go-json/LICENSE" -
homescoop_notice "github.com/goccy/go-yaml $(modver github.com/goccy/go-yaml) (MIT)" "$VENDOR/github.com/goccy/go-yaml/LICENSE" -
homescoop_notice "github.com/google/go-cmp $(modver github.com/google/go-cmp) (BSD-3-Clause)" "$VENDOR/github.com/google/go-cmp/LICENSE" -
homescoop_notice "github.com/hashicorp/hcl/v2 $(modver github.com/hashicorp/hcl/v2) (MPL-2.0)" "$VENDOR/github.com/hashicorp/hcl/v2/LICENSE" -
homescoop_notice "github.com/jinzhu/copier $(modver github.com/jinzhu/copier) (MIT)" "$VENDOR/github.com/jinzhu/copier/License" -
homescoop_notice "github.com/magiconair/properties $(modver github.com/magiconair/properties) (BSD-2-Clause)" "$VENDOR/github.com/magiconair/properties/LICENSE.md" -
homescoop_notice "github.com/mattn/go-colorable $(modver github.com/mattn/go-colorable) (MIT)" "$VENDOR/github.com/mattn/go-colorable/LICENSE" -
homescoop_notice "github.com/mattn/go-isatty $(modver github.com/mattn/go-isatty) (MIT)" "$VENDOR/github.com/mattn/go-isatty/LICENSE" -
homescoop_notice "github.com/mitchellh/go-wordwrap $(modver github.com/mitchellh/go-wordwrap) (MIT)" "$VENDOR/github.com/mitchellh/go-wordwrap/LICENSE.md" -
homescoop_notice "github.com/pelletier/go-toml/v2 $(modver github.com/pelletier/go-toml/v2) (MIT)" "$VENDOR/github.com/pelletier/go-toml/v2/LICENSE" -
homescoop_notice "github.com/spf13/cobra $(modver github.com/spf13/cobra) (Apache-2.0)" "$VENDOR/github.com/spf13/cobra/LICENSE.txt" -
homescoop_notice "github.com/spf13/pflag $(modver github.com/spf13/pflag) (BSD-3-Clause)" "$VENDOR/github.com/spf13/pflag/LICENSE" -
homescoop_notice "github.com/yuin/gopher-lua $(modver github.com/yuin/gopher-lua) (MIT)" "$VENDOR/github.com/yuin/gopher-lua/LICENSE" -
homescoop_notice "github.com/zclconf/go-cty $(modver github.com/zclconf/go-cty) (MIT)" "$VENDOR/github.com/zclconf/go-cty/LICENSE" -
homescoop_notice "go.yaml.in/yaml/v4 $(modver go.yaml.in/yaml/v4) (Apache-2.0 AND MIT)" "$VENDOR/go.yaml.in/yaml/v4/LICENSE" - "$VENDOR/go.yaml.in/yaml/v4/NOTICE" - \
  "https://raw.githubusercontent.com/yaml/go-yaml/f6f7691b1fdeb513f56608cd2c32c51f8194bf51/LICENSE" d18f6323b71b0b768bb5e9616e36da390fbd39369a81807cca352de4e4e6aa0b
homescoop_notice "golang.org/x/net $(modver golang.org/x/net) (BSD-3-Clause)" "$VENDOR/golang.org/x/net/LICENSE" - "$VENDOR/golang.org/x/net/PATENTS" -
homescoop_notice "golang.org/x/text $(modver golang.org/x/text) (BSD-3-Clause)" "$VENDOR/golang.org/x/text/LICENSE" - "$VENDOR/golang.org/x/text/PATENTS" -

node -e '
  const m = new WebAssembly.Module(require("fs").readFileSync(process.argv[1]));
  const bad = WebAssembly.Module.imports(m).filter((i) => i.module !== "wasi_snapshot_preview1");
  if (bad.length) { console.error("wasi-yq: unexpected imports " + bad.map((i) => i.module + "." + i.name).join(" ")); process.exit(1); }
  if (!WebAssembly.Module.exports(m).some((e) => e.name === "_start")) { console.error("wasi-yq: no _start export"); process.exit(1); }' "$DEST/bin/yq.wasm"
for prefix in "$SRC" "$WORK" "$HOME" "$GOROOT_DIR"; do
  if grep -qaF "$prefix" "$DEST/bin/yq.wasm"; then
    echo "homescoop: host path $prefix leaked into yq.wasm" >&2
    exit 1
  fi
done
ls -l "$DEST/bin/yq.wasm"
shasum -a 256 "$DEST/bin/yq.wasm"
echo "OK wasi-yq $VERSION (yq $COMMIT)"
