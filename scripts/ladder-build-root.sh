#!/usr/bin/env bash
# ladder-build-root.sh <host|rebuild> <package> — pick where the PR run builds.
#
# host: the hosted workspace path /home/runner/work/<repo>/<repo> (linked to
#   $GITHUB_WORKSPACE on the pool), the default WORK, so the pool ships
#   hosted's bytes (fe9c70e8).
# rebuild: a different root (/home/runner/work/<repo>-rebuild/<repo>, a
#   real copy of the checkout, not a link), a different WORK and a different
#   USER/LOGNAME, so `reproducible` compares
#   builds from two paths and proves path independence (#668). A recipe with
#   `reproducible: { same_path: <issue> }` is known to embed its path; it
#   rebuilds in host's paths until that issue is fixed.
#
# Prints KEY=VALUE lines for $GITHUB_ENV on stdout. Env: GITHUB_WORKSPACE,
# REPO (repository name); HOMESCOOP_HOSTED_BASE overrides /home/runner/work
# (tests).
set -euo pipefail

mode="${1:?usage: ladder-build-root.sh <host|rebuild> <package>}"
pkg="${2:?usage: ladder-build-root.sh <host|rebuild> <package>}"
: "${GITHUB_WORKSPACE:?}" "${REPO:?}"
here="$(cd "$(dirname "$0")" && pwd)"
base="${HOMESCOOP_HOSTED_BASE:-/home/runner/work}"

case "$mode" in
  host) same=host ;;
  rebuild)
    same="$(node "$here/read-recipe.mjs" "$pkg" --field reproducible.same_path || true)"
    ;;
  *) echo "ladder-build-root.sh: mode must be host or rebuild" >&2; exit 2 ;;
esac

if [[ -n "$same" ]]; then
  want="$base/$REPO/$REPO"
  [[ "$mode" == rebuild ]] && echo "$pkg: reproducible.same_path (#$same): rebuild in host-build's paths" >&2
else
  want="$base/$REPO-rebuild/$REPO"
fi

if [[ -z "$same" ]]; then
  # A real copy, not a link: a tool that resolves symlinks (node's
  # import.meta.url, realpath) must not land back in host-build's directory.
  if [[ "$(cd "$GITHUB_WORKSPACE" && pwd -P)" == "$(cd "$want" 2>/dev/null && pwd -P)" ]]; then
    echo "::error::$want is the workspace; the rebuild needs its own directory" >&2
    exit 1
  fi
  rm -rf "$want"
  mkdir -p "$want"
  cp -a "$GITHUB_WORKSPACE/." "$want/"
elif [[ "$GITHUB_WORKSPACE" != "$want" ]]; then
  if [[ -e "$want" && ! -L "$want" ]]; then
    echo "::error::$want exists and is not a link to the workspace" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$want")"
  ln -sfn "$GITHUB_WORKSPACE" "$want"
fi
echo "build root $want ($(cd "$want" && pwd -P))" >&2
echo "HOMESCOOP_BUILD_ROOT=$want"
if [[ -z "$same" ]]; then
  echo "HOMESCOOP_WORK=${TMPDIR:-/tmp}/homescoop-rebuild-work"
  echo "USER=homescoop-rebuild"
  echo "LOGNAME=homescoop-rebuild"
fi
