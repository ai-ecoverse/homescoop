#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
HOMESCOOP_PKG="$ROOT/packages/sed"
NAME=sed
VERSION=4.9
SRC_URL=https://ftp.gnu.org/gnu/sed/sed-4.9.tar.xz
SRC_SHA=6e226b732e1cd739464ad6862bd1a1aba42d7982922da7a53519631d24975181
# shellcheck source=../../scripts/build-gnu-cli.sh
source "$ROOT/scripts/build-gnu-cli.sh"
