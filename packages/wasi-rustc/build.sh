#!/usr/bin/env bash
# RETIRED from ladder: do not build or OIDC-publish the 1.83 oligamiq spike.
# Certified rustc/cargo come from .github/workflows/wasi-rustc-stable.yml
# artifacts after browser certification.
set -euo pipefail
echo "homescoop: packages/wasi-rustc is retired (builder: retired)." >&2
echo "homescoop: do not build or publish from ladder / host-run." >&2
echo "homescoop: use wasi-rustc-stable.yml, then publish the certified tarball." >&2
exit 1
