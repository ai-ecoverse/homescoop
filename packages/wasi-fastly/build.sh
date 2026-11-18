#!/usr/bin/env bash
# The Fastly CLI for slicc WASI: build fastly.wasm from fastly's source with
# GOOS=wasip1, the pinned Go toolchain and the patches in patches/.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-fastly
field () { node "$ROOT/scripts/read-recipe.mjs" wasi-fastly --field "$1"; }

COMMIT="$(field source.commit)"
GO_VERSION="$(field toolchain.go)"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) go_arch=linux-amd64; host=linux_x64 ;;
  Darwin-arm64) go_arch=darwin-arm64; host=macos_arm64 ;;
  *) echo "homescoop: no wasi-fastly toolchain pin for $(uname -sm)" >&2; exit 1 ;;
esac

TOOLS="$WORK/wasi-fastly-tools"
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
export GOCACHE="$WORK/wasi-fastly-gocache" GOMODCACHE="$WORK/wasi-fastly-gomodcache"
[[ "$(go env GOVERSION)" == "go$GO_VERSION" ]] || { echo "homescoop: go is $(go env GOVERSION), want go$GO_VERSION" >&2; exit 1; }

SRC_TGZ="$WORK/fastly-$COMMIT.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRC_TGZ"
SRC="$WORK/fastly-$COMMIT"
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
# Upstream's release ldflags (.goreleaser.yml); GitCommit is goreleaser's
# ShortCommit.
(cd "$SRC" && GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false \
    -ldflags="-s -w -buildid= -X github.com/fastly/cli/pkg/revision.AppVersion=v${VERSION} -X github.com/fastly/cli/pkg/revision.GitCommit=${COMMIT:0:7} -X github.com/fastly/cli/pkg/revision.Environment=release" \
    -o "$DEST/bin/fastly.wasm" ./cmd/fastly)
# Go's wasm uses sign extension, saturating float conversion and bulk memory.
homescoop_wasm_opt "$DEST/bin/fastly.wasm" wasi-fastly \
  --enable-sign-ext --enable-nontrapping-float-to-int --enable-bulk-memory --enable-mutable-globals
# A Cloudflare Dynamic Worker takes at most 64 MiB of code, and slicc-kernel's
# process host (about 0.5 MB) and fastly-host.mjs share it with fastly.wasm.
FASTLY_WASM_MAX=$((62 * 1024 * 1024))
fastly_wasm_size=$(wc -c <"$DEST/bin/fastly.wasm" | tr -d ' ')
if (( fastly_wasm_size > FASTLY_WASM_MAX )); then
  echo "homescoop: fastly.wasm is $fastly_wasm_size bytes, over $FASTLY_WASM_MAX: too large for a Cloudflare Dynamic Worker" >&2
  exit 1
fi
chmod 755 "$DEST/bin/fastly.wasm"

cp "$SRC/LICENSE" "$DEST/LICENSE"
node - "$SRC" "$GOROOT_DIR" "$DEST/THIRD-PARTY-NOTICES.md" "$VERSION" <<'JS'
const { readFileSync, readdirSync, writeFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const [src, goroot, out, version] = process.argv.slice(2)
const modules = readFileSync(join(src, 'vendor/modules.txt'), 'utf8')
  .split('\n').filter(line => line.startsWith('# ')).map(line => line.slice(2).split(' '))
const license = dir => readdirSync(dir).filter(name => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(name)).sort()
  .map(name => `\`\`\`\n${readFileSync(join(dir, name), 'utf8').trim()}\n\`\`\``).join('\n\n')
const sections = [`## Go ${readFileSync(join(goroot, 'VERSION'), 'utf8').split('\n')[0]} (runtime and standard library)\n\n${license(goroot)}`]
for (const [path, modVersion] of modules) {
  // go mod vendor copies only the packages the build imports, so a module
  // used only by tests (kr/pretty, check.v1) has no directory.
  const dir = join(src, 'vendor', path)
  if (!modVersion || !existsSync(dir)) continue
  const text = license(dir)
  if (!text) throw new Error(`no licence file in vendor/${path} (${modVersion})`)
  sections.push(`## ${path} ${modVersion}\n\n${text}`)
}
writeFileSync(out, `# Third-party notices\n\nfastly.wasm is the Fastly CLI v${version} (Apache-2.0; see LICENSE). It includes the Go runtime and these modules, as vendored by fastly v${version}.\n\n${sections.join('\n\n')}\n`)
JS

# grep -q closes the pipe early. Under pipefail, strings then dies with
# SIGPIPE and the check looks like a miss even when fastly_host is present.
if ! strings "$DEST/bin/fastly.wasm" | grep -F 'fastly_host' >/dev/null; then
  echo "homescoop: fastly.wasm does not import fastly_host" >&2
  exit 1
fi
shasum -a 256 "$DEST/bin/fastly.wasm"
echo "OK wasi-fastly $VERSION (fastly $COMMIT + patches)"
