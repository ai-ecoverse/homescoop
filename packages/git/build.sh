#!/usr/bin/env bash
# Git 2.55.0 for slicc — local ops + HTTP(S) remotes via homescoop libcurl.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe git

TB="$WORK/git-${VER}.tar.xz"
SRC="$WORK/git-${VER}"

homescoop_fetch "$URL" "$SHA" "$TB"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC"; fi
homescoop_extract "$TB" "$SRC"

LIBCURL_A="$PREFIX/lib/libcurl.a"
test -f "$LIBCURL_A" || { echo "missing $LIBCURL_A (build wasm-curl first)" >&2; exit 1; }
for need in libmbedtls.a libmbedx509.a libmbedcrypto.a libeverest.a libp256m.a webcrypto-entropy.o libz.a; do
  test -f "$PREFIX/lib/$need" || { echo "missing PREFIX/lib/$need" >&2; exit 1; }
done
test -d "$PREFIX/include/curl" || { echo "missing curl headers in PREFIX" >&2; exit 1; }

SLICC_A="$WORK/libslicc-git.a"
homescoop_slicc_archive "$SLICC_A" netfork

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1048576 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain,sliccRunMain,sliccForkChild -sUSE_ZLIB=1 -lnodefs.js $(homescoop_slicc_fork_js_flags)"
CLI_LDFLAGS="$(homescoop_em_cli_ldflags)"
CURL_LDFLAGS="$LIBCURL_A $PREFIX/lib/webcrypto-entropy.o $PREFIX/lib/libmbedtls.a $PREFIX/lib/libmbedx509.a $PREFIX/lib/libmbedcrypto.a $PREFIX/lib/libeverest.a $PREFIX/lib/libp256m.a"
EXTLIBS="$(homescoop_slicc_link_archive "$SLICC_A") -sUSE_ZLIB=1"

JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

# Normalize prior .js → bare name so make sees rebuild needs.
normalize_em_bin() {
  local d="$1" n="$2"
  if [[ -f "$d/$n.js" && ! -f "$d/$n" ]]; then mv "$d/$n.js" "$d/$n"; fi
}

# Standalone wasm programs installed to libexec/git-core (not argv0 of git).
# git-http-push needs expat — skipped (NO_EXPAT). Remote ftp/ftps alias http.
STANDALONE_PROGS=(
  git-remote-http git-remote-https git-remote-ftp git-remote-ftps
  git-sh-i18n--envsubst
  git-imap-send
  git-http-fetch
  git-http-backend
  git-shell
  scalar
)

# Shared make knobs — fixed virtual prefix=/usr, no RUNTIME_PREFIX (realm has
# no /proc/self/exe; relocatable discovery aborts in system_prefix).
# SLICC sets GIT_EXEC_PATH / GIT_TEMPLATE_DIR via the package manifest.
GIT_MAKE_VARS=(
  uname_S=Emscripten
  CC=emcc AR=emar HOSTCC=cc CURL_CONFIG=/bin/false
  prefix=/usr
  gitexecdir=/usr/libexec/git-core
  template_dir=share/git-core/templates
  NO_RUST=YesPlease NO_OPENSSL=YesPlease NO_EXPAT=YesPlease
  NO_GETTEXT=YesPlease NO_ICONV=YesPlease NO_TCLTK=YesPlease
  NO_PERL=YesPlease NO_PYTHON=YesPlease NO_PTHREADS=YesPlease
  NO_UNIX_SOCKETS=YesPlease NO_MMAP=YesPlease NO_REGEX=NeedsStartEnd
  "CURL_CFLAGS=-I$PREFIX/include"
  "CURL_LDFLAGS=$CURL_LDFLAGS"
  CFLAGS="-O2 -sUSE_ZLIB=1 -I$PREFIX/include"
  "LDFLAGS=$CLI_LDFLAGS"
  "EXTLIBS=$EXTLIBS"
)

need_build=
for p in git "${STANDALONE_PROGS[@]}"; do
  if [[ ! -f "$SRC/$p.wasm" || ! -f "$SRC/$p" ]]; then need_build=1; break; fi
done
# Aliases may be hardlinks of glue only — still require primary wasm.
if [[ ! -f "$SRC/git-remote-http.wasm" || ! -f "$SRC/git-remote-http" ]]; then need_build=1; fi

if [[ -n "$need_build" || -n "${FORCE:-}" ]]; then
  echo "== git: emmake (git + libexec PROGRAMS + scalar)"
  (
    cd "$SRC"
    if [[ -n "${FORCE:-}" ]]; then
      make clean >/dev/null 2>&1 || true
    fi
    # shellcheck disable=SC2086
    emmake make -j"$JOBS" \
      git "${STANDALONE_PROGS[@]}" \
      "${GIT_MAKE_VARS[@]}"
  )
fi

normalize_em_bin "$SRC" git
for p in "${STANDALONE_PROGS[@]}"; do
  normalize_em_bin "$SRC" "$p"
done
# Aliases: make LN/CP often hardlinks only the glue, not .wasm.
for alias in git-remote-https git-remote-ftp git-remote-ftps; do
  if [[ ! -f "$SRC/$alias.wasm" && -f "$SRC/git-remote-http.wasm" ]]; then
    cp "$SRC/git-remote-http.wasm" "$SRC/$alias.wasm"
  fi
  if [[ ! -f "$SRC/$alias" && -f "$SRC/git-remote-http" ]]; then
    cp "$SRC/git-remote-http" "$SRC/$alias"
  fi
done
test -f "$SRC/git.wasm"
test -f "$SRC/git-remote-http.wasm"
test -f "$SRC/git-sh-i18n--envsubst.wasm"

echo "== git: stage bin + libexec helpers"
homescoop_stage_cli "$SRC" git

LIBEXEC="$HOMESCOOP_PKG/package/libexec/git-core"
BIN="$HOMESCOOP_PKG/package/bin"
mkdir -p "$LIBEXEC" "$BIN" "$PREFIX/libexec/git-core" "$PREFIX/bin"

# Shared wasm for argv0 builtins (glue always locateFile("git.wasm")).
cp "$SRC/git.wasm" "$LIBEXEC/git.wasm"
cp "$SRC/git.wasm" "$PREFIX/libexec/git-core/git.wasm"

# Standalone programs: own glue + .wasm under libexec (GIT_EXEC_PATH).
stage_standalone() {
  local name="$1"
  test -f "$SRC/$name" || { echo "missing $SRC/$name" >&2; exit 1; }
  test -f "$SRC/$name.wasm" || { echo "missing $SRC/$name.wasm" >&2; exit 1; }
  cp "$SRC/$name" "$LIBEXEC/$name"
  cp "$SRC/$name.wasm" "$LIBEXEC/$name.wasm"
  cp "$SRC/$name" "$PREFIX/libexec/git-core/$name"
  cp "$SRC/$name.wasm" "$PREFIX/libexec/git-core/$name.wasm"
  chmod 755 "$LIBEXEC/$name" "$PREFIX/libexec/git-core/$name"
}
for p in "${STANDALONE_PROGS[@]}"; do
  stage_standalone "$p"
done

# Also expose primary remotes + shell/scalar under bin/ for slicc.commands.
for name in git-remote-http git-remote-https git-shell scalar; do
  homescoop_stage_cli "$SRC" "$name"
  chmod 755 "$BIN/$name" "$PREFIX/bin/$name"
done

# Dash-command builtins are multi-call via the git binary — do NOT stage
# module-less glue under libexec (that shadows slicc.commands and breaks
# glue+module runtimes). Ship upload/receive-pack under bin/ with matching
# .wasm + argv0 in the package manifest.
for builtin in git-upload-pack git-receive-pack; do
  cp "$SRC/git" "$BIN/$builtin"
  cp "$SRC/git.wasm" "$BIN/$builtin.wasm"
  cp "$SRC/git" "$PREFIX/bin/$builtin"
  cp "$SRC/git.wasm" "$PREFIX/bin/$builtin.wasm"
  chmod 755 "$BIN/$builtin" "$PREFIX/bin/$builtin"
done
# Drop stale libexec copies from prior packaging revs.
rm -f \
  "$LIBEXEC"/git-upload-pack "$LIBEXEC"/git-receive-pack \
  "$LIBEXEC"/git-upload-archive "$LIBEXEC"/git-pack-objects \
  "$LIBEXEC"/git-index-pack "$LIBEXEC"/git-unpack-objects \
  "$LIBEXEC"/git-fetch-pack "$LIBEXEC"/git-rev-list \
  "$LIBEXEC"/git-bundle \
  "$PREFIX/libexec/git-core"/git-upload-pack \
  "$PREFIX/libexec/git-core"/git-receive-pack \
  "$PREFIX/libexec/git-core"/git-upload-archive \
  "$PREFIX/libexec/git-core"/git-pack-objects \
  "$PREFIX/libexec/git-core"/git-index-pack \
  "$PREFIX/libexec/git-core"/git-unpack-objects \
  "$PREFIX/libexec/git-core"/git-fetch-pack \
  "$PREFIX/libexec/git-core"/git-rev-list \
  "$PREFIX/libexec/git-core"/git-bundle

chmod 755 "$BIN/git" "$PREFIX/bin/git"

echo "== git: generate + stage shell-script commands (SCRIPT_SH + SCRIPT_LIB)"
# Host make only — generate-script.sh is sed, not wasm. SHELL_PATH=/bin/sh
# so #! resolves to realm bash. Skip perl/python helpers (NO_PERL/NO_PYTHON).
(
  cd "$SRC"
  # shellcheck disable=SC2086
  make build-sh-script git-sh-setup git-sh-i18n git-mergetool--lib \
    uname_S=Emscripten \
    prefix=/usr \
    gitexecdir=/usr/libexec/git-core \
    template_dir=share/git-core/templates \
    SHELL_PATH=/bin/sh \
    NO_PERL=YesPlease NO_PYTHON=YesPlease NO_TCLTK=YesPlease \
    NO_GETTEXT=YesPlease
)
for script in \
  git-difftool--helper git-filter-branch \
  git-merge-octopus git-merge-one-file git-merge-resolve \
  git-mergetool git-quiltimport git-request-pull \
  git-submodule git-web--browse \
  git-sh-setup git-sh-i18n git-mergetool--lib
do
  test -f "$SRC/$script" || { echo "missing generated script $script" >&2; exit 1; }
  cp "$SRC/$script" "$LIBEXEC/$script"
  cp "$SRC/$script" "$PREFIX/libexec/git-core/$script"
  # SCRIPT_SH are executables; SCRIPT_LIB are sourced (0644 upstream).
  case "$script" in
    git-sh-setup|git-sh-i18n|git-mergetool--lib) chmod 644 "$LIBEXEC/$script" "$PREFIX/libexec/git-core/$script" ;;
    *) chmod 755 "$LIBEXEC/$script" "$PREFIX/libexec/git-core/$script" ;;
  esac
done
# Refuse build-machine paths leaking into scripts.
if grep -R -E '/Users/|/var/folders/|/tmp/homescoop' \
  "$LIBEXEC"/git-submodule "$LIBEXEC"/git-sh-setup "$LIBEXEC"/git-sh-i18n \
  "$LIBEXEC"/git-mergetool "$LIBEXEC"/git-mergetool--lib 2>/dev/null
then
  echo "homescoop: host path leaked into git shell scripts" >&2
  exit 1
fi

echo "== git: stage share/git-core/templates"
TEMPLATES_DST="$HOMESCOOP_PKG/package/share/git-core/templates"
rm -rf "$TEMPLATES_DST"
mkdir -p "$TEMPLATES_DST"
(
  cd "$SRC/templates"
  # Produce blt/ with #! rewritten to /bin/sh (realm bash).
  make clean >/dev/null 2>&1 || true
  make SHELL_PATH=/bin/sh prefix=/usr template_instdir=share/git-core/templates
  (cd blt && tar cf - .) | (cd "$TEMPLATES_DST" && tar xf -)
)
test -f "$TEMPLATES_DST/description"
test -f "$TEMPLATES_DST/info/exclude"

# Refuse build-machine absolute paths in the wasm (prefix=/usr is OK).
if strings "$HOMESCOOP_PKG/package/bin/git.wasm" | grep -E '/Users/|/home/|/var/folders/|/tmp/homescoop'
then
  echo "homescoop: host path leaked into git.wasm" >&2
  exit 1
fi
if strings "$LIBEXEC/git-sh-i18n--envsubst.wasm" | grep -E '/Users/|/home/'
then
  echo "homescoop: host path leaked into git-sh-i18n--envsubst.wasm" >&2
  exit 1
fi

homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE
homescoop_notices_begin "The git wasm modules statically link the following."
homescoop_notice "curl / libcurl 8.22.0 (@ai-ecoverse/wasm-curl)" \
  https://raw.githubusercontent.com/curl/curl/curl-8_22_0/COPYING 82f2f4427d6545ee5aaac4f0b80428da6cc8ba41c2cf5da3a03680ec327b9681
homescoop_notice "Mbed TLS 3.6.5 (via @ai-ecoverse/wasm-curl; with Everest and p256-m)" \
  https://raw.githubusercontent.com/Mbed-TLS/mbedtls/mbedtls-3.6.5/LICENSE 9b405ef4c89342f5eae1dd828882f931747f71001cfba7d114801039b52ad09b \
  https://raw.githubusercontent.com/Mbed-TLS/mbedtls/mbedtls-3.6.5/3rdparty/everest/README.md 96a16739f1453480c84b1c787f0d48ea15c1d307af0a2e9baea4d98b0f1d83f2 \
  https://raw.githubusercontent.com/Mbed-TLS/mbedtls/mbedtls-3.6.5/3rdparty/p256-m/README.md 9708f7be7a7775254eacf8d7b3b2961e0905d203bda67c8be95e61c471664e39
homescoop_notice "zlib 1.3.1 (emscripten port via -sUSE_ZLIB; same release as @ai-ecoverse/wasm-zlib)" \
  https://raw.githubusercontent.com/madler/zlib/v1.3.1/LICENSE 845efc77857d485d91fb3e0b884aaa929368c717ae8186b66fe1ed2495753243
homescoop_notice_emscripten
echo "== git: staged → $HOMESCOOP_PKG/package"
