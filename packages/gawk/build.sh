#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe gawk
# /inet/tcp/... special files need the socket shim (#140/#149).
export HOMESCOOP_SLICC_PROFILE=clinet
# shellcheck source=../../scripts/build-gnu-cli.sh
source "$ROOT/scripts/build-gnu-cli.sh"
homescoop_notices_begin "gawk.wasm statically links the following."
homescoop_notice_emscripten
