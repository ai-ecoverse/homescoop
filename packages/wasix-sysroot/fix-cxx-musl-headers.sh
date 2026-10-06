#!/usr/bin/env bash
# Patch an installed libc++ include tree so wasi/musl uses musl.h, not ibm.h.
# LLVM 24's locale_base_api.h falls through to ibm.h for non-linux targets;
# wasix-libc already declares strtod_l/vasprintf, so ibm.h clashes.
set -euo pipefail
ROOT="${1:?usage: fix-cxx-musl-headers.sh <cxx-install-prefix> [wasix-sysroot-for-musl.h]}"
MUSL_SRC="${2:-${HOME}/.wasixcc/sysroot/sysroot-exnref-eh/include/c++/v1/__locale_dir/locale_base_api/musl.h}"
API="$ROOT/include/c++/v1/__locale_dir/locale_base_api.h"
CFG="$ROOT/include/c++/v1/__config_site"
test -f "$API" || { echo "homescoop: missing $API" >&2; exit 1; }

mkdir -p "$ROOT/include/c++/v1/__locale_dir/locale_base_api"
if [[ -f "$MUSL_SRC" ]]; then
  cp "$MUSL_SRC" "$ROOT/include/c++/v1/__locale_dir/locale_base_api/musl.h"
fi
test -f "$ROOT/include/c++/v1/__locale_dir/locale_base_api/musl.h" || {
  echo "homescoop: musl.h missing after copy" >&2
  exit 1
}

python3 - "$API" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
if "locale_base_api/musl.h" in t and "ibm.h" in t.split("musl.h", 1)[0][-200:]:
    # already has musl before ibm in the wasi branch — ok if structured
    pass
# Replace bare ibm include in the catch-all else (LLVM 24 layout).
old = "#    include <__locale_dir/locale_base_api/ibm.h>\n"
new = (
    "#    if defined(__wasi__) || _LIBCPP_HAS_MUSL_LIBC\n"
    "#      include <__locale_dir/locale_base_api/musl.h>\n"
    "#    else\n"
    "#      include <__locale_dir/locale_base_api/ibm.h>\n"
    "#    endif\n"
)
if "locale_base_api/musl.h" not in t:
    if old not in t:
        raise SystemExit(f"locale_base_api.h: cannot patch ibm include in {p}")
    t = t.replace(old, new, 1)
    p.write_text(t)
    print(f"  patched {p} → wasi/musl")
else:
    print(f"  {p} already references musl.h")
PY

# Align __config_site with wasix (keep EH-related LLVM 24 additions).
if [[ -f "$CFG" ]]; then
  python3 - "$CFG" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
changed = False
# wasix sets this; keep it for terminal/isatty paths in iostream.
if "_LIBCPP_HAS_TERMINAL" not in t:
    t = t.replace(
        "#define _LIBCPP_HAS_MONOTONIC_CLOCK 1\n",
        "#define _LIBCPP_HAS_MONOTONIC_CLOCK 1\n#define _LIBCPP_HAS_TERMINAL 1\n",
        1,
    )
    changed = True
if "_LIBCPP_HAS_MUSL_LIBC" not in t:
    raise SystemExit(f"{p}: missing _LIBCPP_HAS_MUSL_LIBC — rebuild with -DLIBCXX_HAS_MUSL_LIBC=ON")
# Ensure it's ON
import re
t2, n = re.subn(
    r"#define _LIBCPP_HAS_MUSL_LIBC 0",
    "#define _LIBCPP_HAS_MUSL_LIBC 1",
    t,
)
if n:
    t = t2
    changed = True
if changed:
    p.write_text(t)
    print(f"  aligned {p}")
else:
    print(f"  {p} ok (musl + terminal)")
PY
fi
