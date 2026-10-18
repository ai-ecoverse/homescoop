#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-ntfy
field () { node "$ROOT/scripts/read-recipe.mjs" wasi-ntfy --field "$1"; }

COMMIT="$(field source.commit)"
GO_VERSION="$(field toolchain.go)"
NTFY_VERSION="$(field build.version)"
NTFY_DATE="$(field build.date)"
TAGS="$(field build.tags)"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) go_arch=linux-amd64; host=linux_x64 ;;
  Darwin-arm64) go_arch=darwin-arm64; host=macos_arm64 ;;
  *) echo "homescoop: no wasi-ntfy toolchain pin for $(uname -sm)" >&2; exit 1 ;;
esac

TOOLS="$WORK/wasi-ntfy-tools"
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
export GOTOOLCHAIN=local GOFLAGS=-mod=mod
export GOCACHE="$WORK/wasi-ntfy-gocache" GOMODCACHE="$WORK/wasi-ntfy-gomodcache"
[[ "$(go env GOVERSION)" == "go$GO_VERSION" ]] || { echo "homescoop: go is $(go env GOVERSION), want go$GO_VERSION" >&2; exit 1; }

SRC_TGZ="$WORK/ntfy-$COMMIT.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRC_TGZ"
SRC="$WORK/ntfy-$COMMIT"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$SRC_TGZ" -C "$SRC" --strip-components=1
for p in "$HOMESCOOP_PKG"/patches/*.patch; do
  echo "== patch $(basename "$p")"
  patch -p1 -d "$SRC" < "$p"
done

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
(cd "$SRC" && GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false -tags "$TAGS" \
    -ldflags="-s -w -buildid= -X main.version=${NTFY_VERSION} -X main.commit=${COMMIT} -X main.date=${NTFY_DATE}" \
    -o "$DEST/bin/ntfy.wasm" .)
chmod 755 "$DEST/bin/ntfy.wasm"

cp "$SRC/LICENSE" "$DEST/LICENSE"
cp "$SRC/LICENSE.GPLv2" "$DEST/LICENSE.GPLv2"
(cd "$SRC" && GOOS=wasip1 GOARCH=wasm go list -tags "$TAGS" -deps -f '{{with .Module}}{{.Path}} {{.Version}} {{.Dir}}{{end}}' .) \
  | sort -u > "$WORK/wasi-ntfy-modules.txt"
node - "$WORK/wasi-ntfy-modules.txt" "$GOROOT_DIR" "$DEST/THIRD-PARTY-NOTICES.md" "$NTFY_VERSION" <<'JS'
const { readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const [list, goroot, out, version] = process.argv.slice(2)
const license = dir => readdirSync(dir).filter(name => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(name)).sort()
  .map(name => `\`\`\`\n${readFileSync(join(dir, name), 'utf8').trim()}\n\`\`\``).join('\n\n')
const sections = [`## Go ${readFileSync(join(goroot, 'VERSION'), 'utf8').split('\n')[0]} (runtime and standard library)\n\n${license(goroot)}`]
for (const line of readFileSync(list, 'utf8').split('\n').filter(Boolean)) {
  const [path, modVersion, dir] = line.split(' ')
  if (path === 'heckel.io/ntfy/v2') continue
  if (!modVersion || !dir) continue
  const text = license(dir)
  if (!text) throw new Error(`no licence file in ${path} ${modVersion}`)
  sections.push(`## ${path} ${modVersion}\n\n${text}`)
}
writeFileSync(out, `# Third-party notices\n\nntfy.wasm is ntfy ${version} (Apache-2.0 OR GPL-2.0-only; see LICENSE and LICENSE.GPLv2). It includes the Go runtime and these modules.\n\n${sections.join('\n\n')}\n`)
JS

if ! strings "$DEST/bin/ntfy.wasm" | grep -F 'ntfy_host' >/dev/null; then
  echo "homescoop: ntfy.wasm does not import ntfy_host" >&2
  exit 1
fi
shasum -a 256 "$DEST/bin/ntfy.wasm"
echo "OK wasi-ntfy $VERSION (ntfy $COMMIT + patches)"
