#!/usr/bin/env bash
# azure-cli build.sh: the Azure CLI and its closure, as upstream pins it,
# staged as a pure-Python tree for wasix-python (homescoop#2112). Nothing is
# compiled.
#
# The recipe pins upstream's requirements.py3.Linux.txt for the release by
# sha256. wheels.lock (written by src/lock.py) records that sha256 and gives
# every file of the closure with PyPI's sha256; build.sh refuses a lock made
# from other bytes, and fetches and checks each file against the lock. After
# a version bump, run src/lock.py (needs uv and the network).
#
# Needs curl, shasum and a python3 >= 3.10 on the build machine (to unpack the
# wheels and to run upstream's trim_sdk.py on the staged tree).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${HOMESCOOP_ROOT:-$(cd "$HERE/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe azure-cli
homescoop_load_recipe azure-cli --source trim

PY="${HOMESCOOP_HOST_PYTHON:-python3}"
LOCK="$HERE/wheels.lock"

REQS="$WORK/azure-cli-$VERSION-requirements.py3.Linux.txt"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$REQS"
TRIM="$WORK/azure-cli-$VERSION-trim_sdk.py"
homescoop_fetch "$TRIM_SRC_URL" "$TRIM_SRC_SHA" "$TRIM"

echo "== azure-cli: wheels.lock is for azure-cli $VERSION and upstream's pins"
# The lock names the release and the sha256 of the requirements file it was
# made from; every exact upstream pin is in the lock at that version, or in
# its excluded list.
"$PY" -S -B - "$LOCK" "$REQS" "$VERSION" "$SRC_SHA" <<'EOF'
import re, sys
lock, reqs, version, sha = sys.argv[1:]
canon = lambda n: re.sub(r"[-_.]+", "-", n).lower()
head, rows, excluded = {}, {}, {}
for line in open(lock, encoding="utf-8"):
    if line.startswith("# azure-cli "):
        head["version"] = line.split()[2]
    elif line.startswith("# requirements "):
        head["sha"] = line.split()[2]
    elif line.startswith("# excluded "):
        excluded[line.split()[2]] = line.split()[3].rstrip(":")
    elif line.strip() and not line.startswith("#"):
        name, ver, pin, kind, s, url = line.split()
        if not re.fullmatch(r"[0-9a-f]{64}", s) or not url.startswith("https://files.pythonhosted.org/packages/"):
            sys.exit(f"azure-cli: wheels.lock: bad entry {line.strip()}")
        if kind == "wheel" and not url.endswith("-none-any.whl"):
            sys.exit(f"azure-cli: wheels.lock: {name} is not a pure wheel ({url})")
        rows[name] = ver
if head.get("version") != version:
    sys.exit(f"azure-cli: wheels.lock is for azure-cli {head.get('version')}, the recipe {version}: run python3 packages/azure-cli/src/lock.py")
if head.get("sha") != sha:
    sys.exit(f"azure-cli: wheels.lock was made from requirements {head.get('sha')}, the recipe pins {sha}: run python3 packages/azure-cli/src/lock.py")
for line in open(reqs, encoding="utf-8"):
    line = line.split("#", 1)[0].strip()
    if not line:
        continue
    m = re.fullmatch(r"([A-Za-z0-9._-]+)\s*(==|~=)\s*(\S+)", line)
    if not m:
        sys.exit(f"azure-cli: can't read upstream pin {line!r}")
    c, op, v = canon(m.group(1)), m.group(2), m.group(3)
    if c in excluded:
        if op == "==" and excluded[c] != v:
            sys.exit(f"azure-cli: upstream pins {c}=={v}, wheels.lock excluded {excluded[c]}")
    elif c not in rows:
        sys.exit(f"azure-cli: upstream pins {c}, wheels.lock has no {c}")
    elif op == "==" and rows[c] != v:
        sys.exit(f"azure-cli: upstream pins {c}=={v}, wheels.lock has {rows[c]}")
print(f"  {len(rows)} distributions, {len(excluded)} excluded")
EOF

echo "== azure-cli: fetch the closure"
DL="$WORK/azure-cli-$VERSION-dist"
mkdir -p "$DL"
while read -r _name _ver _pin _kind sha url; do
  homescoop_fetch "$url" "$sha" "$DL/${url##*/}"
done < <(grep -v '^#' "$LOCK")

STAGE="$WORK/azure-cli-$VERSION-site"
rm -rf "$STAGE"
echo "== azure-cli: install (no deps, no bytecode)"
NOTICES="$WORK/azure-cli-$VERSION-THIRD-PARTY-NOTICES.md"
PYTHONDONTWRITEBYTECODE=1 "$PY" -S -B "$HERE/src/install.py" "$STAGE" "$LOCK" "$DL" "$NOTICES"

echo "== azure-cli: patches"
# can-launch-browser-wasi.patch: plain az login falls back to the device code
# flow on WASI, as on a headless Linux, instead of waiting for a browser.
# storage-encryption-without-cryptography.patch: azure-storage-blob, -queue
# and -common load without cryptography (client-side encryption needs it),
# so az storage works.
for p in "$HERE"/*.patch; do
  echo "  $(basename "$p")"
  if ! patch -s -d "$STAGE" -p1 <"$p"; then
    echo "azure-cli: $(basename "$p") does not apply to azure-cli $VERSION; refresh the patch" >&2
    exit 1
  fi
done
if [[ -n "$(find "$STAGE" \( -name '*.orig' -o -name '*.rej' \) | head -1)" ]]; then
  echo "azure-cli: a patch left .orig or .rej files" >&2
  exit 1
fi

echo "== azure-cli: trim the SDKs (upstream's scripts/trim_sdk.py)"
before="$(du -sk "$STAGE" | awk '{print $1}')"
PYTHONDONTWRITEBYTECODE=1 "$PY" -S -B - "$STAGE" "$TRIM" <<'EOF' 2>"$WORK/azure-cli-trim.log"
import runpy, sys
site, trim = sys.argv[1:]
sys.path.insert(0, site)
sys.argv = [trim]
runpy.run_path(trim, run_name="__main__")
EOF
grep -c '^WARNING' "$WORK/azure-cli-trim.log" | xargs -I{} echo "  removed {} folders ($before KiB before, $(du -sk "$STAGE" | awk '{print $1}') KiB after)"
find "$STAGE" -type d -name __pycache__ -prune -exec rm -rf {} +

PKG="$HERE/package"
rm -rf "$PKG/lib" "$PKG/bin"
mkdir -p "$PKG/lib" "$PKG/bin"
mv "$STAGE" "$PKG/lib/azure-cli"
cp "$HERE/src/launcher.py" "$PKG/bin/az"
cp "$NOTICES" "$PKG/THIRD-PARTY-NOTICES.md"
# Upstream's license, as the azure-cli wheel carries it.
cp "$PKG/lib/azure-cli/azure_cli-$VERSION.dist-info/licenses/LICENSE.txt" "$PKG/LICENSE"
chmod 644 "$PKG/LICENSE" "$PKG/THIRD-PARTY-NOTICES.md"
find "$PKG/lib" "$PKG/bin" -type d -exec chmod 755 {} +
find "$PKG/lib" -type f -exec chmod 644 {} +
chmod 755 "$PKG/bin/az"

echo "== azure-cli: checks"
bad="$(find "$PKG/lib" \( -name '*.pyc' -o -name '*.so' -o -name '*.dylib' -o -name '*.dll' -o -name '*.exe' -o -name '*.pyd' -o -name __pycache__ \) | head -5)"
[[ -z "$bad" ]] || { echo "azure-cli: native or bytecode files staged:" >&2; echo "$bad" >&2; exit 1; }
for f in azure/cli/__main__.py azure/cli/core/__init__.py knack/cli.py msal/application.py requests/__init__.py certifi/cacert.pem yaml/__init__.py \
  "azure_cli-$VERSION.dist-info/METADATA" "azure_cli_core-$VERSION.dist-info/METADATA"; do
  [[ -f "$PKG/lib/azure-cli/$f" ]] || { echo "azure-cli: missing $f" >&2; exit 1; }
done
homescoop_assert_no_package_links "$PKG"
files="$(find "$PKG/lib" -type f | wc -l | tr -d ' ')"
echo "== azure-cli $VERSION: $files files, $(du -sh "$PKG/lib" | awk '{print $1}') in lib/"
