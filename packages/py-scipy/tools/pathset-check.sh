#!/usr/bin/env bash
# Blocking PRESTAGE: .so / .py path sets must match a baseline package
# (npm tarball or unpacked tree), plus/minus an explicit allow-list.
#
# Usage:
#   pathset-check.sh --prev <prev.tgz|dir> --cur <stage-or-package-dir> \
#     [--allow-add path]... [--allow-del path]...
#
# Paths are relative to lib/python3.14/site-packages/ (or package/lib/... inside tgz).
set -euo pipefail

PREV=""
CUR=""
ALLOW_ADD=()
ALLOW_DEL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prev) PREV="$2"; shift 2 ;;
    --cur) CUR="$2"; shift 2 ;;
    --allow-add) ALLOW_ADD+=("$2"); shift 2 ;;
    --allow-del) ALLOW_DEL+=("$2"); shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$PREV" && -n "$CUR" ]] || {
  echo "usage: pathset-check.sh --prev <tgz|dir> --cur <dir> [--allow-add p]..." >&2
  exit 2
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

list_from_tgz() {
  local tgz="$1" ext="$2" out="$3"
  tar tzf "$tgz" | sed 's|^package/||' | grep "\\.${ext}\$" \
    | sed 's|^lib/python3.14/site-packages/||' | grep -v '^$' | sort -u > "$out"
}

list_from_dir() {
  local dir="$1" ext="$2" out="$3"
  local root
  if [[ -d "$dir/lib/python3.14/site-packages" ]]; then
    root="$dir/lib/python3.14/site-packages"
  elif [[ -d "$dir/python3.14/site-packages" ]]; then
    root="$dir/python3.14/site-packages"
  elif [[ -d "$dir/site-packages" ]]; then
    root="$dir/site-packages"
  else
    root="$dir"
  fi
  find "$root" -name "*.${ext}" | sed "s|^${root}/||" | sort -u > "$out"
}

if [[ -f "$PREV" && "$PREV" == *.tgz ]]; then
  list_from_tgz "$PREV" so "$tmp/prev-so.txt"
  list_from_tgz "$PREV" py "$tmp/prev-py.txt"
elif [[ -d "$PREV" ]]; then
  list_from_dir "$PREV" so "$tmp/prev-so.txt"
  list_from_dir "$PREV" py "$tmp/prev-py.txt"
else
  echo "prev not found: $PREV" >&2
  exit 1
fi

list_from_dir "$CUR" so "$tmp/cur-so.txt"
list_from_dir "$CUR" py "$tmp/cur-py.txt"

# Expected cur = prev + allow-add - allow-del
cp "$tmp/prev-so.txt" "$tmp/exp-so.txt"
cp "$tmp/prev-py.txt" "$tmp/exp-py.txt"
for p in "${ALLOW_ADD[@]+"${ALLOW_ADD[@]}"}"; do
  [[ -z "$p" ]] && continue
  case "$p" in
    *.so) echo "$p" >> "$tmp/exp-so.txt" ;;
    *.py) echo "$p" >> "$tmp/exp-py.txt" ;;
    *) echo "$p" >> "$tmp/exp-so.txt"; echo "$p" >> "$tmp/exp-py.txt" ;;
  esac
done
for p in "${ALLOW_DEL[@]+"${ALLOW_DEL[@]}"}"; do
  [[ -z "$p" ]] && continue
  grep -vxF "$p" "$tmp/exp-so.txt" > "$tmp/exp-so2.txt" || true
  mv "$tmp/exp-so2.txt" "$tmp/exp-so.txt"
  grep -vxF "$p" "$tmp/exp-py.txt" > "$tmp/exp-py2.txt" || true
  mv "$tmp/exp-py2.txt" "$tmp/exp-py.txt"
done
sort -u "$tmp/exp-so.txt" -o "$tmp/exp-so.txt"
sort -u "$tmp/exp-py.txt" -o "$tmp/exp-py.txt"

bad=0
for kind in so py; do
  missing=$(comm -23 "$tmp/exp-${kind}.txt" "$tmp/cur-${kind}.txt" || true)
  extra=$(comm -13 "$tmp/exp-${kind}.txt" "$tmp/cur-${kind}.txt" || true)
  if [[ -n "$missing" ]]; then
    echo "FAIL: .${kind} missing from cur (expected from prev±allow):" >&2
    echo "$missing" >&2
    bad=1
  fi
  if [[ -n "$extra" ]]; then
    echo "FAIL: .${kind} extra in cur (not in prev±allow):" >&2
    echo "$extra" >&2
    bad=1
  fi
done

if [[ "$bad" -ne 0 ]]; then
  echo "pathset-check FAILED" >&2
  echo "prev so=$(wc -l < "$tmp/prev-so.txt") cur so=$(wc -l < "$tmp/cur-so.txt") exp so=$(wc -l < "$tmp/exp-so.txt")" >&2
  exit 1
fi

echo "pathset-check OK: so=$(wc -l < "$tmp/cur-so.txt") py=$(wc -l < "$tmp/cur-py.txt") (prev±allow)"
