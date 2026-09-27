#!/usr/bin/env bash
# cmake — not implemented yet (see recipe notes / ladder rung_cmake).
# When implemented: link with LDFLAGS="$(homescoop_em_cli_ldflags)" from
# scripts/build-common.sh so slicc's wasm realm can load bin/cmake{.wasm}.
echo "homescoop: packages/cmake/build.sh not implemented (builder: slicc; needs slicc spawn + patches)" >&2
exit 1
