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

if [[ ! -f "$SRC/git.wasm" || ! -f "$SRC/git-remote-http.wasm" || -n "${FORCE:-}" ]]; then
  echo "== git: emmake (git + git-remote-http/https)"
  (
    cd "$SRC"
    # Fresh objects when FORCE; otherwise incremental.
    if [[ -n "${FORCE:-}" ]]; then
      make clean >/dev/null 2>&1 || true
    fi
    # Relocatable install layout: never bake $(HOME) into the wasm. Relative
    # gitexecdir/template_dir + RUNTIME_PREFIX; SLICC also sets GIT_* via env.
    # shellcheck disable=SC2086
    emmake make -j"$JOBS" git git-remote-http git-remote-https \
      uname_S=Emscripten \
      CC=emcc AR=emar HOSTCC=cc CURL_CONFIG=/bin/false \
      prefix=/ \
      gitexecdir=libexec/git-core \
      template_dir=share/git-core/templates \
      RUNTIME_PREFIX=YesPlease \
      NO_RUST=YesPlease NO_OPENSSL=YesPlease NO_EXPAT=YesPlease \
      NO_GETTEXT=YesPlease NO_ICONV=YesPlease NO_TCLTK=YesPlease \
      NO_PERL=YesPlease NO_PYTHON=YesPlease NO_PTHREADS=YesPlease \
      NO_UNIX_SOCKETS=YesPlease NO_MMAP=YesPlease NO_REGEX=NeedsStartEnd \
      "CURL_CFLAGS=-I$PREFIX/include" \
      "CURL_LDFLAGS=$CURL_LDFLAGS" \
      CFLAGS="-O2 -sUSE_ZLIB=1 -I$PREFIX/include" \
      "LDFLAGS=$CLI_LDFLAGS" \
      "EXTLIBS=$EXTLIBS"
  )
fi

normalize_em_bin "$SRC" git
normalize_em_bin "$SRC" git-remote-http
normalize_em_bin "$SRC" git-remote-https
# Git's LN/CP for git-remote-https often hardlinks only the glue, not .wasm.
if [[ ! -f "$SRC/git-remote-https.wasm" && -f "$SRC/git-remote-http.wasm" ]]; then
  cp "$SRC/git-remote-http.wasm" "$SRC/git-remote-https.wasm"
fi
test -f "$SRC/git.wasm"
test -f "$SRC/git-remote-http.wasm"
test -f "$SRC/git-remote-https.wasm"

echo "== git: stage bin + libexec helpers"
homescoop_stage_cli "$SRC" git
homescoop_stage_cli "$SRC" git-remote-http
homescoop_stage_cli "$SRC" git-remote-https

LIBEXEC="$HOMESCOOP_PKG/package/libexec/git-core"
BIN="$HOMESCOOP_PKG/package/bin"
mkdir -p "$LIBEXEC" "$BIN" "$PREFIX/libexec/git-core" "$PREFIX/bin"

# Shared wasm for argv0 builtins (glue always locateFile("git.wasm")).
cp "$SRC/git.wasm" "$LIBEXEC/git.wasm"
cp "$SRC/git.wasm" "$PREFIX/libexec/git-core/git.wasm"
for helper in git-remote-http git-remote-https; do
  cp "$SRC/$helper" "$LIBEXEC/$helper"
  cp "$SRC/$helper.wasm" "$LIBEXEC/$helper.wasm"
  cp "$SRC/$helper" "$PREFIX/libexec/git-core/$helper"
  cp "$SRC/$helper.wasm" "$PREFIX/libexec/git-core/$helper.wasm"
done

# Dash-command builtins: glue looks up git.wasm beside it; also ship under
# bin/ for the slicc.commands entries (upload/receive-pack).
for builtin in \
  git-upload-pack git-receive-pack git-upload-archive \
  git-pack-objects git-index-pack git-unpack-objects \
  git-fetch-pack git-rev-list git-bundle
do
  cp "$SRC/git" "$LIBEXEC/$builtin"
  cp "$SRC/git" "$PREFIX/libexec/git-core/$builtin"
done
for builtin in git-upload-pack git-receive-pack; do
  cp "$SRC/git" "$BIN/$builtin"
  cp "$SRC/git.wasm" "$BIN/$builtin.wasm"
  cp "$SRC/git" "$PREFIX/bin/$builtin"
  cp "$SRC/git.wasm" "$PREFIX/bin/$builtin.wasm"
done

echo "== git: generate + stage shell-script commands (SCRIPT_SH + SCRIPT_LIB)"
# Host make only — generate-script.sh is sed, not wasm. SHELL_PATH=/bin/sh
# so #! resolves to realm bash. Skip perl/python helpers (NO_PERL/NO_PYTHON).
(
  cd "$SRC"
  # shellcheck disable=SC2086
  make build-sh-script git-sh-setup git-sh-i18n git-mergetool--lib \
    uname_S=Emscripten \
    prefix=/ \
    gitexecdir=libexec/git-core \
    template_dir=share/git-core/templates \
    RUNTIME_PREFIX=YesPlease \
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
  make SHELL_PATH=/bin/sh prefix=/ template_instdir=share/git-core/templates
  (cd blt && tar cf - .) | (cd "$TEMPLATES_DST" && tar xf -)
)
test -f "$TEMPLATES_DST/description"
test -f "$TEMPLATES_DST/info/exclude"

homescoop_stage_license "$SRC"/COPYING "$SRC"/LICENSE
echo "== git: staged → $HOMESCOOP_PKG/package"
