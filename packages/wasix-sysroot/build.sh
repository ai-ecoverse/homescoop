#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
exec bash "$ROOT/packages/wasix-sysroot/build-incremental.sh"
