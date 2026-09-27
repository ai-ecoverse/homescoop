#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
HOMESCOOP_PKG="$ROOT/packages/coreutils"
NAME=coreutils
VERSION=9.7
SRC_URL=https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.xz
SRC_SHA=e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf
# shellcheck source=../../scripts/build-gnu-cli.sh
source "$ROOT/scripts/build-gnu-cli.sh"
