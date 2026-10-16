#!/bin/sh
# WASIX-style clang/clang++ driver for SLICC.
# Invoked as cc, gcc, c++, g++, wasixcc, or wasix++ via basename.
set -eu

SCRIPT=$0
while [ -L "$SCRIPT" ]; do
  link=$(ls -ld "$SCRIPT" | sed 's/.* -> //')
  case "$link" in
    /*) SCRIPT=$link ;;
    *) SCRIPT=$(dirname "$SCRIPT")/$link ;;
  esac
done
BINDIR=$(CDPATH= cd -- "$(dirname "$SCRIPT")" && pwd)
PKGROOT=$(CDPATH= cd -- "$BINDIR/.." && pwd)

PREFIX=${WASIXCC_SYSROOT_PREFIX:-${WASIX_SYSROOT_PREFIX:-}}
if [ -z "$PREFIX" ]; then
  for cand in \
    "$PKGROOT/../wasix-sysroot" \
    /shared/lib/node_modules/@ai-ecoverse/wasix-sysroot \
    /usr/share/wasix-sysroot
  do
    if [ -d "$cand/sysroot-exnref-eh" ] || [ -d "$cand/sysroot" ]; then
      PREFIX=$cand
      break
    fi
  done
fi
if [ -z "${PREFIX:-}" ] || [ ! -d "$PREFIX" ]; then
  echo "wasix-driver: WASIXCC_SYSROOT_PREFIX not set and no wasix-sysroot found" >&2
  exit 1
fi

RESOURCE=${CLANG_RESOURCE_DIR:-$PKGROOT/lib/clang/24}
if [ ! -d "$RESOURCE" ]; then
  echo "wasix-driver: clang resource dir missing: $RESOURCE" >&2
  exit 1
fi

EXCEPTIONS=${WASIXCC_WASM_EXCEPTIONS:-exnref}
PIC=${WASIXCC_PIC:-no}

compile_only=0
has_src=0
shared=0
rdynamic=0
pie=0
out=
prev=
for a in "$@"; do
  case "$a" in
    -c|-E|-S|-M|-MM) compile_only=1 ;;
    -shared) shared=1; PIC=yes ;;
    -fPIC|-fpic) PIC=yes ;;
    -rdynamic|-Wl,-rdynamic) rdynamic=1; PIC=yes ;;
    -pie|-Wl,-pie) pie=1; PIC=yes ;;
    *.c|*.cc|*.cpp|*.cxx|*.C|*.m|*.mm|*.s|*.S|*.i|*.ii|*.h|*.hpp) has_src=1 ;;
  esac
  if [ "$prev" = "-o" ]; then
    out=$a
  fi
  prev=$a
done

# -fPIC on an executable link (no -shared, producing a binary) → dynamic-main / PIE.
dynamic_main=0
if [ "$shared" -eq 0 ] && [ "$compile_only" -eq 0 ]; then
  if [ "$rdynamic" -eq 1 ] || [ "$pie" -eq 1 ]; then
    dynamic_main=1
  elif [ "$PIC" = yes ] || [ "$PIC" = true ]; then
    # -fPIC without -shared on a link → PIE main that can dlopen side modules.
    if [ "$has_src" -eq 1 ] || [ -n "$out" ]; then
      dynamic_main=1
    fi
  fi
fi
if [ "$dynamic_main" -eq 1 ]; then
  PIC=yes
fi

do_compile=0
if [ "$compile_only" -eq 1 ] || [ "$has_src" -eq 1 ]; then
  do_compile=1
fi

case "$EXCEPTIONS" in
  exnref|yes)
    if [ "$PIC" = yes ] || [ "$PIC" = true ]; then
      SYSROOT=$PREFIX/sysroot-exnref-ehpic
    else
      SYSROOT=$PREFIX/sysroot-exnref-eh
    fi
    ;;
  legacy)
    if [ "$PIC" = yes ] || [ "$PIC" = true ]; then
      SYSROOT=$PREFIX/sysroot-ehpic
    else
      SYSROOT=$PREFIX/sysroot-eh
    fi
    ;;
  no|off|none)
    SYSROOT=$PREFIX/sysroot
    ;;
  *)
    if [ "$PIC" = yes ] || [ "$PIC" = true ]; then
      SYSROOT=$PREFIX/sysroot-ehpic
    else
      SYSROOT=$PREFIX/sysroot-eh
    fi
    ;;
esac

if [ ! -d "$SYSROOT" ]; then
  echo "wasix-driver: sysroot missing: $SYSROOT (prefix=$PREFIX)" >&2
  exit 1
fi

prog=$(basename "$0")
case "$prog" in
  c++|g++|wasix++|clang++) FRONTEND=clang++; IS_CXX=1 ;;
  *) FRONTEND=clang; IS_CXX=0 ;;
esac

# Defaults → user args → link flags via clang @response-file (one argv per line).
rsp=$(mktemp "${TMPDIR:-/tmp}/wasix-driver.XXXXXX")
trap 'rm -f "$rsp"' EXIT

{
  printf '%s\n' \
    "--target=wasm32-wasip1" \
    "--sysroot=$SYSROOT" \
    "-resource-dir=$RESOURCE" \
    "-matomics" "-mbulk-memory" "-mmutable-globals" \
    "-mthread-model" "posix" "-pthread" \
    "-fno-trapping-math" \
    "-D_WASI_EMULATED_MMAN" \
    "-D_WASI_EMULATED_SIGNAL" \
    "-D_WASI_EMULATED_PROCESS_CLOCKS"

  if [ "$do_compile" -eq 1 ]; then
    case "$EXCEPTIONS" in
      no|off|none)
        printf '%s\n' "-fno-exceptions"
        ;;
      *)
        printf '%s\n' \
          "-fwasm-exceptions" \
          "-mllvm" "--wasm-enable-sjlj" \
          "-mllvm" "--wasm-use-legacy-eh=false"
        ;;
    esac

    if [ "$PIC" = yes ] || [ "$PIC" = true ]; then
      printf '%s\n' "-fPIC" "-ftls-model=global-dynamic" "-fvisibility=default"
    else
      printf '%s\n' "-ftls-model=local-exec"
    fi
  fi

  for a in "$@"; do
    case "$a" in
      -rdynamic|-Wl,-rdynamic) continue ;; # consumed: triggers PIE/dlopen main
    esac
    printf '%s\n' "$a"
  done

  if [ "$compile_only" -eq 0 ]; then
    # Shared side module: no libc (resolve against the PIE main at dlopen).
    if [ "$shared" -eq 1 ]; then
      printf '%s\n' \
        "-nostdlib" \
        "-Wl,--extra-features=atomics" \
        "-Wl,--extra-features=bulk-memory" \
        "-Wl,--extra-features=mutable-globals" \
        "-Wl,--shared-memory" \
        "-Wl,--experimental-pic" \
        "-Wl,--unresolved-symbols=import-dynamic" \
        "-Wl,--export=__wasm_call_ctors" \
        "-Wl,--export-if-defined=__wasm_apply_data_relocs" \
        "-Wl,--export-if-defined=__wasm_apply_tls_relocs" \
        "-Wl,--no-entry" \
        "-Wl,-Bsymbolic"
    else
      printf '%s\n' \
        "-Wl,--extra-features=atomics" \
        "-Wl,--extra-features=bulk-memory" \
        "-Wl,--extra-features=mutable-globals" \
        "-Wl,--shared-memory" \
        "-Wl,--max-memory=4294967296" \
        "-Wl,--import-memory" \
        "-Wl,--export-dynamic" \
        "-Wl,--export=__wasm_call_ctors" \
        "-Wl,--no-demangle"

      case "$EXCEPTIONS" in
        no|off|none) ;;
        *)
          printf '%s\n' \
            "-Wl,-mllvm,--wasm-enable-eh" \
            "-Wl,-mllvm,--wasm-enable-sjlj" \
            "-Wl,-mllvm,--wasm-use-legacy-eh=false" \
            "-Wl,-mllvm,--exception-model=wasm"
          ;;
      esac

      printf '%s\n' \
        "-Wl,--export=__wasm_init_tls" \
        "-Wl,--export=__wasm_signal" \
        "-Wl,--export=__tls_size" \
        "-Wl,--export=__tls_align" \
        "-Wl,--export=__tls_base" \
        "-Wl,--export-if-defined=__indirect_function_table" \
        "-Wl,--export-if-defined=__stack_pointer" \
        "-Wl,--export-if-defined=__heap_base" \
        "-Wl,--export-if-defined=__data_end"

      if [ "$dynamic_main" -eq 1 ]; then
        # PIE main exporting libc for dlopen side modules (wasixcc dynamic-main /
        # realm dlmain fixture). Trigger with -rdynamic or -fPIC on an executable link.
        printf '%s\n' \
          "-Wl,--experimental-pic" \
          "-Wl,-pie" \
          "-Wl,--export-all" \
          "-Wl,--whole-archive" \
          "-lc" \
          "-Wl,--no-whole-archive" \
          "-Wl,--export-if-defined=__wasm_apply_data_relocs" \
          "-Wl,--export-if-defined=__wasm_apply_tls_relocs" \
          "-Wl,--allow-undefined" \
          "-lcommon-tag-stubs"
      fi

      printf '%s\n' \
        "-lwasi-emulated-getpid" \
        "-lwasi-emulated-mman" \
        "-lwasi-emulated-process-clocks" \
        "-lclang_rt.builtins-wasm32" \
        "-lpthread" \
        "-Wl,-z,stack-size=8388608"

      # C++ runtime: libc++ → libc++abi → libunwind (wasixcc order).
      if [ "$IS_CXX" -eq 1 ]; then
        if [ "$dynamic_main" -eq 1 ]; then
          printf '%s\n' "-Wl,--whole-archive"
        fi
        printf '%s\n' "-lc++" "-lc++abi"
        case "$EXCEPTIONS" in
          no|off|none) ;;
          *) printf '%s\n' "-lunwind" ;;
        esac
        if [ "$dynamic_main" -eq 1 ]; then
          printf '%s\n' "-Wl,--no-whole-archive"
        fi
      fi
    fi
  fi
} >"$rsp"

"$FRONTEND" "@$rsp"
status=$?
if [ "$status" -ne 0 ]; then
  exit "$status"
fi

# Does the module import wasix_32v1.proc_fork, stack_checkpoint or
# stack_restore? Reads the wasm's import section with od (coreutils, which
# this driver needs anyway): 0 yes, 1 no, 2 when it can't be read. Until
# 24.0.0-15 this was a grep of the whole file, and without grep in the realm
# the check failed quietly and fork programs were linked without Asyncify
# (homescoop#451).
wasix_imports_fork() {
  _f=$1
  _size=$(wc -c <"$_f" 2>/dev/null) || return 2
  _size=$((_size + 0))
  _magic=$(od -An -v -tu1 -N 8 "$_f" 2>/dev/null) || return 2
  # shellcheck disable=SC2086
  set -- $_magic
  [ "$#" -eq 8 ] && [ "$1 $2 $3 $4" = "0 97 115 109" ] || return 2
  _off=8
  while [ "$_off" -lt "$_size" ]; do
    _hdr=$(od -An -v -tu1 -j "$_off" -N 6 "$_f" 2>/dev/null) || return 2
    # shellcheck disable=SC2086
    set -- $_hdr
    [ "$#" -ge 2 ] || return 2
    _id=$1
    shift
    _len=0 _shift=0 _n=1
    for _b in "$@"; do
      _len=$((_len | ((_b & 127) << _shift)))
      _n=$((_n + 1))
      [ "$_b" -lt 128 ] && break
      _shift=$((_shift + 7))
    done
    _body=$((_off + _n))
    if [ "$_id" -eq 2 ]; then
      _hex=$(od -An -v -tx1 -j "$_body" -N "$_len" "$_f" 2>/dev/null | tr -d ' \n') || return 2
      [ -n "$_hex" ] || return 2
      # module "wasix_32v1", then the field: length byte and name, in hex
      _mod=0a77617369785f33327631
      case $_hex in
        *"${_mod}0970726f635f666f726b"* | *"${_mod}10737461636b5f636865636b706f696e74"* | \
          *"${_mod}0d737461636b5f726573746f7265"*) return 0 ;;
      esac
      return 1
    fi
    # Custom sections (0) may come anywhere; past the type section (1) there
    # is no import section.
    [ "$_id" -le 1 ] || return 1
    _off=$((_body + _len))
  done
  return 1
}

# Post-link Asyncify when the module needs host-driven fork / stack_checkpoint
# (SLICC realm) or when exceptions=off (wasixcc setjmp path).
# WASIXCC_ASYNCIFY=1 forces it, WASIXCC_ASYNCIFY=0 skips it.
if [ "$compile_only" -eq 0 ] && [ "$shared" -eq 0 ] && [ -n "$out" ] && [ -f "$out" ]; then
  chmod +x "$out" 2>/dev/null || true
  need_asyncify=0
  case "${WASIXCC_ASYNCIFY:-}:$EXCEPTIONS" in
    1:* | yes:* | on:*) need_asyncify=1 ;;
    0:* | no:* | off:*) need_asyncify=0 ;;
    *:no | *:off | *:none) need_asyncify=1 ;;
    *)
      if wasix_imports_fork "$out"; then
        need_asyncify=1
      else
        case $? in
          1) ;;
          *)
            echo "wasix-driver: cannot read the imports of $out (needs od and tr from coreutils) to decide on Asyncify; set WASIXCC_ASYNCIFY=1 or 0" >&2
            exit 1
            ;;
        esac
      fi
      ;;
  esac
  if [ "$need_asyncify" -eq 1 ]; then
    # Prefer explicit override, then PATH (@ai-ecoverse/wasm-binaryen), then
    # a legacy in-package binary (removed as of wasm-clang 24.0.0-7).
    if [ -n "${WASIXCC_WASM_OPT:-}" ]; then
      WASM_OPT=$WASIXCC_WASM_OPT
    elif command -v wasm-opt >/dev/null 2>&1; then
      WASM_OPT=$(command -v wasm-opt)
    elif [ -x "$BINDIR/wasm-opt" ]; then
      WASM_OPT=$BINDIR/wasm-opt
    else
      WASM_OPT=
    fi
    if [ -z "$WASM_OPT" ] || [ ! -x "$WASM_OPT" ]; then
      echo "wasix-driver: need wasm-opt for Asyncify (install @ai-ecoverse/wasm-binaryen or set WASIXCC_WASM_OPT)" >&2
      exit 1
    fi
    tmp_async=$(mktemp "${TMPDIR:-/tmp}/wasix-async.XXXXXX.wasm")
    # Same import list as homescoop wasix-python / wasix host Asyncify for fork.
    if "$WASM_OPT" --asyncify -O2 \
      --pass-arg=asyncify-imports@wasix_32v1.proc_fork,wasix_32v1.stack_checkpoint,wasix_32v1.stack_restore \
      --enable-threads \
      --enable-mutable-globals \
      --enable-bulk-memory \
      --enable-bulk-memory-opt \
      --enable-exception-handling \
      --enable-simd \
      --enable-relaxed-simd \
      --enable-extended-const \
      --no-validation \
      "$out" -o "$tmp_async"
    then
      mv "$tmp_async" "$out"
      chmod +x "$out" 2>/dev/null || true
    else
      rm -f "$tmp_async"
      echo "wasix-driver: wasm-opt --asyncify failed" >&2
      exit 1
    fi
  fi
fi
exit 0
