#!/usr/bin/env bash
set -euo pipefail
exec "$(cd "$(dirname "$0")/../.." && pwd)/scripts/build-wasip1-go-command.sh" wasi-okf
