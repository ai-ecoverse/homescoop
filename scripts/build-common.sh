#!/usr/bin/env bash
# Shared helpers for host build.sh scripts. Source from packages/*/build.sh.
# Expects HOMESCOOP_ROOT; sets WORK and PREFIX defaults.
set -euo pipefail

: "${HOMESCOOP_ROOT:?HOMESCOOP_ROOT required}"
WORK="${HOMESCOOP_WORK:-${TMPDIR:-/tmp}/homescoop-work}"
PREFIX="${PREFIX:-${TMPDIR:-/tmp}/homescoop-prefix}"
mkdir -p "$WORK" "$PREFIX/lib" "$PREFIX/include"

# Load recipe.yaml into the environment (VERSION, SRC_URL, SRC_SHA, …).
# Optional: homescoop_load_recipe <name> [--source <key>]
homescoop_load_recipe() {
  local name="${1:?homescoop_load_recipe <package>}"
  shift || true
  # shellcheck disable=SC1090
  eval "$(node "$HOMESCOOP_ROOT/scripts/recipe-env.mjs" "$name" "$@")"
  : "${HOMESCOOP_PKG:?}" "${VERSION:?}"
  # Primary load must export SRC_URL/SRC_SHA; secondary loads only PREFIX_* vars.
  if [[ "$*" != *"--source"* ]]; then
    : "${SRC_URL:?}" "${SRC_SHA:?}"
  fi
}

# Apply every packages/<name>/*.patch once into <srcdir>.
homescoop_apply_patches() {
  local srcdir="${1:?}"
  local dir="${HOMESCOOP_PKG:?}"
  local p marker
  shopt -s nullglob
  for p in "$dir"/*.patch; do
    marker="$srcdir/.homescoop-patched-$(basename "$p")"
    if [[ -f "$marker" ]]; then
      continue
    fi
    echo "== patch $(basename "$p")"
    patch -d "$srcdir" -p1 < "$p"
    touch "$marker"
  done
  shopt -u nullglob
}

# Copy the first existing upstream license file into package/LICENSE (+ PREFIX).
# homescoop_stage_license <candidate...>
homescoop_stage_license() {
  local dest="$HOMESCOOP_PKG/package/LICENSE"
  local f
  mkdir -p "$HOMESCOOP_PKG/package"
  for f in "$@"; do
    if [[ -f "$f" ]]; then
      cp "$f" "$dest"
      echo "== license ← $f"
      return 0
    fi
  done
  if [[ -f "$dest" ]]; then
    echo "== license: keeping existing package/LICENSE"
    return 0
  fi
  echo "homescoop_stage_license: no LICENSE/COPYING found among: $*" >&2
  return 1
}

homescoop_fetch() {
  # homescoop_fetch <url> <sha256> <tarball-path>
  local url="$1" sha="$2" tarball="$3"
  if [[ ! -f "$tarball" ]]; then
    echo "== fetch $url"
    curl -fsSL "$url" -o "$tarball"
  fi
  echo "$sha  $tarball" | shasum -a 256 -c -
}

homescoop_extract() {
  # homescoop_extract <tarball> <srcdir> — extract once unless FORCE
  local tarball="$1" srcdir="$2"
  if [[ -d "$srcdir" && -z "${FORCE:-}" ]]; then
    echo "== have source $srcdir"
    return 0
  fi
  rm -rf "$srcdir"
  mkdir -p "$(dirname "$srcdir")"
  case "$tarball" in
    *.tar.xz|*.txz) tar xJf "$tarball" -C "$(dirname "$srcdir")" ;;
    *.tar.bz2|*.tbz2) tar xjf "$tarball" -C "$(dirname "$srcdir")" ;;
    *.zip) unzip -q "$tarball" -d "$(dirname "$srcdir")" ;;
    *) tar xzf "$tarball" -C "$(dirname "$srcdir")" ;;
  esac
}

homescoop_stage_lib() {
  # homescoop_stage_lib <src.a> <dest-name.a>
  local src="$1" name="$2"
  local dest="$HOMESCOOP_PKG/package/lib"
  mkdir -p "$dest" "$PREFIX/lib"
  cp "$src" "$dest/$name"
  cp "$src" "$PREFIX/lib/$name"
}

homescoop_stage_headers() {
  # homescoop_stage_headers <file...> — copy into package/include and PREFIX
  local dest="$HOMESCOOP_PKG/package/include"
  mkdir -p "$dest" "$PREFIX/include"
  local f
  for f in "$@"; do
    cp "$f" "$dest/$(basename "$f")"
    cp "$f" "$PREFIX/include/$(basename "$f")"
  done
}

homescoop_fix_darwin_ar() {
  # macOS configure often sets AR=libtool ARFLAGS=-o, which cannot archive
  # wasm objects (empty .a). Force emar/rcs when that pattern is present.
  local mf="${1:-Makefile}"
  if [[ -f "$mf" ]] && grep -q '^AR=libtool$' "$mf" 2>/dev/null; then
    echo "== patch $mf: AR=libtool → emar"
    perl -i -pe 's/^AR=libtool$/AR=emar/; s/^ARFLAGS=-o$/ARFLAGS=rcs/' "$mf"
  fi
}

homescoop_require_lib_size() {
  local f="$1" min="${2:-10000}"
  local sz
  sz=$(wc -c < "$f" | tr -d ' ')
  if [[ "$sz" -lt "$min" ]]; then
    echo "homescoop: $f too small ($sz bytes; expected >= $min)" >&2
    exit 1
  fi
  echo "$sz"
}

# Link flags for Emscripten CLI tools consumed by slicc's wasm realm
# (plain DedicatedWorker + node-realm run-tool.js). Libraries do not need these.
# Optional extras via HOMESCOOP_EM_CLI_LDFLAGS_EXTRA (e.g. -sSTACK_SIZE=1MB).
# Usage: LDFLAGS="$(homescoop_em_cli_ldflags)" emconfigure ./configure …
homescoop_em_cli_ldflags() {
  local extra="${HOMESCOOP_EM_CLI_LDFLAGS_EXTRA:-}"
  # shellcheck disable=SC2086
  printf '%s' "-sENVIRONMENT=web,worker,node -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1${extra:+ ${extra}}"
}

homescoop_slicc_dir() {
  echo "${HOMESCOOP_ROOT}/shims/slicc"
}

# Compile selected slicc shims into an archive for LDFLAGS/LIBS.
# Every profile includes slicc_signals.c + slicc_libc_gaps.c.
# Usage: homescoop_slicc_archive <out.a> gaps|spawn|make|fork|less|cli|net|netfork
homescoop_slicc_archive() {
  local out="$1" profile="${2:-gaps}"
  local dir odir src base
  local -a objs=()
  dir="$(homescoop_slicc_dir)"
  odir="$(dirname "$out")/slicc-objs-${profile}"
  mkdir -p "$(dirname "$out")" "$odir"
  _homescoop_slicc_compile() {
    src="$1"
    base=$(basename "$src" .c)
    echo "== slicc shim: emcc -c $(basename "$src")"
    emcc -O2 -c "$src" -o "$odir/$base.o"
    objs+=("$odir/$base.o")
  }
  case "$profile" in
    gaps)
      _homescoop_slicc_compile "$dir/slicc_libc_gaps.c"
      _homescoop_slicc_compile "$dir/slicc_signals.c"
      ;;
    spawn)
      _homescoop_slicc_compile "$dir/slicc_spawn.c"
      _homescoop_slicc_compile "$dir/slicc_exec.c"
      _homescoop_slicc_compile "$dir/slicc_libc_gaps.c"
      _homescoop_slicc_compile "$dir/slicc_signals.c"
      ;;
    make)
      # pselect via slicc_select (jobserver / make -jN); Emscripten libc has none.
      # slicc_jobs is harmless here (pgid/sid/tc*pgrp for the jobserver path).
      _homescoop_slicc_compile "$dir/slicc_spawn.c"
      _homescoop_slicc_compile "$dir/slicc_exec.c"
      _homescoop_slicc_compile "$dir/slicc_main_envp.c"
      _homescoop_slicc_compile "$dir/slicc_libc_gaps.c"
      _homescoop_slicc_compile "$dir/slicc_signals.c"
      _homescoop_slicc_compile "$dir/slicc_select.c"
      _homescoop_slicc_compile "$dir/slicc_jobs.c"
      ;;
    fork)
      # bash job control + ASYNCIFY: fork/spawn/exec/jobs, and select/poll so
      # readline's blocking poll goes through the kernel (not Asyncify FS waits).
      _homescoop_slicc_compile "$dir/slicc_spawn.c"
      _homescoop_slicc_compile "$dir/slicc_exec.c"
      _homescoop_slicc_compile "$dir/slicc_fork.c"
      _homescoop_slicc_compile "$dir/slicc_libc_gaps.c"
      _homescoop_slicc_compile "$dir/slicc_signals.c"
      _homescoop_slicc_compile "$dir/slicc_jobs.c"
      _homescoop_slicc_compile "$dir/slicc_select.c"
      ;;
    less)
      # TUI pager: signals + gaps + jobs + pselect (no spawn).
      _homescoop_slicc_compile "$dir/slicc_libc_gaps.c"
      _homescoop_slicc_compile "$dir/slicc_signals.c"
      _homescoop_slicc_compile "$dir/slicc_jobs.c"
      _homescoop_slicc_compile "$dir/slicc_select.c"
      ;;
    cli)
      # Interactive / pipeline CLIs (sqlite3, tar, …): spawn+exec+select+jobs.
      # No fork/ASYNCIFY — that stays bash-only.
      _homescoop_slicc_compile "$dir/slicc_spawn.c"
      _homescoop_slicc_compile "$dir/slicc_exec.c"
      _homescoop_slicc_compile "$dir/slicc_libc_gaps.c"
      _homescoop_slicc_compile "$dir/slicc_signals.c"
      _homescoop_slicc_compile "$dir/slicc_select.c"
      _homescoop_slicc_compile "$dir/slicc_jobs.c"
      ;;
    net)
      # curl / git-remote-http: BSD sockets (slicc_socket) + select/poll +
      # spawn/exec for helpers. Link with whole-archive so socket syscalls win.
      _homescoop_slicc_compile "$dir/slicc_socket.c"
      _homescoop_slicc_compile "$dir/slicc_select.c"
      _homescoop_slicc_compile "$dir/slicc_spawn.c"
      _homescoop_slicc_compile "$dir/slicc_exec.c"
      _homescoop_slicc_compile "$dir/slicc_libc_gaps.c"
      _homescoop_slicc_compile "$dir/slicc_signals.c"
      _homescoop_slicc_compile "$dir/slicc_getpass.c"
      ;;
    netfork)
      # git: sockets + fork/ASYNCIFY so clone/remote helpers can fork+exec.
      _homescoop_slicc_compile "$dir/slicc_socket.c"
      _homescoop_slicc_compile "$dir/slicc_select.c"
      _homescoop_slicc_compile "$dir/slicc_spawn.c"
      _homescoop_slicc_compile "$dir/slicc_exec.c"
      _homescoop_slicc_compile "$dir/slicc_fork.c"
      _homescoop_slicc_compile "$dir/slicc_libc_gaps.c"
      _homescoop_slicc_compile "$dir/slicc_signals.c"
      _homescoop_slicc_compile "$dir/slicc_jobs.c"
      _homescoop_slicc_compile "$dir/slicc_getpass.c"
      ;;
    *)
      echo "homescoop_slicc_archive: unknown profile '$profile' (gaps|spawn|make|fork|less|cli|net|netfork)" >&2
      return 1
      ;;
  esac
  rm -f "$out"
  emar rcs "$out" "${objs[@]}"
  echo "== slicc shim: $out ($profile)"
}

# Force signal exports out of the archive (wasm realm calls them from JS).
# For fork/cli/spawn/make profiles, also call homescoop_slicc_keep_spawn
# *before* the .a so wait4/execve are not left as libc ENOSYS stubs.
homescoop_slicc_keep_exports() {
  printf '%s' "-Wl,-u,slicc_raise -Wl,-u,slicc_sig_mask -Wl,-u,slicc_sigpipe"
}

# Force spawn/exec/wait4 out of the archive (fork|cli|spawn|make profiles).
# Must appear on the link line *before* the slicc .a. Prefer wrapping the
# archive with homescoop_slicc_link_archive (whole-archive): -u alone is not
# enough for execve — emscripten libstubs.a ships a weak execve stub, and
# archive member extraction can leave that stub as the winner.
homescoop_slicc_keep_spawn() {
  printf '%s' "-Wl,-u,__syscall_wait4 -Wl,-u,execve -Wl,-u,slicc_spawn_capture"
}

# LDFLAGS fragment: keep exports + whole-archive around a slicc .a.
# Usage: LDFLAGS="$(homescoop_slicc_link_archive "$SLICC_A") $(homescoop_em_cli_ldflags)"
homescoop_slicc_link_archive() {
  local archive="$1"
  printf '%s' "$(homescoop_slicc_keep_exports) $(homescoop_slicc_keep_spawn) -Wl,--whole-archive ${archive} -Wl,--no-whole-archive"
}

# Extra link flags for the fork js-library (bash). Pair with profile fork.
homescoop_slicc_fork_js_flags() {
  local dir
  dir="$(homescoop_slicc_dir)"
  printf '%s' "--js-library ${dir}/slicc-fork.js -sASYNCIFY -sASYNCIFY_STACK_SIZE=1048576"
}

# Stage an Emscripten CLI binary pair into package/bin and PREFIX/bin.
# Prefer bare <name> (slicc.commands glue path) over <name>.js when both exist.
homescoop_stage_cli() {
  local srcdir="$1" name="$2"
  local dest="$HOMESCOOP_PKG/package/bin"
  mkdir -p "$dest" "$PREFIX/bin"
  # Drop stale glue from prior builds so npm pack does not ship both forms.
  rm -f "$dest/$name" "$dest/$name.js" "$dest/$name.wasm"
  if [[ -f "$srcdir/$name" ]]; then
    cp "$srcdir/$name" "$dest/$name"
    cp "$srcdir/$name" "$PREFIX/bin/$name"
  elif [[ -f "$srcdir/$name.js" ]]; then
    cp "$srcdir/$name.js" "$dest/$name"
    cp "$srcdir/$name.js" "$PREFIX/bin/$name"
  fi
  if [[ -f "$srcdir/$name.wasm" ]]; then
    cp "$srcdir/$name.wasm" "$dest/$name.wasm"
    cp "$srcdir/$name.wasm" "$PREFIX/bin/$name.wasm"
  fi
}

# Write a relocatable .pc into package/lib/pkgconfig and PREFIX.
# Uses ${pcfiledir} so consumers can stage the package tree anywhere.
# homescoop_write_pc <pc-name> <version> <libs> [requires] [extra-cflags]
#   libs e.g. "-ljpeg" or "-lpng16 -lz"
homescoop_write_pc() {
  local name="$1" version="$2" libs="$3" requires="${4:-}" extra_cflags="${5:-}"
  local dest_pkg="$HOMESCOOP_PKG/package/lib/pkgconfig"
  local dest_pfx="$PREFIX/lib/pkgconfig"
  mkdir -p "$dest_pkg" "$dest_pfx"
  local body
  body=$(cat <<EOF
prefix=\${pcfiledir}/../..
exec_prefix=\${prefix}
libdir=\${prefix}/lib
includedir=\${prefix}/include

Name: ${name}
Description: ${name} (homescoop wasm / emscripten)
Version: ${version}
Requires: ${requires}
Cflags: -I\${includedir}${extra_cflags:+ }${extra_cflags}
Libs: -L\${libdir} ${libs}
EOF
)
  printf '%s\n' "$body" >"$dest_pkg/${name}.pc"
  printf '%s\n' "$body" >"$dest_pfx/${name}.pc"
}

# Write missing .pc files into PREFIX for staged static libs (npm deps often
# ship lib/*.a + include/ without pkgconfig/). Used by ImageMagick configure.
homescoop_ensure_prefix_pcs() {
  local pfx="${PREFIX:?}"
  local pcdir="$pfx/lib/pkgconfig"
  mkdir -p "$pcdir"

  # args: <pc-name> <archive-basename> <Libs flags> [Requires]
  _ensure_one() {
    local pc="$1" archive="$2" libs="$3" requires="${4:-}"
    local dest="$pcdir/${pc}.pc"
    if [[ -f "$dest" ]]; then
      return 0
    fi
    if [[ ! -f "$pfx/lib/${archive}" ]]; then
      return 0
    fi
    cat >"$dest" <<EOF
prefix=${pfx}
exec_prefix=\${prefix}
libdir=\${prefix}/lib
includedir=\${prefix}/include

Name: ${pc}
Description: ${pc} (homescoop wasm / emscripten, synthesized)
Version: 0
Requires: ${requires}
Cflags: -I\${includedir}
Libs: -L\${libdir} ${libs}
EOF
    echo "== ensure-pc: $dest"
  }

  _ensure_one zlib libz.a "-lz"
  _ensure_one libjpeg libjpeg.a "-ljpeg"
  _ensure_one libpng libpng16.a "-lpng16" "zlib"
  # unversioned alias some consumers probe
  if [[ -f "$pfx/lib/libpng.a" && ! -f "$pcdir/libpng.pc" ]]; then
    _ensure_one libpng libpng.a "-lpng" "zlib"
  fi
  _ensure_one lcms2 liblcms2.a "-llcms2"
  _ensure_one libtiff-4 libtiff.a "-ltiff" "zlib libjpeg"
  _ensure_one libwebp libwebp.a "-lwebp"
  _ensure_one libwebpmux libwebpmux.a "-lwebpmux" "libwebp"
  _ensure_one libwebpdemux libwebpdemux.a "-lwebpdemux" "libwebp"
  _ensure_one libopenjp2 libopenjp2.a "-lopenjp2"
  _ensure_one freetype2 libfreetype.a "-lfreetype"
  _ensure_one libxml-2.0 libxml2.a "-lxml2"
}

# Ship .pyc next to .py (unchecked-hash) so WASIX imports skip recompile.
# Host CPython must share wasix-python's magic (3.14.x). Last build step.
# Usage: homescoop_compile_pyc <dir> [<dir>…]
#   dirs = trees that contain .py (e.g. package/lib/python3.14/site-packages)
homescoop_compile_pyc() {
  local HOST_PY="${WASIX_PYTHON_HOST_PY:-}"
  local root stale=0 py dir base pyc cand
  if [[ -z "$HOST_PY" ]]; then
    if command -v python3.14 >/dev/null 2>&1; then
      HOST_PY=$(command -v python3.14)
    else
      HOST_PY=$(command -v python3)
    fi
  fi
  if [[ $# -lt 1 ]]; then
    echo "homescoop_compile_pyc: need at least one directory" >&2
    return 1
  fi
  for root in "$@"; do
    if [[ ! -d "$root" ]]; then
      echo "homescoop_compile_pyc: not a directory: $root" >&2
      return 1
    fi
    echo "== compileall (unchecked-hash): $root"
    find "$root" -type d -name '__pycache__' -prune -exec rm -rf {} +
    "$HOST_PY" -m compileall -q -j0 --invalidation-mode unchecked-hash -d "$root" "$root"
  done
  for root in "$@"; do
    while IFS= read -r -d '' py; do
      dir=$(dirname "$py")
      base=$(basename "$py" .py)
      pyc=""
      for cand in "$dir/__pycache__/${base}".cpython-*.pyc; do
        if [[ -f "$cand" ]]; then pyc=$cand; break; fi
      done
      if [[ -z "$pyc" || "$py" -nt "$pyc" ]]; then
        echo "homescoop: stale/missing pyc for $py" >&2
        stale=1
      fi
    done < <(find "$root" -name '*.py' -print0)
  done
  if [[ "$stale" -ne 0 ]]; then
    return 1
  fi
}
