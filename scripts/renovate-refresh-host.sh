#!/usr/bin/env bash
# renovate-refresh-host.sh: run scripts/renovate-refresh.mjs from main, on a
# host whose git and gh can push to ai-ecoverse/homescoop (docs/renovate.md,
# "The refresh"). A bb script automation runs it every 15 minutes; any
# scheduler works. It keeps its own clone, so it never touches a working
# checkout, and always runs main's copy of the scripts.
#
#   HOMESCOOP_REFRESH_CLONE=<dir>  the clone (default ~/Library/Caches/homescoop-renovate-refresh/homescoop,
#                                  or $XDG_CACHE_HOME/… elsewhere)
#
# Prints nothing when no Renovate PR needs a refresh.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
cache="${XDG_CACHE_HOME:-$HOME/Library/Caches}"
clone="${HOMESCOOP_REFRESH_CLONE:-$cache/homescoop-renovate-refresh/homescoop}"
if [[ ! -d "$clone/.git" ]]; then
  mkdir -p "$(dirname "$clone")"
  git clone -q https://github.com/ai-ecoverse/homescoop.git "$clone"
fi
cd "$clone"
git worktree prune
git fetch -q --prune origin
git checkout -q --force --detach origin/main
exec node scripts/renovate-refresh.mjs "$@"
