#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
HOMESCOOP_PKG="$ROOT/packages/grep"
NAME=grep
VERSION=3.12
SRC_URL=https://ftp.gnu.org/gnu/grep/grep-3.12.tar.xz
SRC_SHA=2649b27c0e90e632eadcd757be06c6e9a4f48d941de51e7c0f83ff76408a07b9
# shellcheck source=../../scripts/build-gnu-cli.sh
source "$ROOT/scripts/build-gnu-cli.sh"
