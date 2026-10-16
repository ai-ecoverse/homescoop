#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe planted
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$WORK/planted.tar.gz"
