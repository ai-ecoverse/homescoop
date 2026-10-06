#!/usr/bin/env bash
# Stage GNU Automake as slicc script commands (Perl; needs autoconf + m4).
set -euo pipefail
HOMESCOOP_ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=/dev/null
source "$HOMESCOOP_ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-automake

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
VER="$VERSION"
WORK="${WASIX_AUTOMAKE_WORK:-$PKG/work}"
SRC="$WORK/automake-$VER"
STAGE="$WORK/stage"

mkdir -p "$WORK" "$DEST/bin" "$DEST/share"
TARBALL="$WORK/automake-${VER}.tar.xz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"

if [[ ! -d "$SRC" || -n "${FORCE:-}" ]]; then
  rm -rf "$SRC"
  tar xJf "$TARBALL" -C "$WORK"
fi

# Prefer our staged autoconf on PATH for host configure when available
AC_BIN="${HOMESCOOP_ROOT}/packages/wasix-autoconf/package/bin"
M4_BIN="$(command -v gm4 || command -v m4 || true)"
if [[ -x "$AC_BIN/autoconf" ]]; then
  export PATH="/opt/homebrew/opt/m4/bin:$AC_BIN:$PATH"
  export autom4te_perllibdir="${HOMESCOOP_ROOT}/packages/wasix-autoconf/package/share/autoconf"
  export AC_MACRODIR="$autom4te_perllibdir"
fi

if [[ ! -x "$STAGE/usr/bin/automake" || -n "${FORCE:-}" ]]; then
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  (
    cd "$SRC"
    if [[ ! -f Makefile ]]; then
      ./configure --prefix=/usr
    fi
    make -j"${HOMESCOOP_JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}"
    make DESTDIR="$STAGE" install
  )
fi

for s in automake aclocal; do
  for src in "$STAGE/usr/bin/$s" "$STAGE/usr/bin/$s-$VER"; do
    [[ -f "$src" ]] || continue
    base=$(basename "$src")
    sed '1s|^#!.*perl.*|#!/usr/bin/perl|;1s|^#!.*|#!/usr/bin/perl|' "$src" > "$DEST/bin/$base"
    chmod +x "$DEST/bin/$base"
  done
done

rm -rf "$DEST/share/automake-$VER" "$DEST/share/aclocal-$VER" "$DEST/share/aclocal"
mkdir -p "$DEST/share"
cp -a "$STAGE/usr/share/automake-$VER" "$DEST/share/" 2>/dev/null || true
cp -a "$STAGE/usr/share/aclocal-$VER" "$DEST/share/" 2>/dev/null || true
cp -a "$STAGE/usr/share/aclocal" "$DEST/share/" 2>/dev/null || true

python3 - "$DEST/share" <<'PY'
import shutil, sys
from pathlib import Path
root = Path(sys.argv[1])
for p in sorted(root.rglob("*"), reverse=True):
    if p.is_symlink():
        t = p.resolve(strict=False)
        p.unlink()
        if t.is_dir():
            shutil.copytree(t, p, symlinks=False)
        elif t.is_file():
            shutil.copy2(t, p)
PY

# Relocatable libdir / acdir defaults + bare AUTOCONF/AUTOM4TE names
python3 - "$DEST" "$VER" <<'PY'
from pathlib import Path
import re, sys

dest, ver = Path(sys.argv[1]), sys.argv[2]
bin_dir = dest / "bin"

def rel_share(*parts: str) -> str:
    joined = ", ".join(repr(p) for p in ("share",) + parts)
    return (
        "do { require File::Basename; require File::Spec; "
        "File::Spec->catdir(File::Basename::dirname(File::Basename::dirname("
        f"File::Spec->rel2abs($0))), {joined}) }}"
    )

rel_am_acdir = rel_share(f"aclocal-{ver}")
rel_sys_acdir = rel_share("aclocal")
rel_lib = rel_share(f"automake-{ver}")

for script in sorted(bin_dir.glob("*")):
    if not script.is_file():
        continue
    t = script.read_text()
    t = t.replace(
        f"$ENV{{'AUTOMAKE_LIBDIR'}} || '/usr/share/automake-{ver}'",
        f"$ENV{{'AUTOMAKE_LIBDIR'}} || {rel_lib}",
    )
    t = re.sub(
        rf"my \$libdir = '/usr/share/automake-{re.escape(ver)}';",
        f"my $libdir = $ENV{{'AUTOMAKE_LIBDIR'}} || {rel_lib};",
        t,
    )
    t = re.sub(
        rf"my \$aclocaldir = '/usr/share/aclocal';",
        f"my $aclocaldir = $ENV{{'ACLOCAL_PATH'}} || {rel_sys_acdir};",
        t,
    )
    # aclocal @automake_includes / @system_includes (the SLICC failure mode)
    t = re.sub(
        rf"my @automake_includes = \('/usr/share/aclocal-' \. \$APIVERSION\);\s*"
        rf"my @system_includes = \('/usr/share/aclocal'\);",
        "my @automake_includes = ($ENV{'ACLOCAL_AUTOMAKE_DIR'} || "
        + rel_am_acdir
        + ");\n"
        "my @system_includes = ("
        + rel_sys_acdir
        + ");",
        t,
        count=1,
    )
    # Absolute AUTOCONF/AUTOM4TE baked from host PATH at configure time
    t = re.sub(
        r"(\$ENV\{AUTOCONF\}\s*\|\|\s*)'[^']*autoconf'",
        r"\1'autoconf'",
        t,
    )
    t = re.sub(
        r"(\$ENV\{AUTOM4TE\}\s*\|\|\s*)'[^']*autom4te'",
        r"\1'autom4te'",
        t,
    )
    t = re.sub(
        rf"unshift \(@INC, '/usr/share/automake-{re.escape(ver)}'\)\s*unless \$ENV\{{AUTOMAKE_UNINSTALLED\}};",
        "my $homescoop_lib = $ENV{'AUTOMAKE_LIBDIR'} || "
        + rel_lib
        + ";\n"
        "  unshift (@INC, $homescoop_lib) unless $ENV{AUTOMAKE_UNINSTALLED};",
        t,
    )
    first = t.splitlines()[0] if t else ""
    if not first.startswith("#!"):
        raise SystemExit(f"mangled shebang in {script}")
    script.write_text(t)

# Automake::Config $libdir from __FILE__
cfg = dest / "share" / f"automake-{ver}" / "Automake" / "Config.pm"
if cfg.is_file():
    t = cfg.read_text()
    t2 = re.sub(
        rf"our \$libdir = \$ENV\{{\"AUTOMAKE_LIBDIR\"\}} \|\| '/usr/share/automake-{re.escape(ver)}';",
        'our $libdir = $ENV{"AUTOMAKE_LIBDIR"} || do {\n'
        "  require File::Basename; require File::Spec;\n"
        "  File::Spec->catdir(File::Basename::dirname(File::Basename::dirname(\n"
        "    File::Spec->rel2abs(__FILE__))));\n"
        "};",
        t,
        count=1,
    )
    if t2 == t and "rel2abs(__FILE__)" not in t:
        raise SystemExit("Config.pm libdir pattern not found")
    cfg.write_text(t2)

print("automake relocatable patches ok")
PY

homescoop_stage_license "$SRC/COPYING" "$SRC/COPYING" 2>/dev/null || \
  homescoop_stage_license "$SRC/COPYING" "$SRC/README"

# npm version: 1.17 → 1.17.0-N (bump manually in package/ after rebuild)
python3 - "$DEST" "$VER" <<'PY'
import json, sys
from pathlib import Path
dest, ver = Path(sys.argv[1]), sys.argv[2]
parts = ver.split(".")
npm_ver = f"{ver}.0-5" if len(parts) == 2 else f"{ver}-5"
am_env = {
    "AUTOMAKE_LIBDIR": f"${{package}}/share/automake-{ver}",
    "ACLOCAL_AUTOMAKE_DIR": f"${{package}}/share/aclocal-{ver}",
    "ACLOCAL_PATH": f"${{package}}/share/aclocal",
}
commands = {
    "automake": {"script": "bin/automake", "env": dict(am_env)},
    "aclocal": {"script": "bin/aclocal", "env": dict(am_env)},
}
for cmd in ("automake", "aclocal"):
    vcmd = f"{cmd}-{ver}"
    if (dest / "bin" / vcmd).exists():
        commands[vcmd] = {"script": f"bin/{vcmd}", "env": dict(am_env)}
pkg = {
    "name": "@ai-ecoverse/wasix-automake",
    "version": npm_ver,
    "description": "GNU Automake for slicc (scripts; needs wasix-perl + wasix-autoconf + wasix-m4)",
    "license": "GPL-2.0-or-later",
    "files": ["README.md", "LICENSE", "bin", "share"],
    "publishConfig": {"access": "public"},
    "homescoop": {"recipe": "wasix-automake", "upstream": ver},
    "dependencies": {
        "@ai-ecoverse/wasix-autoconf": "^2.72.0-3",
        "@ai-ecoverse/wasix-perl": "^5.42.0-2",
    },
    "slicc": {"abi": "wasi", "commands": commands},
}
(dest / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")
(dest / "README.md").write_text(
    "# `@ai-ecoverse/wasix-automake`\n\n"
    "GNU Automake scripts for slicc. Needs wasix-perl, wasix-autoconf, wasix-m4.\n"
)
print("package.json", npm_ver)
PY

echo "== wasix-automake staged"
ls "$DEST/bin"
du -sh "$DEST"
