#!/usr/bin/env bash
# Stage GNU Autoconf as slicc script commands (Perl + m4 data; no wasm).
set -euo pipefail
HOMESCOOP_ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=/dev/null
source "$HOMESCOOP_ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-autoconf

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
VER="$VERSION"
WORK="${WASIX_AUTOCONF_WORK:-$PKG/work}"
SRC="$WORK/autoconf-$VER"
STAGE="$WORK/stage"

mkdir -p "$WORK" "$DEST/bin" "$DEST/share"
TARBALL="$WORK/autoconf-${VER}.tar.xz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"

if [[ ! -d "$SRC" || -n "${FORCE:-}" ]]; then
  rm -rf "$SRC"
  tar xJf "$TARBALL" -C "$WORK"
fi

# Host-build to generate installed script tree (autoconf is Perl; we only need install layout).
if [[ ! -x "$STAGE/usr/bin/autoconf" || -n "${FORCE:-}" ]]; then
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  (
    cd "$SRC"
    if [[ ! -f Makefile ]]; then
      ./configure --prefix=/usr --disable-silent-rules M4="${HOMESCOOP_HOST_M4:-$(command -v gm4 || command -v m4)}"
    fi
    make -j"${HOMESCOOP_JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}"
    make DESTDIR="$STAGE" install
  )
fi

# Scripts → bin/ with #!/usr/bin/perl (slicc → wasix-perl)
for s in autoconf autoheader autom4te autoreconf autoscan autoupdate ifnames; do
  src="$STAGE/usr/bin/$s"
  [[ -f "$src" ]] || continue
  sed '1s|^#!.*perl.*|#!/usr/bin/perl|;1s|^#!.*|#!/usr/bin/perl|' "$src" > "$DEST/bin/$s"
  chmod +x "$DEST/bin/$s"
done

# m4 macros / Autom4te data
rm -rf "$DEST/share/autoconf"
mkdir -p "$DEST/share"
cp -a "$STAGE/usr/share/autoconf" "$DEST/share/"
# Flatten symlinks
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

# Relocatable defaults: dirname($0)/../share/autoconf + sibling tools + AC_MACRODIR search
python3 - "$DEST" <<'PY'
from pathlib import Path
import re
import sys

dest = Path(sys.argv[1])
share = dest / "share" / "autoconf"
bin_dir = dest / "bin"

REL = (
    "do { require File::Basename; require File::Spec; "
    "File::Spec->catdir(File::Basename::dirname(File::Basename::dirname("
    "File::Spec->rel2abs($0))), 'share', 'autoconf') }"
)
REL_TRAILER = (
    "do { require File::Basename; require File::Spec; "
    "File::Spec->catfile(File::Basename::dirname(File::Basename::dirname("
    "File::Spec->rel2abs($0))), 'share', 'autoconf', 'autoconf', 'trailer.m4') }"
)

def sibling(tool: str) -> str:
    return (
        "do { require File::Basename; File::Basename::dirname($0).'/"
        + tool
        + "' }"
    )

# Drop hardcoded --prepend-include '/usr/share/autoconf'; unshift $pkgdatadir instead.
cfg = share / "autom4te.cfg"
cfg_text = cfg.read_text().replace("args: --prepend-include '/usr/share/autoconf'\n", "")
# No absolute /usr paths may remain in autom4te.cfg (build-prefix leak)
if re.search(r"/usr/(share|bin|lib)/", cfg_text):
    raise SystemExit("autom4te.cfg still contains absolute /usr data paths")
cfg.write_text(cfg_text)

for script in sorted(bin_dir.iterdir()):
    if not script.is_file():
        continue
    t = script.read_text()
    t = t.replace(
        "$ENV{'autom4te_perllibdir'} || '/usr/share/autoconf'",
        f"$ENV{{'autom4te_perllibdir'}} || {REL}",
    )
    t = t.replace(
        "$ENV{'AC_MACRODIR'} || '/usr/share/autoconf'",
        f"$ENV{{'AC_MACRODIR'}} || {REL}",
    )
    t = t.replace(
        "$ENV{'trailer_m4'} || '/usr/share/autoconf/autoconf/trailer.m4'",
        f"$ENV{{'trailer_m4'}} || {REL_TRAILER}",
    )
    t = t.replace(
        "my @include = ('/usr/share/autoconf');",
        f"my @include = ({REL});",
    )
    # Host m4 absolute path → bare 'm4' (slicc resolves wasix-m4)
    t = re.sub(
        r"(\$ENV\{['\"]M4['\"]\}\s*\|\|\s*)'[^']+'",
        r"\1'm4'",
        t,
    )
    # Sibling tool paths (avoid /usr/bin/*)
    for env_name, tool in (
        ("AUTOM4TE", "autom4te"),
        ("AUTOCONF", "autoconf"),
        ("AUTOHEADER", "autoheader"),
    ):
        t = t.replace(
            f"$ENV{{'{env_name}'}} || '/usr/bin/{tool}'",
            f"$ENV{{'{env_name}'}} || {sibling(tool)}",
        )
        # autoreconf uses spaced assignment: my $x = $ENV{'X'}    || '/usr/bin/x';
        t = re.sub(
            rf"(\$ENV\{{'{env_name}'\}}\s*\|\|\s*)'/usr/bin/{tool}'",
            rf"\1{sibling(tool)}",
            t,
        )
    script.write_text(t)

autom4te = bin_dir / "autom4te"
t = autom4te.read_text()
needle = "@include = grep { !/^\\.$/ } uniq (reverse(@prepend_include), @include);"
if needle not in t:
    raise SystemExit("autom4te @include assignment not found — update relocatable patch")
if "unshift @include, $pkgdatadir;" not in t:
    t = t.replace(
        needle,
        needle + "\n  # homescoop: relocatable package datadir\n  unshift @include, $pkgdatadir;",
    )
    autom4te.write_text(t)

# The GNU m4 probe piped m4 --help into grep, so without grep in the realm
# autom4te (and aclocal through it) died with "need GNU m4 1.4 or later",
# blaming the m4 it had (homescoop#470). Match in Perl instead.
t = autom4te.read_text()
probe_sh = 'if system "$m4 --help </dev/null 2>&1 | grep reload-state >/dev/null";'
probe_pl = "if (`$m4 --help </dev/null 2>&1` // '') !~ /reload-state/;"
if probe_sh in t:
    t = t.replace(probe_sh, probe_pl)
    autom4te.write_text(t)
if probe_pl not in t or "| grep" in t:
    raise SystemExit("autom4te GNU m4 probe not found or still pipes into grep — update the patch")

# Sanity: shebang must be first line
for script in bin_dir.iterdir():
    if not script.is_file():
        continue
    first = script.read_text().splitlines()[0]
    if not first.startswith("#!"):
        raise SystemExit(f"mangled shebang in {script}: {first[:80]!r}")

print("relocatable patches applied")
PY

homescoop_stage_license "$SRC/COPYING" "$SRC/COPYINGv3"

# package.json via Python so ${package} is never shell-expanded
python3 - "$DEST" "$VER" <<'PY'
import json, sys
from pathlib import Path
dest, ver = Path(sys.argv[1]), sys.argv[2]
env = {
    "autom4te_perllibdir": "${package}/share/autoconf",
    "AC_MACRODIR": "${package}/share/autoconf",
    "AUTOM4TE_CFG": "${package}/share/autoconf/autom4te.cfg",
    "M4": "m4",
}
commands = {}
for cmd in ("autoconf", "autoheader", "autom4te", "autoreconf", "autoscan", "autoupdate"):
    commands[cmd] = {"script": f"bin/{cmd}", "env": dict(env)}
    if cmd == "autoconf":
        commands[cmd]["env"]["trailer_m4"] = "${package}/share/autoconf/autoconf/trailer.m4"
commands["ifnames"] = {
    "script": "bin/ifnames",
    "env": {"autom4te_perllibdir": env["autom4te_perllibdir"]},
}
# The committed package/package.json is the SSOT for -N and the exact
# @ai-ecoverse pins (docs/versioning.md); a fresh tree starts at X.Y.0-1.
committed = dest / "package.json"
old = json.loads(committed.read_text()) if committed.exists() else {}
parts = ver.split(".")
npm_ver = old.get("version") or (f"{ver}.0-1" if len(parts) == 2 else f"{ver}-1")
deps = old.get("dependencies") or {
    "@ai-ecoverse/wasix-perl": "5.42.0-11",
    "@ai-ecoverse/wasix-m4": "1.4.20-2",
}
pkg = {
    "name": "@ai-ecoverse/wasix-autoconf",
    "version": npm_ver,
    "description": "GNU Autoconf for slicc (scripts; needs wasix-perl + wasix-m4)",
    "license": "GPL-3.0-or-later",
    "repository": {"type": "git", "url": "git+https://github.com/ai-ecoverse/homescoop.git", "directory": "packages/wasix-autoconf/package"},
    "files": ["README.md", "LICENSE", "bin", "share"],
    "publishConfig": {"access": "public"},
    "homescoop": {"recipe": "wasix-autoconf", "upstream": ver},
    "slicc": {"abi": "wasi", "commands": commands},
    "dependencies": deps,
}
(dest / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")
(dest / "README.md").write_text(
    "# `@ai-ecoverse/wasix-autoconf`\n\n"
    "GNU Autoconf as slicc script commands: `autoconf`, `autoheader`, `autom4te`,\n"
    "`autoreconf`, `autoscan`, `autoupdate`, `ifnames`. Its dependencies,\n"
    "`@ai-ecoverse/wasix-perl` and `@ai-ecoverse/wasix-m4`, are all `autoconf`\n"
    "itself needs. With `@ai-ecoverse/wasix-automake`, `aclocal`, `autoconf` and\n"
    "`automake --add-missing` run with those alone (plus a shell and coreutils).\n\n"
    "## Running `configure`\n\n"
    "The `configure` script Autoconf writes is a shell script that needs a POSIX\n"
    "userland, as on any system: `sh` (wasm-bash), coreutils, and **grep, sed\n"
    "and awk**. They are not dependencies of this package; slicc's base set has\n"
    "them, and elsewhere:\n\n"
    "```bash\n"
    "pnpm add -g @ai-ecoverse/wasm-grep @ai-ecoverse/wasm-sed @ai-ecoverse/wasm-gawk\n"
    "```\n\n"
    "Without them `configure` fails with `sed: command not found` (and the like).\n"
    "A build then also wants `make` (`@ai-ecoverse/wasm-gmake`).\n\n"
    "Before 2.72.0-7, `autom4te` (and `aclocal`, `autoreconf`, `automake` through\n"
    "it) needed grep too, and without it failed with a misleading\n"
    "`autom4te: error: need GNU m4 1.4 or later: m4`.\n"
)
print("package.json written")
PY

echo "== wasix-autoconf staged"
ls "$DEST/bin"
du -sh "$DEST"
