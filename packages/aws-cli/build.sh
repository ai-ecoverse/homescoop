#!/usr/bin/env bash
# aws-cli build.sh: the AWS CLI v2, staged as a pure-Python tree for
# wasix-python (homescoop#2115). Nothing is compiled.
#
# The recipe pins AWS's source distribution, awscli-<version>.tar.gz, and the
# pure-Python wheels its lock file (requirements/download-deps/
# system-sandbox-lock.txt) pins. Each wheel is fetched against the recipe's
# sha256, and the build checks that the recipe's wheels are exactly the lock's
# pure-Python dependencies, at its versions and hashes.
#
# Needs curl, shasum, tar, patch and a python3 >= 3.9 with sqlite3 on the
# build machine (to read the lock, unpack the wheels and generate the
# autocomplete index with the CLI's own code).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${HOMESCOOP_ROOT:-$(cd "$HERE/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe aws-cli
export PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-0}"

PY="${HOMESCOOP_HOST_PYTHON:-python3}"
# The lock's native packages, which this package leaves out (recipe notes).
NATIVE=(awscrt ruamel-yaml-clib)

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
SRC_DIR="$WORK/awscli-$VERSION"
rm -rf "$SRC_DIR"
tar -xzf "$TARBALL" -C "$WORK"
grep -qx "__version__ = '$VERSION'" "$SRC_DIR/awscli/__init__.py" || {
  echo "aws-cli: $TARBALL is not awscli $VERSION ($(grep -m1 __version__ "$SRC_DIR/awscli/__init__.py"))" >&2
  exit 1
}
homescoop_apply_patches "$SRC_DIR"
rm -f "$SRC_DIR"/.homescoop-patched-*

echo "== aws-cli: the dependencies (recipe sources, checked against the lock)"
LOCK="$SRC_DIR/requirements/download-deps/system-sandbox-lock.txt"
WHEELS="$WORK/aws-cli-$VERSION-wheels"
rm -rf "$WHEELS"
mkdir -p "$WHEELS"
LIST="$WORK/aws-cli-$VERSION-sources.txt"
node "$ROOT/scripts/read-recipe.mjs" aws-cli --json | "$PY" -S -B -c '
import json, sys
for key, s in sorted(json.load(sys.stdin)["sources"].items()):
    if s["url"].endswith(".whl"):
        print(key, s["url"], s["sha256"])
' >"$LIST"
while read -r key url sha; do
  homescoop_fetch "$url" "$sha" "$WHEELS/$(basename "$url")"
done <"$LIST"
"$PY" -S -B - "$LOCK" "$LIST" "${NATIVE[@]}" <<'EOF'
import os, re, sys
lock, listing, *native = sys.argv[1:]
norm = lambda n: re.sub(r"[-_.]+", "-", n).lower()
pins = {}
for m in re.finditer(r"^([A-Za-z0-9_.-]+)==(\S+)((?:\s*\\\s*--hash=sha256:[0-9a-f]{64})+)", open(lock).read(), re.M):
    pins[norm(m[1])] = (m[2], set(re.findall(r"[0-9a-f]{64}", m[3])))
wanted = {n: p for n, p in pins.items() if n not in native}
have = {}
for line in open(listing):
    key, url, sha = line.split()
    name, version = os.path.basename(url).split("-")[:2]
    have[norm(name)] = (version, sha, key)
bad = []
for n, (version, hashes) in sorted(wanted.items()):
    if n not in have:
        bad.append(f"the lock pins {n}=={version}, which the recipe has no source for")
    elif have[n][0] != version:
        bad.append(f"sources.{have[n][2]} is {n} {have[n][0]}, the lock pins {version}")
    elif have[n][1] not in hashes:
        bad.append(f"sources.{have[n][2]} sha256 {have[n][1]} is not one the lock pins for {n}=={version}")
for n in sorted(set(have) - set(wanted)):
    bad.append(f"sources.{have[n][2]} ({n}) is not in the lock")
if bad:
    sys.exit("aws-cli: the recipe's wheels don't match " + os.path.basename(lock) + ":\n  " + "\n  ".join(bad))
print(f"  {len(have)} wheels, as the lock pins them; left out: {', '.join(native)}")
EOF

STAGE="$WORK/aws-cli-$VERSION-stage"
LIB="$STAGE/lib/aws-cli"
rm -rf "$STAGE"
mkdir -p "$LIB/bin"
cp -R "$SRC_DIR/awscli" "$LIB/awscli"
cp "$SRC_DIR/bin/aws" "$SRC_DIR/bin/aws_completer" "$LIB/bin/"
for whl in "$WHEELS"/*.whl; do
  "$PY" -S -B - "$whl" "$LIB" <<'EOF'
import sys, zipfile
whl, dest = sys.argv[1:]
with zipfile.ZipFile(whl) as z:
    names = [n for n in z.namelist() if not n.split("/")[0].endswith(".data")]
    z.extractall(dest, names)
EOF
done
# Each wheel's RECORD lists the files pip installed, which this tree isn't.
find "$LIB" -path '*.dist-info/RECORD' -delete

echo "== aws-cli: autocomplete index (awscli/data/ac.index), as AWS's pep517 backend builds it"
# Run without site-packages: the patched tree, with no awscrt.
(cd "$WORK" && "$PY" -S -B - "$LIB" <<'EOF'
import os, sys
lib = sys.argv[1]
sys.path.insert(0, lib)
from awscli.autocomplete.generator import generate_index
generate_index(os.path.join(lib, "awscli", "data", "ac.index"))
EOF
)

echo "== aws-cli: trim"
find "$STAGE" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$STAGE" -type f \( -name .gitignore -o -name .npmignore -o -name .npmrc -o -name .DS_Store -o -name '*.orig' -o -name '*.rej' \) -print -delete

APACHE="$WORK/LICENSE-2.0.txt"
homescoop_load_recipe aws-cli --source apache_license
homescoop_fetch "$APACHE_LICENSE_SRC_URL" "$APACHE_LICENSE_SRC_SHA" "$APACHE"

echo "== aws-cli: third-party notices"
homescoop_notices_begin "lib/aws-cli has the AWS CLI's dependencies beside it, each with its own license, as the wheels ship them (their .dist-info):"
homescoop_notice "colorama 0.4.6 (BSD-3-Clause)" "$LIB/colorama-0.4.6.dist-info/licenses/LICENSE.txt" -
homescoop_notice "distro 1.8.0 (Apache-2.0)" "$LIB/distro-1.8.0.dist-info/LICENSE" -
homescoop_notice "docutils 0.19 (public domain, with BSD-2-Clause and Python 2.1.1 exceptions; LicenseRef-docutils)" "$LIB/docutils-0.19.dist-info/COPYING.txt" -
homescoop_notice "jmespath 1.0.1 (MIT)" "$LIB/jmespath-1.0.1.dist-info/LICENSE.txt" -
homescoop_notice "prompt_toolkit 3.0.51 (BSD-3-Clause)" "$LIB/prompt_toolkit-3.0.51.dist-info/licenses/LICENSE" -
# dateutil's LICENSE names the Apache License 2.0 and quotes the BSD one;
# the license's text follows it (apache.org's LICENSE-2.0.txt, pinned).
homescoop_notice "python-dateutil 2.9.0 (Apache-2.0 AND BSD-3-Clause)" "$LIB/python_dateutil-2.9.0.dist-info/LICENSE" -
homescoop_notice "python-dateutil 2.9.0: the Apache License 2.0 it names (Apache-2.0)" "$APACHE" -
homescoop_notice "ruamel.yaml 0.19.1 (MIT)" "$LIB/ruamel_yaml-0.19.1.dist-info/licenses/LICENSE" -
homescoop_notice "six 1.17.0 (MIT)" "$LIB/six-1.17.0.dist-info/LICENSE" -
homescoop_notice "urllib3 2.6.3 (MIT)" "$LIB/urllib3-2.6.3.dist-info/licenses/LICENSE.txt" -
homescoop_notice "wcwidth 0.2.14 (MIT)" "$LIB/wcwidth-0.2.14.dist-info/licenses/LICENSE" -

PKG="$HERE/package"
rm -rf "$PKG/lib" "$PKG/bin"
mkdir -p "$PKG/bin"
mv "$STAGE/lib" "$PKG/lib"
for t in aws aws_completer; do
  cp "$HERE/src/launcher.py" "$PKG/bin/$t"
done
{ cat "$SRC_DIR/LICENSE.txt"; printf '\n\n'; cat "$APACHE"; } >"$PKG/LICENSE"
find "$PKG/lib" "$PKG/bin" -type d -exec chmod 755 {} +
find "$PKG/lib" -type f -exec chmod 644 {} +
chmod 644 "$PKG/LICENSE" "$PKG/THIRD-PARTY-NOTICES.md"
chmod 755 "$PKG/bin/aws" "$PKG/bin/aws_completer"

echo "== aws-cli: checks"
bad="$(find "$PKG/lib" -type f \( -name '*.pyc' -o -name '*.so' -o -name '*.dylib' -o -name '*.dll' -o -name '*.exe' -o -name '*.pyd' \) | head -5)"
[[ -z "$bad" ]] || { echo "aws-cli: native or bytecode files staged:" >&2; echo "$bad" >&2; exit 1; }
[[ ! -e "$PKG/lib/aws-cli/awscrt" ]] || { echo "aws-cli: awscrt staged" >&2; exit 1; }
for f in awscli/clidriver.py awscli/botocore/crc.py awscli/botocore/cacert.pem awscli/data/ac.index \
  awscli/botocore/data/sts/2011-06-15/service-2.json awscli/examples/s3/cp.rst bin/aws bin/aws_completer \
  prompt_toolkit-3.0.51.dist-info/METADATA dateutil/zoneinfo/dateutil-zoneinfo.tar.gz six.py; do
  [[ -f "$PKG/lib/aws-cli/$f" ]] || { echo "aws-cli: missing lib/aws-cli/$f" >&2; exit 1; }
done
grep -q 'HAS_CRT = ' "$PKG/lib/aws-cli/awscli/botocore/compat.py"
homescoop_assert_no_package_links "$PKG"
files="$(find "$PKG/lib" -type f | wc -l | tr -d ' ')"
echo "== aws-cli $VERSION: $files files, $(du -sh "$PKG/lib" | awk '{print $1}') in lib/"
