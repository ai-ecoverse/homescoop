#!/usr/bin/env bash
# Builds one Go command for slicc WASI preview1 from a recipe:
#   source.url / source.sha256  pinned source archive (one top-level directory)
#   toolchain.go, toolchain.go_sha256_<host>  pinned Go
#   build.module                directory of the Go module inside the archive ("." for its root)
#   build.package               import path or ./dir of the main package
#   build.command               command name: package/bin/<command>.wasm
# packages/<package>/*.patch apply to the source (homescoop_apply_patches).
# The module's go.sum is checked as its dependencies download.
set -euo pipefail
NAME="${1:?usage: build-wasip1-go-command.sh <package>}"
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe "$NAME"
field () { node "$ROOT/scripts/read-recipe.mjs" "$NAME" --field "$1"; }

GO_VERSION="$(field toolchain.go)"
MODULE="$(field build.module)"
PACKAGE="$(field build.package)"
COMMAND="$(field build.command)"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) go_arch=linux-amd64; host=linux_x64 ;;
  Darwin-arm64) go_arch=darwin-arm64; host=macos_arm64 ;;
  *) echo "homescoop: no Go toolchain pin for $(uname -sm)" >&2; exit 1 ;;
esac

TOOLS="$WORK/go-tools"
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
export GOCACHE="$WORK/$NAME-gocache" GOMODCACHE="$WORK/$NAME-gomodcache"
[[ "$(go env GOVERSION)" == "go$GO_VERSION" ]] || { echo "homescoop: go is $(go env GOVERSION), want go$GO_VERSION" >&2; exit 1; }

SRC_TGZ="$WORK/$NAME-$(basename "${SRC_URL%%\?*}")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRC_TGZ"
SRC="$WORK/$NAME-src"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$SRC_TGZ" -C "$SRC" --strip-components=1
homescoop_apply_patches "$SRC"

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
(cd "$SRC/$MODULE" && GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o "$DEST/bin/$COMMAND.wasm" "$PACKAGE")
chmod 755 "$DEST/bin/$COMMAND.wasm"

rm -f "$DEST/LICENSE" "$DEST/NOTICE"
for license in LICENSE LICENSE.md LICENSE.txt; do
  if [[ -f "$SRC/$license" ]]; then cp "$SRC/$license" "$DEST/LICENSE"; break; fi
done
if [[ ! -f "$DEST/LICENSE" ]]; then echo "homescoop: no LICENSE in the $NAME source" >&2; exit 1; fi
for notice in NOTICE NOTICE.txt NOTICE.md; do
  if [[ -f "$SRC/$notice" ]]; then cp "$SRC/$notice" "$DEST/NOTICE"; break; fi
done
# Notices: the Go runtime, and every other module the command links.
(cd "$SRC/$MODULE" && GOOS=wasip1 GOARCH=wasm go list -deps -f '{{with .Module}}{{.Path}} {{.Version}} {{.Dir}}{{end}}' "$PACKAGE") \
  | sort -u > "$WORK/$NAME-modules.txt"
node - "$WORK/$NAME-modules.txt" "$GOROOT_DIR" "$DEST/THIRD-PARTY-NOTICES.md" "$COMMAND" <<'JS'
const { readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const [list, goroot, out, command] = process.argv.slice(2)
const license = dir => readdirSync(dir).filter(name => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(name)).sort()
  .map(name => `\`\`\`\n${readFileSync(join(dir, name), 'utf8').trim()}\n\`\`\``).join('\n\n')
const sections = [`## Go ${readFileSync(join(goroot, 'VERSION'), 'utf8').split('\n')[0]} (runtime and standard library)\n\n${license(goroot)}`]
for (const line of readFileSync(list, 'utf8').split('\n').filter(Boolean)) {
  const [path, version, dir] = line.split(' ')
  if (!version || !dir) continue
  sections.push(`## ${path} ${version}\n\n${license(dir)}`)
}
writeFileSync(out, `# Third-party notices\n\n${command}.wasm includes the Go runtime and these modules.\n\n${sections.join('\n\n')}\n`)
JS
shasum -a 256 "$DEST/bin/$COMMAND.wasm"
echo "OK $NAME $VERSION ($COMMAND)"
