#!/usr/bin/env bash
# gcloud-cli build.sh: Google's own Cloud SDK components, staged as a
# pure-Python tree for wasix-python (homescoop#2037). Nothing is compiled.
#
# The recipe pins Google's release manifest, components-v<version>.json, by
# sha256. That manifest names each component's tarball and its sha256, and
# every tarball is fetched and checked against it, so one pin covers them all
# and a Renovate bump of version: needs no other edit.
#
# Needs curl, shasum, tar and a python3 >= 3.10 on the build machine (to read
# the manifest and to write the SDK's install state with the SDK's own code).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${HOMESCOOP_ROOT:-$(cd "$HERE/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe gcloud-cli

# The platform-neutral components: no bundled CPython, no gcloud-crc32c
# binary, no *-nix shell launchers (bin/ below replaces them). alpha and beta
# are the release-track markers (a few hundred bytes each); they go in
# because `gcloud components install` can't run here.
COMPONENTS=(core gcloud-deps bq alpha beta)
DL="https://dl.google.com/dl/cloudsdk/channels/rapid"
PY="${HOMESCOOP_HOST_PYTHON:-python3}"

MANIFEST="$WORK/components-v$VERSION.json"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$MANIFEST"

# id, tarball, sha256 per component, from the pinned manifest.
LIST="$WORK/gcloud-cli-$VERSION-components.txt"
"$PY" -S -B - "$MANIFEST" "$VERSION" "${COMPONENTS[@]}" >"$LIST" <<'EOF'
import json, re, sys
manifest, version, *ids = sys.argv[1:]
d = json.load(open(manifest))
if d.get("version") != version:
    sys.exit(f"gcloud-cli: {manifest} is release {d.get('version')}, the recipe {version}")
by_id = {c["id"]: c for c in d["components"]}
for cid in ids:
    c = by_id.get(cid)
    if c is None:
        sys.exit(f"gcloud-cli: release {version} has no component {cid}")
    if c.get("platform"):
        sys.exit(f"gcloud-cli: component {cid} is platform-specific ({c['platform']})")
    data = c.get("data") or {}
    src, sha = data.get("source"), data.get("checksum")
    if data.get("type") != "tar" or not src or not re.fullmatch(r"components/[A-Za-z0-9._-]+\.tar\.gz", src) or not re.fullmatch(r"[0-9a-f]{64}", sha or ""):
        sys.exit(f"gcloud-cli: component {cid} has no tar source with a sha256 ({data})")
    print(cid, src, sha)
EOF

STAGE="$WORK/gcloud-cli-$VERSION-sdk"
rm -rf "$STAGE"
mkdir -p "$STAGE"
pairs=()
while read -r cid src sha; do
  tb="$WORK/$(basename "$src")"
  homescoop_fetch "$DL/$src" "$sha" "$tb"
  tar -tzf "$tb" | LC_ALL=C sort >"$WORK/gcloud-cli-$cid.files"
  if tar -tvzf "$tb" | grep -qE '^[lh]'; then
    echo "gcloud-cli: $src has links (npm packs neither kind)" >&2
    exit 1
  fi
  tar -xzf "$tb" -C "$STAGE"
  pairs+=("$cid=$WORK/gcloud-cli-$cid.files")
  echo "== gcloud-cli: $cid ($(basename "$src"), $(wc -l <"$WORK/gcloud-cli-$cid.files" | tr -d ' ') entries)"
done <"$LIST"
[[ "$(cat "$STAGE/VERSION")" == "$VERSION" ]] || { echo "gcloud-cli: VERSION says $(cat "$STAGE/VERSION"), the recipe $VERSION" >&2; exit 1; }

echo "== gcloud-cli: trim what can't run here"
# __pycache__: cpython-314 .pyc, which 3.15 ignores (the package is version
# neutral, as py-six since homescoop#1283). The shell launchers, installers and
# shell rc snippets: bin/gcloud and bin/bq here are Python (src/launcher.py).
# deb/ and rpm/ map components to apt and yum packages. RELEASE_NOTES is 1.7 MB
# of text that `gcloud components update` would show.
find "$STAGE" -type d -name __pycache__ -prune -exec rm -rf {} +
rm -f "$STAGE"/bin/{gcloud,bq,docker-credential-gcloud,git-credential-gcloud.sh,dev_appserver.py,java_dev_appserver.sh}
rm -f "$STAGE"/{install.sh,install.bat,completion.bash.inc,completion.zsh.inc,path.bash.inc,path.fish.inc,path.zsh.inc,RELEASE_NOTES}
rm -rf "$STAGE/deb" "$STAGE/rpm"

echo "== gcloud-cli: component manager off, no update checks, no usage reporting, no survey prompts"
# disable_updater is how Google's own apt and yum packages turn the component
# manager off: `gcloud components install|update|remove|reinstall` then stop
# with "managed by an external package manager".
CONFIG="$STAGE/lib/googlecloudsdk/core/config.json"
grep -q '"disable_updater": false,' "$CONFIG"
sed -i.orig 's/"disable_updater": false,/"disable_updater": true,/' "$CONFIG"
rm -f "$CONFIG.orig"
grep -q '"disable_updater": true,' "$CONFIG"
grep -q '"disable_usage_reporting": true,' "$CONFIG"
# The installation properties (lowest precedence after the defaults; a user's
# `gcloud config set` overrides them).
cat >"$STAGE/properties" <<'EOF'
[component_manager]
disable_update_check = True

[core]
disable_usage_reporting = True

[survey]
disable_prompts = True
EOF

echo "== gcloud-cli: install state (.install/)"
PYTHONDONTWRITEBYTECODE=1 "$PY" -S -B "$HERE/src/install-state.py" "$STAGE" "$MANIFEST" "${pairs[@]}"
find "$STAGE" -type d -name __pycache__ -prune -exec rm -rf {} +

PKG="$HERE/package"
rm -rf "$PKG/lib" "$PKG/bin"
mkdir -p "$PKG/lib" "$PKG/bin"
mv "$STAGE" "$PKG/lib/google-cloud-sdk"
for t in gcloud bq; do
  cp "$HERE/src/launcher.py" "$PKG/bin/$t"
done
cp "$PKG/lib/google-cloud-sdk/LICENSE" "$PKG/LICENSE"
find "$PKG/lib" "$PKG/bin" -type d -exec chmod 755 {} +
find "$PKG/lib" -type f -exec chmod 644 {} +
chmod 644 "$PKG/LICENSE"
chmod 755 "$PKG/bin/gcloud" "$PKG/bin/bq"

echo "== gcloud-cli: checks"
bad="$(find "$PKG/lib" -type f \( -name '*.pyc' -o -name '*.so' -o -name '*.dylib' -o -name '*.dll' -o -name '*.exe' -o -name '*.pyd' \) | head -5)"
[[ -z "$bad" ]] || { echo "gcloud-cli: native or bytecode files staged:" >&2; echo "$bad" >&2; exit 1; }
for f in lib/gcloud.py bin/bootstrapping/bq.py bin/bootstrapping/bootstrapping.py platform/bq/bq.py platform/bq/VERSION \
  lib/third_party/certifi/cacert.pem lib/surface/alpha/__init__.py lib/surface/beta/__init__.py properties \
  .install/core.snapshot.json .install/core.manifest .install/bq.snapshot.json; do
  [[ -f "$PKG/lib/google-cloud-sdk/$f" ]] || { echo "gcloud-cli: missing $f" >&2; exit 1; }
done
homescoop_assert_no_package_links "$PKG"
files="$(find "$PKG/lib" -type f | wc -l | tr -d ' ')"
echo "== gcloud-cli $VERSION: $files files, $(du -sh "$PKG/lib" | awk '{print $1}') in lib/"
