#!/usr/bin/env bash
# tzdata build.sh: the IANA tz database, compiled with the release's own zic
# (built for the build machine, never shipped), into package/share/zoneinfo.
# Needs a host C compiler (cc), make, awk, curl and shasum.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${HOMESCOOP_ROOT:-$(cd "$HERE/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe tzdata
homescoop_load_recipe tzdata --source tzcode

SRC="$WORK/tzdb-$VERSION"
DATA_TB="$WORK/tzdata$VERSION.tar.gz"
CODE_TB="$WORK/tzcode$VERSION.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$DATA_TB"
homescoop_fetch "$TZCODE_URL" "$TZCODE_SHA" "$CODE_TB"

# Both tarballs unpack flat into one directory, which is how upstream's
# Makefile expects them (the shared files, Makefile among them, are the same).
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$CODE_TB" -C "$SRC"
tar -xzf "$DATA_TB" -C "$SRC"
got="$(cat "$SRC/version")"
[[ "$got" == "$VERSION" ]] || { echo "tzdata: the release says version $got, the recipe $VERSION" >&2; exit 1; }

echo "== tzdata: zic $VERSION (host) and tzdata.zi"
(
  unset CC CFLAGS CPPFLAGS LDFLAGS
  make -C "$SRC" -s CC="${HOMESCOOP_HOST_CC:-cc}" AWK=awk zic tzdata.zi
)

# The lean tree: main data plus backward (old names such as US/Eastern),
# slim TZif (64-bit data plus the POSIX TZ footer; musl and Python's
# zoneinfo read it), no right/ or posix/ copies.
ZONES="$WORK/tzdata-$VERSION-zones"
CHECK="$WORK/tzdata-$VERSION-check"
rm -rf "$ZONES" "$CHECK"
"$SRC/zic" -b slim -d "$ZONES" "$SRC/tzdata.zi"
# tzdata.zi is awk's output; compile the source files directly as well and
# require the same tree, so no awk can change a zone.
(cd "$SRC" && ./zic -b slim -d "$CHECK" africa antarctica asia australasia europe \
  northamerica southamerica etcetera factory backward)
diff -r "$ZONES" "$CHECK" >/dev/null || { echo "tzdata: zones from tzdata.zi differ from the source files'" >&2; diff -rq "$ZONES" "$CHECK" >&2 || true; exit 1; }

OUT="$HERE/package/share/zoneinfo"
rm -rf "$HERE/package/share"
mkdir -p "$OUT"
# zic makes backward's links hard links (or symlinks); npm rejects both
# (E415), so every name gets its own copy of the bytes.
(
  cd "$ZONES"
  find . \( -type f -o -type l \) -print | LC_ALL=C sort | while IFS= read -r f; do
    mkdir -p "$OUT/$(dirname "$f")"
    cat "$f" >"$OUT/$f"
  done
)
for f in tzdata.zi zone.tab zone1970.tab zonenow.tab iso3166.tab leapseconds; do
  cp "$SRC/$f" "$OUT/$f"
done
find "$HERE/package/share" -type d -exec chmod 755 {} +
find "$HERE/package/share" -type f -exec chmod 644 {} +
cp "$SRC/LICENSE" "$HERE/package/LICENSE"
chmod 644 "$HERE/package/LICENSE"

for z in UTC Etc/UTC Europe/Berlin America/New_York US/Eastern; do
  [[ "$(head -c 4 "$OUT/$z")" == TZif ]] || { echo "tzdata: $z is missing or not TZif" >&2; exit 1; }
done
homescoop_assert_no_package_links "$HERE/package"
zones="$(find "$OUT" -type f ! -name '*.tab' ! -name '*.zi' ! -name leapseconds | wc -l | tr -d ' ')"
bytes="$(find "$HERE/package/share" -type f -exec cat {} + | wc -c | tr -d ' ')"
echo "== tzdata $VERSION: $zones zone files, share/ $bytes bytes"
