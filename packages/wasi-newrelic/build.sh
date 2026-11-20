#!/usr/bin/env bash
# The New Relic CLI for slicc WASI: build newrelic.wasm from newrelic-cli's
# source with GOOS=wasip1, the pinned Go toolchain and the patches in
# patches/.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-newrelic
field () { node "$ROOT/scripts/read-recipe.mjs" wasi-newrelic --field "$1"; }

COMMIT="$(field source.commit)"
GO_VERSION="$(field toolchain.go)"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) go_arch=linux-amd64; host=linux_x64 ;;
  Darwin-arm64) go_arch=darwin-arm64; host=macos_arm64 ;;
  *) echo "homescoop: no wasi-newrelic toolchain pin for $(uname -sm)" >&2; exit 1 ;;
esac

TOOLS="$WORK/wasi-newrelic-tools"
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
export GOCACHE="$WORK/wasi-newrelic-gocache" GOMODCACHE="$WORK/wasi-newrelic-gomodcache"
[[ "$(go env GOVERSION)" == "go$GO_VERSION" ]] || { echo "homescoop: go is $(go env GOVERSION), want go$GO_VERSION" >&2; exit 1; }

SRC_TGZ="$WORK/newrelic-cli-$COMMIT.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRC_TGZ"
SRC="$WORK/newrelic-cli-$COMMIT"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$SRC_TGZ" -C "$SRC" --strip-components=1
# go.sum is checked as the modules download.
(cd "$SRC" && GOFLAGS=-mod=mod go mod vendor)
for p in "$HOMESCOOP_PKG"/patches/*.patch; do
  echo "== patch $(basename "$p")"
  patch -p1 -d "$SRC" < "$p"
done

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
# Upstream's release ldflags (.goreleaser.yml, builds[newrelic]); goreleaser's
# Version is the tag without its v.
(cd "$SRC" && GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false \
    -ldflags="-s -w -buildid= -X main.version=${VERSION} -X main.appName=newrelic -X github.com/newrelic/newrelic-cli/internal/cli.version=${VERSION}" \
    -o "$DEST/bin/newrelic.wasm" ./cmd/newrelic)
# A Cloudflare Dynamic Worker takes at most 64 MiB of code, and
# slicc-kernel's process host (about 0.5 MB) and newrelic-host.mjs share it
# with newrelic.wasm.
NEWRELIC_WASM_MAX=$((62 * 1024 * 1024))
newrelic_wasm_size=$(wc -c <"$DEST/bin/newrelic.wasm" | tr -d ' ')
if (( newrelic_wasm_size > NEWRELIC_WASM_MAX )); then
  echo "homescoop: newrelic.wasm is $newrelic_wasm_size bytes, over $NEWRELIC_WASM_MAX: too large for a Cloudflare Dynamic Worker" >&2
  exit 1
fi
chmod 755 "$DEST/bin/newrelic.wasm"

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
for (const entry of modules) {
  // "# path version" or, for a replaced module, "# path version => path2 version2":
  // the files are vendored under the original path, and the notice names the
  // module the build used.
  const [path, modVersion] = entry
  const arrow = entry.indexOf('=>')
  const used = arrow === -1 ? `${path} ${modVersion}` : `${entry[arrow + 1]} ${entry[arrow + 2]} (for ${path})`
  // go mod vendor copies only the packages the build imports, so a module
  // used only by tests has no directory.
  const dir = join(src, 'vendor', path)
  if (!modVersion || !existsSync(dir)) continue
  const text = license(dir)
  if (!text) throw new Error(`no licence file in vendor/${path} (${modVersion})`)
  sections.push(`## ${used}\n\n${text}`)
}
writeFileSync(out, `# Third-party notices\n\nnewrelic.wasm is the New Relic CLI v${version} (Apache-2.0; see LICENSE). It includes the Go runtime and these modules, as vendored by newrelic-cli v${version}.\n\n${sections.join('\n\n')}\n`)
JS

# grep -q closes the pipe early. Under pipefail, strings then dies with
# SIGPIPE and the check looks like a miss even when newrelic_host is present.
if ! strings "$DEST/bin/newrelic.wasm" | grep -F 'newrelic_host' >/dev/null; then
  echo "homescoop: newrelic.wasm does not import newrelic_host" >&2
  exit 1
fi
shasum -a 256 "$DEST/bin/newrelic.wasm"
echo "OK wasi-newrelic $VERSION (newrelic-cli $COMMIT + patches)"
