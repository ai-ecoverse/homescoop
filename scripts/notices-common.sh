# shellcheck shell=bash
# THIRD-PARTY-NOTICES.md templates for the libc a wasm links statically
# (homescoop#684, #713). Source after scripts/build-common.sh (it uses
# homescoop_notice), and list scripts/notices-common.sh in the recipe's
# inputs:, so a change here rebuilds exactly the packages that use it:
#
#   source "$HOMESCOOP_ROOT/scripts/notices-common.sh"
#   homescoop_notices_begin "m4.wasm statically links the following."
#   homescoop_notice_wasix_libc
#
# scripts/test/third-party-notices.test.mjs counts a call as naming
# wasix-libc.

# wasix-libc, as @ai-ecoverse/wasix-sysroot ships it (musl, cloudlibc,
# wasi-libc's own code). The sysroot is a 2025-09-30 snapshot of
# wasix-libc, so the licence files are pinned at the nearest earlier tag.
#   homescoop_notice_wasix_libc [<sysroot prefix>]
# The prefix holds the sysroot's package.json (install-wasixcc.sh exports it
# as WASIXCC_SYSROOT_PREFIX).
homescoop_notice_wasix_libc() {
  local prefix="${1:-${WASIXCC_SYSROOT_PREFIX:-${WASIXCC_HOME:-$HOME/.wasixcc}/sysroot}}" ver
  test -f "$prefix/package.json" || {
    echo "homescoop_notice_wasix_libc: no $prefix/package.json (pass the wasix-sysroot prefix)" >&2
    return 1
  }
  ver="$(node -p "require(process.argv[1]).version" "$prefix/package.json")"
  local wl=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2025-09-02.1
  homescoop_notice "wasix-libc (@ai-ecoverse/wasix-sysroot $ver; files from tag v2025-09-02.1)" \
    "$wl/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
    "$wl/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5 \
    "$wl/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
    "$wl/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af \
    "$wl/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0
}
