#!/usr/bin/env bash
# gh for slicc WASI: build gh.wasm from gh's source with GOOS=wasip1,
# the pinned Go toolchain and the patch in patches/.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-gh
field () { node "$ROOT/scripts/read-recipe.mjs" wasi-gh --field "$1"; }

COMMIT="$(field source.commit)"
GO_VERSION="$(field toolchain.go)"
GH_VERSION="$(field build.version)"
GH_DATE="$(field build.date)"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) go_arch=linux-amd64; host=linux_x64 ;;
  Darwin-arm64) go_arch=darwin-arm64; host=macos_arm64 ;;
  *) echo "homescoop: no wasi-gh toolchain pin for $(uname -sm)" >&2; exit 1 ;;
esac

TOOLS="$WORK/wasi-gh-tools"
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
export GOCACHE="$WORK/wasi-gh-gocache" GOMODCACHE="$WORK/wasi-gh-gomodcache"
[[ "$(go env GOVERSION)" == "go$GO_VERSION" ]] || { echo "homescoop: go is $(go env GOVERSION), want go$GO_VERSION" >&2; exit 1; }

SRC_TGZ="$WORK/gh-$COMMIT.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRC_TGZ"
SRC="$WORK/gh-$COMMIT"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$SRC_TGZ" -C "$SRC" --strip-components=1
(cd "$SRC" && GOFLAGS=-mod=mod go mod vendor)
for p in "$HOMESCOOP_PKG"/patches/*.patch; do
  echo "== patch $(basename "$p")"
  patch -p1 -d "$SRC" < "$p"
done

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
(cd "$SRC" && GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false \
    -ldflags="-s -w -buildid= -X github.com/cli/cli/v2/internal/build.Version=${GH_VERSION} -X github.com/cli/cli/v2/internal/build.Date=${GH_DATE}" \
    -o "$DEST/bin/gh.wasm" ./cmd/gh)
chmod 755 "$DEST/bin/gh.wasm"

cp "$SRC/LICENSE" "$DEST/LICENSE"
node - "$SRC" "$GOROOT_DIR" "$DEST/THIRD-PARTY-NOTICES.md" "$VERSION" <<'JS'
const { readFileSync, readdirSync, writeFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const [src, goroot, out, ghVersion] = process.argv.slice(2)
const modules = readFileSync(join(src, 'vendor/modules.txt'), 'utf8')
  .split('\n').filter(line => line.startsWith('# ')).map(line => line.slice(2).split(' '))
const sections = [`## Go ${readFileSync(join(goroot, 'VERSION'), 'utf8').split('\n')[0]} (runtime and standard library)\n\n\`\`\`\n${readFileSync(join(goroot, 'LICENSE'), 'utf8').trim()}\n\`\`\``]
for (const [path, version] of modules) {
  const dir = join(src, 'vendor', path)
  if (!existsSync(dir)) continue
  const files = readdirSync(dir).filter(name => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(name)).sort()
  if (!files.length) continue
  sections.push(`## ${path} ${version}\n\n${files.map(name => `\`\`\`\n${readFileSync(join(dir, name), 'utf8').trim()}\n\`\`\``).join('\n\n')}`)
}
writeFileSync(out, `# Third-party notices\n\ngh.wasm includes the Go runtime and these modules, as vendored by gh v${ghVersion}.\n\n${sections.join('\n\n')}\n`)
JS

# grep -q closes the pipe early. Under pipefail, strings then dies with
# SIGPIPE and the check looks like a miss even when gh_host is present.
if ! strings "$DEST/bin/gh.wasm" | grep -F 'gh_host' >/dev/null; then
  echo "homescoop: gh.wasm does not import gh_host" >&2
  exit 1
fi
shasum -a 256 "$DEST/bin/gh.wasm"
echo "OK wasi-gh $VERSION (gh $COMMIT + patches)"
