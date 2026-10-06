#!/usr/bin/env bash
# Shared helper sourced by wasixcc / wasixcc++ for scipy OpenBLAS linking.
# When SCIPY_SHARED_OPENBLAS_SO points at libscipy_openblas.so, replace static
# OpenBLAS with that side module + --rpath=$ORIGIN/<rel>/.libs.
#
# Rpath is computed from the *install* destination (meson intro-install_plan),
# not the build-dir -o path — build paths like sparse/linalg/_propack/_propack.so
# install as sparse/linalg/_propack.so (shallower).

scipy_install_dest_for_build_so() {
  # stdin unused; args: build_so_path → prints install-relative path under scipy/… or nothing
  local out="$1"
  local plan="${SCIPY_MESON_INSTALL_PLAN:-}"
  [[ -n "$plan" && -f "$plan" ]] || return 1
  python3 - "$out" "$plan" <<'PY'
import json, os, sys
from pathlib import Path
out = Path(sys.argv[1])
plan = json.loads(Path(sys.argv[2]).read_text())
# Resolve build path keys; meson may use /private/tmp vs /tmp
cands = {str(out), str(out.resolve()) if out.exists() else str(out)}
pwd = Path.cwd()
if not out.is_absolute():
    cands.add(str((pwd / out).resolve()))
    cands.add(str(pwd / out))
# Also /private prefix dance on macOS
extra = set()
for c in list(cands):
    if c.startswith("/tmp/"):
        extra.add("/private" + c)
    if c.startswith("/private/tmp/"):
        extra.add(c.replace("/private/tmp/", "/tmp/", 1))
cands |= extra

for section, entries in plan.items():
    if not isinstance(entries, dict):
        continue
    for src, meta in entries.items():
        if not isinstance(meta, dict):
            continue
        dest = meta.get("destination") or ""
        if not dest.endswith(".so"):
            continue
        src_n = str(Path(src))
        src_cands = {src_n, src_n.replace("/private/tmp/", "/tmp/"), src_n.replace("/tmp/", "/private/tmp/", 1)}
        if not (cands & src_cands):
            # also match by suffix under build/scipy/
            for c in cands:
                if "scipy/" in c and src_n.endswith(c[c.find("scipy/"):]):
                    break
            else:
                continue
        if "{py_platlib}/" in dest:
            rel = dest.split("{py_platlib}/", 1)[1]
        else:
            continue
        print(rel)
        raise SystemExit(0)
raise SystemExit(1)
PY
}

scipy_openblas_link_args() {
  # args: output_so_path → prints linker args on stdout (or empty to use static)
  local out="${1:-}"
  local so="${SCIPY_SHARED_OPENBLAS_SO:-}"
  if [[ -z "$so" || ! -f "$so" ]]; then
    return 1
  fi
  local libs_dir
  libs_dir="$(cd "$(dirname "$so")" && pwd)"
  local rpath='$ORIGIN/../.libs'
  if [[ -n "$out" ]]; then
    local install_rel="" out_dir rel
    # Prefer install-plan destination for rpath depth
    if install_rel="$(scipy_install_dest_for_build_so "$out" 2>/dev/null)"; then
      out_dir="$(dirname "$install_rel")"
      # install_rel like scipy/linalg/_flapack….so → dir scipy/linalg
      # libs live at scipy/.libs → relpath from scipy/linalg = ../.libs
      rel="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "scipy/.libs" "$out_dir")"
      rpath="\$ORIGIN/$rel"
    else
      local out_abs libs_abs
      out_dir="$(dirname "$out")"
      if [[ "$out_dir" != /* ]]; then
        out_abs="$(pwd)/$out_dir"
      else
        out_abs="$out_dir"
      fi
      libs_abs="$libs_dir"
      rel="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$libs_abs" "$out_abs")"
      rpath="\$ORIGIN/$rel"
    fi
  fi
  # Pass the shared object by path (wasixld defaults to -Bstatic; -lfoo won't find .so).
  # --rpath writes dylink.0 RUNTIME_PATH (subsection 5).
  printf '%s\n' "$so" "-Wl,--rpath=$rpath"
  return 0
}

scipy_find_output_so() {
  local prev="" a
  for a in "$@"; do
    if [[ "$prev" == "-o" ]]; then
      printf '%s\n' "$a"
      return 0
    fi
    prev="$a"
  done
  for a in "$@"; do
    case "$a" in
      *.cpython-*-wasm32-wasix.so|*.so)
        if [[ "$a" != -* && -n "$a" ]]; then
          printf '%s\n' "$a"
          return 0
        fi
        ;;
    esac
  done
  return 1
}
