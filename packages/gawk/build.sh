#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
HOMESCOOP_PKG="$ROOT/packages/gawk"
NAME=gawk
VERSION=5.3.2
SRC_URL=https://ftp.gnu.org/gnu/gawk/gawk-5.3.2.tar.xz
SRC_SHA=f8c3486509de705192138b00ef2c00bbbdd0e84c30d5c07d23fc73a9dc4cc9cc
# shellcheck source=../../scripts/build-gnu-cli.sh
source "$ROOT/scripts/build-gnu-cli.sh"
