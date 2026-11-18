#!/usr/bin/env bash
# cffi-wasix.sh: build cffi API-mode (out-of-line) extensions for wasix-python.
#
# Source it from a recipe's build.sh (after build-common.sh, install-wasixcc.sh
# and the wasix-python headers are in place); packages/py-cffi/package/README.md
# has the walkthrough. Three steps, each a function:
#
#   homescoop_cffi_host <dir>
#       Fetches the cffi sdist and the pycparser wheel that packages/py-cffi
#       and packages/py-pycparser pin (their recipe.yaml source), unpacks them
#       into <dir>, and exports CFFI_HOST_PATH: the directories to put on the
#       host python's sys.path. The cffi used for codegen is then the cffi
#       py-cffi ships, so the generated C and the runtime _cffi_backend match.
#
#   homescoop_cffi_emit <script.py>[:<var>] <out.c> [--path <dir>]... [--chdir <dir>]
#       Runs the ffibuilder script on a host python3 (HOMESCOOP_CFFI_HOST_PY,
#       default python3; any CPython >= 3.11 with ctypes) through
#       scripts/cffi-emit.py, which uses cffi's ctypes backend, so nothing is
#       compiled for the host, and writes the C that set_source() describes.
#
#   homescoop_cffi_ext <out.so> <module.c> [extra wasixcc args]...
#       Compiles and links the generated C as a wasix-python side module
#       (dylink.0, PIC, legacy wasm EH) against CFFI_WASIX_PYINC, the
#       include/python3.X of the wasix-python tarball the recipe builds
#       against. Extra args go to both steps: -I, -D, -L, -l, static .a
#       archives. Symbols left undefined (Py*, libc, and whatever python.wasm
#       exports, e.g. OpenSSL and zlib) are resolved by the loader at dlopen.
#       Name <out.so> <module>.cpython-3XX-wasm32-wasix.so.
#
# Inputs: a recipe that sources this declares `inputs:` scripts/cffi-wasix.sh,
# scripts/cffi-emit.py, packages/py-cffi/recipe.yaml and
# packages/py-pycparser/recipe.yaml, so a cffi or pycparser bump rebuilds it.

homescoop_cffi__pin() {
  # The source.url and source.sha256 of another recipe, without touching the
  # caller's recipe variables.
  (
    eval "$(node "$HOMESCOOP_ROOT/scripts/recipe-env.mjs" "$1")"
    printf '%s %s %s\n' "$SRC_URL" "$SRC_SHA" "$VERSION"
  )
}

homescoop_cffi_host() {
  local dir="${1:?homescoop_cffi_host <dir>}" url sha ver
  : "${HOMESCOOP_ROOT:?homescoop_cffi_host: source scripts/build-common.sh first}"
  rm -rf "$dir" && mkdir -p "$dir/dl" "$dir/path"
  read -r url sha ver < <(homescoop_cffi__pin py-cffi)
  homescoop_fetch "$url" "$sha" "$dir/dl/$(basename "$url")"
  tar xzf "$dir/dl/$(basename "$url")" -C "$dir"
  test -f "$dir/cffi-$ver/src/cffi/__init__.py" || { echo "homescoop_cffi_host: no src/cffi in cffi-$ver" >&2; return 1; }
  cp -R "$dir/cffi-$ver/src/cffi" "$dir/path/cffi"
  export CFFI_HOST_SRC="$dir/cffi-$ver" CFFI_HOST_VERSION="$ver"
  read -r url sha ver < <(homescoop_cffi__pin py-pycparser)
  homescoop_fetch "$url" "$sha" "$dir/dl/$(basename "$url")"
  "${HOMESCOOP_CFFI_HOST_PY:-python3}" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' \
    "$dir/dl/$(basename "$url")" "$dir/path"
  test -f "$dir/path/pycparser/__init__.py" || { echo "homescoop_cffi_host: no pycparser in the wheel" >&2; return 1; }
  export CFFI_HOST_PATH="$dir/path"
  echo "== cffi-wasix: host cffi $CFFI_HOST_VERSION + pycparser $ver in $CFFI_HOST_PATH"
}

homescoop_cffi_emit() {
  local script="${1:?homescoop_cffi_emit <script.py>[:<var>] <out.c> [--path <dir>]...}" out="${2:?}"
  shift 2
  : "${CFFI_HOST_PATH:?homescoop_cffi_emit: run homescoop_cffi_host first}"
  PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 "${HOMESCOOP_CFFI_HOST_PY:-python3}" \
    "$HOMESCOOP_ROOT/scripts/cffi-emit.py" --path "$CFFI_HOST_PATH" "$@" "$script" "$out"
}

homescoop_cffi_ext() {
  local out="${1:?homescoop_cffi_ext <out.so> <module.c> [args]...}" src="${2:?}" obj
  shift 2
  : "${CFFI_WASIX_PYINC:?homescoop_cffi_ext: set CFFI_WASIX_PYINC to wasix-python include/python3.X}"
  test -f "$CFFI_WASIX_PYINC/Python.h" || { echo "homescoop_cffi_ext: no Python.h in $CFFI_WASIX_PYINC" >&2; return 1; }
  command -v wasixcc >/dev/null || { echo "homescoop_cffi_ext: wasixcc is not on PATH (scripts/install-wasixcc.sh)" >&2; return 1; }
  obj="${out%.so}.o"
  mkdir -p "$(dirname "$out")"
  # The flags py-pillow and py-kiwisolver build their side modules with:
  # python.wasm's variant (PIC, threads, legacy EH), shared-library output.
  local cflags=(-O2 -DNDEBUG -fPIC -fvisibility=default -matomics -mbulk-memory -mmutable-globals -pthread
    -I"$CFFI_WASIX_PYINC" -ffile-prefix-map="$(dirname "$src")"=.)
  local compile=() link=() a
  for a in "$@"; do
    case "$a" in
      -l*|-L*|*.a|*.o|-Wl,*) link+=("$a") ;;
      *) compile+=("$a") ;;
    esac
  done
  WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes WASIXCC_RUN_WASM_OPT=no \
    wasixcc "${cflags[@]}" "${compile[@]}" -c "$src" -o "$obj"
  WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes WASIXCC_RUN_WASM_OPT=no WASIXCC_MODULE_KIND=shared-library \
    wasixcc -shared -fPIC -fvisibility=default -Wl,--allow-undefined -o "$out" "$obj" "${link[@]}"
  chmod 755 "$out"
  echo "== cffi-wasix: $(basename "$out") ($(wc -c <"$out" | tr -d ' ') bytes)"
}
