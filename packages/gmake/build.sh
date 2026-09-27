#!/usr/bin/env bash
# gmake — not implemented yet (see recipe notes / ladder rung_gmake).
# When implemented: link with LDFLAGS="$(homescoop_em_cli_ldflags)" from
# scripts/build-common.sh so slicc's wasm realm can load bin/make{.wasm}.
echo "homescoop: packages/gmake/build.sh not implemented (builder: slicc; needs slicc spawn glue)" >&2
exit 1
