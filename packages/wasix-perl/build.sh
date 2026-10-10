#!/usr/bin/env bash
# Cross-build Perl 5.42.0 for slicc WASIX via perl-cross + wasixcc.
# Stages bin/perl.wasm + lib/perl5 + core scripts (prove, pod2man, cpan, perldoc).
set -euo pipefail

HOMESCOOP_ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=/dev/null
source "$HOMESCOOP_ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-perl

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
VER="$VERSION"
WORK="${WASIX_PERL_WORK:-$PKG/work}"
SRC="$WORK/perl-build"
STAGE="${WASIX_PERL_STAGE:-$WORK/stage}"
PREFIX_INSTALL="$STAGE"

# No wasixcc on PATH (CI runners): install the pinned toolchain, which
# brings wasix-sysroot (asyncify tree "sysroot" for real fork).
if ! command -v wasixcc >/dev/null && [[ ! -x "${WASIXCC_PREFIX:-$HOME/.wasixcc}/bin/wasixcc" ]]; then
  eval "$(bash "$HOMESCOOP_ROOT/scripts/install-wasixcc.sh")"
fi
WASM_OPT="${WASM_OPT:-${WASIXCC_BINARYEN_LOCATION:-$HOME/.wasixcc/binaryen}/bin/wasm-opt}"

# GNU sed required: perl-cross cnf/*.sh uses sed -r and \s (BSD sed breaks version detect).
export PATH="/opt/homebrew/opt/gnu-sed/libexec/gnubin:/opt/homebrew/opt/binutils/bin:${WASIXCC_PREFIX:-$HOME/.wasixcc}/bin:${WASIXCC_LLVM_LOCATION:-$HOME/.wasixcc/llvm}/bin:/opt/homebrew/bin:$PATH"

# Asyncify sysroot (real fork). Not ehpic — PIC EH trees stub fork.
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS="${WASIXCC_WASM_EXCEPTIONS:-no}"
export WASIXCC_PIC=no
export WASIXCC_MODULE_KIND="${WASIXCC_MODULE_KIND:-static-main}"
unset FREETYPE FREETYPE_ROOT JPEG JPEG_ROOT PNG_ROOT ZLIB_ROOT VIRTUAL_ENV
unset PKG_CONFIG_LIBDIR ZLIB CFLAGS CPPFLAGS LDFLAGS CXX

command -v wasixcc >/dev/null
command -v sed >/dev/null
sed --version 2>&1 | head -1 | grep -qi GNU || {
  echo "homescoop wasix-perl: need GNU sed on PATH (brew install gnu-sed)" >&2
  exit 1
}

mkdir -p "$WORK" "$DEST"

if [[ -n "${WASIX_PERL_STAGE:-}" && -f "$WASIX_PERL_STAGE/bin/perl.wasm" ]]; then
  echo "== wasix-perl: using prebuilt stage $WASIX_PERL_STAGE"
  STAGE="$WASIX_PERL_STAGE"
else
  TARBALL="$WORK/perl-${VER}.tar.xz"
  homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"

  if [[ ! -d "$SRC/.homescoop-perl-cross" ]]; then
    echo "== extract perl + overlay perl-cross"
    rm -rf "$SRC"
    mkdir -p "$SRC"
    tar xJf "$TARBALL" -C "$SRC" --strip-components=1
    chmod -R u+w "$SRC"
    # perl-cross, pinned in recipe.yaml (sources.perl_cross).
    homescoop_load_recipe wasix-perl --source perl_cross
    PC_TGZ="$WORK/$(basename "$PERL_CROSS_SRC_URL")"
    homescoop_fetch "$PERL_CROSS_SRC_URL" "$PERL_CROSS_SRC_SHA" "$PC_TGZ"
    rm -rf "$WORK/perl-cross"
    mkdir -p "$WORK/perl-cross"
    tar xzf "$PC_TGZ" -C "$WORK/perl-cross" --strip-components=1
    # Overlay without clobbering perl's LICENSE etc. where identical is fine.
    cp -a "$WORK/perl-cross/." "$SRC/"
    touch "$SRC/.homescoop-perl-cross"
  fi

  cp "$PKG/hints/wasix" "$SRC/cnf/hints/wasix"
  # perl-cross 1.6.5's --hints loads nothing (see the patch header).
  if grep -q "tryhints 'hint'" "$SRC/cnf/configure_hint.sh"; then
    patch -d "$SRC" -p1 --no-backup-if-mismatch < "$PKG/patches/0002-userhints-tryhints-arg.patch"
  fi

  # List::Util must stay on when usedl=undef (all-static).
  if grep -q 'extonlyif cpan/List-Util "\$usedl" !=' "$SRC/cnf/configure_mods.sh"; then
    sed -i 's/^extonlyif cpan\/List-Util "\$usedl" != '\''undef'\''/# wasix-perl: keep List::Util static\n# &/' \
      "$SRC/cnf/configure_mods.sh" 2>/dev/null || \
    python3 - "$SRC/cnf/configure_mods.sh" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = 'extonlyif cpan/List-Util "$usedl" != \'undef\'\n'
if old in t:
    p.write_text(t.replace(old, '# wasix-perl: keep List::Util static\n# ' + old, 1))
PY
  fi

  homescoop_apply_patches "$SRC"

  # Static build (usedl=undef): ext/re is linked next to the core regex
  # engine; patches/0003 adds perl 5.42's split regcomp helpers to
  # re_top.h's my_* renames (see the patch header).
  if ! grep -q my_reg_add_data "$SRC/ext/re/re_top.h"; then
    patch -d "$SRC" -p1 --no-backup-if-mismatch < "$PKG/patches/0003-re-top-static-split-helpers.patch"
  fi

  # Errno_pm.PL picks its errno.h by $^O, the build machine's OS: on a Linux
  # host it reads /usr/include/errno.h. Key it on the target's osname, so
  # wasix takes the generic branch (the target cpp on #include <errno.h>,
  # which follows wasix's bits/errno.h).
  python3 - "$SRC/ext/Errno/Errno_pm.PL" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text()
n = t.count("$^O eq 'linux'")
if n != 2:
    sys.exit(f"{p}: expected 2 linux checks, found {n}")
t = t.replace("$^O eq 'linux'", "$Config{osname} eq 'linux'")
# wasixcc's preprocess-only mode (-E -P -) passes no --sysroot; add it from
# the environment (set for make below), so Config.pm keeps no build path.
old = 'return "$cppstdin $Config{cppflags} $Config{cppminus}";'
if t.count(old) != 1:
    sys.exit(f"{p}: default_cpp return not found")
# get_files() finds the headers from cpp's line markers, so drop the -P that
# perl-cross's cppstdin carries (the second cpp call adds its own inhibit).
t = t.replace(old, 'my $r = "$cppstdin $Config{cppflags} $Config{cppminus}"; if ($ENV{HOMESCOOP_TARGET_SYSROOT}) { $r =~ s/\\s-P(?=\\s|$)//g; $r =~ s/^(\\S+)/$1 --sysroot=$ENV{HOMESCOOP_TARGET_SYSROOT}/; } return $r;')
p.write_text(t)
PY

  EMU_CFLAGS="-D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN"
  # asyncify sysroot has no -lwasi-emulated-signal
  EMU_LIBS="-lwasi-emulated-getpid -lwasi-emulated-process-clocks -lwasi-emulated-mman -lm"

  cd "$SRC"
  if [[ ! -f config.sh ]] || [[ -n "${FORCE_CONFIGURE:-}" ]]; then
    echo "== configure wasm32-wasix"
    # Clean prior config fragments
    rm -f config.sh config.h config.h.SH Policy.sh
    ./configure \
      --target=wasm32-wasix \
      --hints=wasix \
      --prefix=/usr \
      -Dcc=wasixcc \
      -Dld=wasixcc \
      -Dar=wasixar \
      -Dranlib=wasixranlib \
      -Dreadelf="$(command -v readelf)" \
      -Dobjdump="$(command -v objdump)" \
      -Dnm="$(command -v nm)" \
      -Dusedl=undef \
      -Dusethreads=undef \
      -Duseithreads=undef \
      -Dusemymalloc=n \
      -Accflags="-O2 -D_GNU_SOURCE -DNO_LOCALE -DHAS_DEFINITIVE_UTF8NESS_DETERMINATION $EMU_CFLAGS -fno-strict-aliasing -include $PKG/wasix-posix-stubs.h" \
      -Aldflags="$EMU_LIBS" \
      -Alibs="$EMU_LIBS" \
      -Dman1dir=none \
      -Dman3dir=none \
      2>&1 | tee "$WORK/configure-wasix.log"
  fi

  # Cross-configure cannot run probes — force wasix-libc features from
  # systematic libc.a nm sweep (+ stubs for dying builtins missing from libc).
  echo "== force wasix-libc d_* in config.sh (systematic sweep)"
  python3 - "$SRC/config.sh" "$PKG/hints/wasix" <<'PY'
import re, sys
from pathlib import Path
cfg_path, hints_path = Path(sys.argv[1]), Path(sys.argv[2])
hints = hints_path.read_text()
# Prefer the auto sweep block in hints if present
force_def, force_undef = set(), set()
in_auto = False
for ln in hints.splitlines():
    if 'homescoop systematic d_* sweep' in ln:
        in_auto = True
        continue
    if in_auto:
        if ln.startswith("d_") and "='" in ln:
            k, _, v = ln.partition("=")
            v = v.strip().strip("'")
            (force_def if v == "define" else force_undef).add(k)
        elif ln.startswith("libswanted=") or (ln.startswith("#") and "sweep" not in ln and force_def):
            if ln.startswith("libswanted="):
                break
# Always keep these
force_undef |= {
    "d_fcntl_can_lock", "d_pseudofork", "d_dosuid", "d_suidsafe",
    "d_portable", "d_eunice", "d_bsd", "d_procselfexe", "d_socks5_init",
}
force_def -= force_undef
t = cfg_path.read_text()
for k in sorted(force_def):
    if re.search(rf"^{k}=", t, re.M):
        t = re.sub(rf"^{k}='[^']*'", f"{k}='define'", t, count=1, flags=re.M)
    else:
        t += f"\n{k}='define'\n"
for k in sorted(force_undef):
    if re.search(rf"^{k}=", t, re.M):
        t = re.sub(rf"^{k}='[^']*'", f"{k}='undef'", t, count=1, flags=re.M)
    else:
        t += f"\n{k}='undef'\n"
# All-static (usedl=undef): no PIC objects. wasixcc refuses -fPIC without
# wasm exceptions, and XS Makefiles (Devel-PPPort's module2.o) add
# $Config{cccdlflags}; an empty hint falls back to perl-cross's -fPIC.
t = re.sub(r"^cccdlflags='[^']*'", "cccdlflags=' '", t, count=1, flags=re.M)
cfg_path.write_text(t)
print(f"forced define={len(force_def)} undef={len(force_undef)}")
PY
  (cd "$SRC" && sh config_h.SH)
  # xconfig.h is the host miniperl's (perl-cross: xconfig.sh), not a copy of
  # the target config.h; regenerate it from xconfig.sh.
  (cd "$SRC" && CONFIG_SH=xconfig.sh CONFIG_H=xconfig.h sh config_h.SH)

  echo "== make (host miniperl + target perl)"
  # Strip -fPIC from XS: asyncify sysroot rejects PIC objects.
  # CFLAGS already omit -fPIC via WASIXCC_PIC=no; force in Makefile.config if make re-adds.
  if [[ -f Makefile.config ]]; then
    sed -i.bak -E 's/ -fPIC//g; s/-fPIC //g' Makefile.config || true
  fi
  # Errno_pm.PL's target cpp (see above).
  export HOMESCOOP_TARGET_SYSROOT="${WASIXCC_SYSROOT_PREFIX:-$HOME/.wasixcc/sysroot}/sysroot"
  test -f "$HOMESCOOP_TARGET_SYSROOT/include/errno.h"
  make -j"${HOMESCOOP_JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}" \
    2>&1 | tee "$WORK/make-wasix.log" || true

  # Final link: perl-cross/wasm-ld often fails on main rename + re.a dups.
  # wasixcc renames int main → __main_argc_argv; K&R/3-arg main needs:
  #   -DNO_ENV_ARRAY_IN_MAIN -Dmain=__main_argc_argv
  # Full ext/re/*.o required (my_reg*; the split helpers are renamed in re_top.h).
  # Locale: -DHAS_LOCALECONV so NO_LOCALE stub UTF8 helpers exist.
  # Always: make's own link does not handle perl's 3-argument main.
  if true; then
    echo "== homescoop final link (wasixcc static-main)"
    PKG_ROOT="$PKG"
    wasixcc -DPERL_CORE -Wno-incompatible-function-pointer-types -Wno-implicit-function-declaration \
      -include "$PKG_ROOT/wasix-posix-stubs.h" -DNO_LOCALE -DHAS_LOCALECONV \
      -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64 -O2 $EMU_CFLAGS \
      -fno-strict-aliasing -c -o locale.o locale.c
    llvm-ar r libperl.a locale.o
    wasixcc -DPERL_CORE -Wno-incompatible-function-pointer-types -Wno-implicit-function-declaration \
      -include "$PKG_ROOT/wasix-posix-stubs.h" -DNO_LOCALE -DNO_ENV_ARRAY_IN_MAIN \
      -Dmain=__main_argc_argv \
      -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64 -O2 $EMU_CFLAGS \
      -fno-strict-aliasing -c -o perlmain.o perlmain.c
    (cd ext/re && llvm-ar crs ../../lib/auto/re/re.a \
      re.o re_comp.o re_comp_debug.o re_comp_invlist.o re_comp_study.o re_comp_trie.o re_exec.o)
    # static.list is one line of space-separated archives.
    read -r -a STATARS < static.list
    # Drop -lwasi-emulated-signal (absent from asyncify sysroot).
    wasixcc -lwasi-emulated-getpid -lwasi-emulated-process-clocks -lwasi-emulated-mman -lm \
      -o perl perlmain.o libperl.a "${STATARS[@]}" -lm \
      2>&1 | tee "$WORK/link-wasix.log"
  fi
  [[ -f perl ]] || { echo "homescoop: perl link failed" >&2; exit 1; }

  # make's own perl link fails (perlmain.c's 3-argument main needs the
  # -Dmain=__main_argc_argv compile above), and make stops there: the targets
  # after the link (pm_to_blib for List::Util, File::Spec, ...) never ran.
  # With the newer perl in place, a second make finishes them.
  echo "== make (second pass, after the homescoop link)"
  make -j"${HOMESCOOP_JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}" \
    2>&1 | tee -a "$WORK/make-wasix.log" || true
  # perl-cross builds static extensions with `make … LINKTYPE=static static`,
  # MakeMaker's target for the .a only; pm_to_blib (lib/List/Util.pm,
  # lib/File/Spec.pm, …) is part of pure_all. Copy their modules too.
  for ext in $(sed -n 's/^fullpath_static_ext *= *//p' Makefile.config); do
    # The `static` run leaves a 0-byte pm_to_blib stamp without copying.
    rm -f "$ext/pm_to_blib"
    make -C "$ext" PERL_CORE=1 LIBPERL=libperl.a LINKTYPE=static pm_to_blib \
      2>&1 | tee -a "$WORK/make-wasix.log"
  done

  echo "== make install DESTDIR=$STAGE (best-effort; may fall back to manual stage)"
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  make DESTDIR="$STAGE" install 2>&1 | tee "$WORK/install-wasix.log" || true
  # Ensure binary is present for staging even if installperl skipped wasm
  mkdir -p "$STAGE/usr/bin"
  cp -f perl "$STAGE/usr/bin/perl"
fi

echo "== stage package tree"
rm -rf "$DEST/bin" "$DEST/lib" "$DEST/share"
mkdir -p "$DEST/bin" "$DEST/lib" "$DEST/share"

# Installed under DESTDIR/usr/...
INST="$STAGE/usr"
PERL_BIN=$(find "$INST" -type f -name 'perl' -print -quit)
[[ -n "$PERL_BIN" && -f "$PERL_BIN" ]] || {
  # Some builds name the wasm with .wasm already
  PERL_BIN=$(find "$INST" -type f \( -name 'perl' -o -name 'perl.wasm' \) -print -quit)
}
[[ -f "$PERL_BIN" ]] || { echo "no perl binary under $INST" >&2; find "$STAGE" -type f | head -40; exit 1; }

cp "$PERL_BIN" "$DEST/bin/perl.wasm"
chmod +x "$DEST/bin/perl.wasm"

# Asyncify: do NOT use asyncify-ignore-indirect — Perl opcode dispatch is
# indirect (pp_*), and ignore-indirect makes require/XS unwind as unreachable.
# Do NOT use a tight onlylist for the same reason. Expect ~7MB+ wasm.
if [[ -x "$WASM_OPT" ]]; then
  echo "== asyncify perl.wasm (full, with indirect)"
  PRE=$(stat -f%z "$DEST/bin/perl.wasm" 2>/dev/null || stat -c%s "$DEST/bin/perl.wasm")
  "$WASM_OPT" --asyncify -O1 \
    --pass-arg=asyncify-imports@wasix_32v1.proc_fork,wasix_32v1.stack_checkpoint,wasix_32v1.stack_restore \
    "$DEST/bin/perl.wasm" -o "$DEST/bin/perl.wasm.tmp" \
    2>&1 | tee "$WORK/asyncify.log" | tail -40
  mv "$DEST/bin/perl.wasm.tmp" "$DEST/bin/perl.wasm"
  POST=$(stat -f%z "$DEST/bin/perl.wasm" 2>/dev/null || stat -c%s "$DEST/bin/perl.wasm")
  echo "asyncify size: $PRE -> $POST"
else
  echo "WARN: wasm-opt not found; skipping asyncify (fork will not work)" >&2
fi

# Pure-Perl lib tree, real directories. Same flat layout as -6 (manifest
# PERL5LIB = lib/perl5:lib/perl5/wasm32-wasix): privlib's contents go to
# lib/perl5, so its wasm32-wasix/ (archlib) lands at lib/perl5/wasm32-wasix.
PRIVLIB="$INST/lib/perl5/$VER"
[[ -d "$PRIVLIB" ]] || { echo "no privlib $PRIVLIB under $INST" >&2; find "$INST" -maxdepth 4 -type d >&2; exit 1; }
mkdir -p "$DEST/lib/perl5"
cp -a "$PRIVLIB/." "$DEST/lib/perl5/"
# Gap-fill from the build tree's lib/ (modules installperl left out), never
# tests; an archlib module is filled into wasm32-wasix/ when it lives there.
python3 - "$SRC/lib" "$DEST/lib/perl5" <<'PY'
import shutil, sys
from pathlib import Path
src, dest = Path(sys.argv[1]), Path(sys.argv[2])
filled = []
for f in sorted(src.rglob("*")):
    if not f.is_file() or f.suffix not in {".pm", ".pl", ".pod", ".al", ".ix"}:
        continue
    rel = f.relative_to(src)
    if (dest / rel).exists() or (dest / "wasm32-wasix" / rel).exists():
        continue
    (dest / rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(f, dest / rel)
    filled.append(str(rel))
print(f"gap-filled {len(filled)} files from the build lib: {', '.join(filled[:12])}{' …' if len(filled) > 12 else ''}")
PY

# make and make install are best-effort (|| true): refuse a tree that lacks
# modules from extensions built after the perl link.
for m in List/Util.pm File/Spec.pm Cwd.pm POSIX.pm Digest/SHA.pm Fcntl.pm Errno.pm; do
  if [[ -z "$(find "$DEST/lib/perl5" -path "*/$m" -print -quit)" ]]; then
    echo "homescoop wasix-perl: staged lib lacks $m (see $WORK/make-wasix.log)" >&2
    # Where did it go? Build tree, ext dir, install tree.
    (
      cd "$SRC"
      echo "-- build lib:"; find lib -path "*/$m" 2>/dev/null | head -3
      echo "-- Scalar-List-Utils:"; ls -la cpan/Scalar-List-Utils | head -20
      echo "-- its PM map:"; sed -n '/^PM_TO_BLIB/,/^$/p;/^TO_INST_PM/,/^$/p' cpan/Scalar-List-Utils/Makefile | head -20
      echo "-- install tree:"; find "$STAGE" -path "*/$m" 2>/dev/null | head -3
    ) >&2 || true
    exit 1
  fi
done

# Flatten any symlinks (npm/ipk skip links)
python3 - "$DEST/lib" <<'PY'
import shutil, sys
from pathlib import Path
root = Path(sys.argv[1])
for p in sorted(root.rglob("*"), reverse=True):
    if not p.is_symlink():
        continue
    try:
        target = p.resolve(strict=False)
    except Exception:
        p.unlink(missing_ok=True)
        continue
    p.unlink()
    if target.is_dir():
        shutil.copytree(target, p, symlinks=False)
    elif target.is_file():
        shutil.copy2(target, p)
print("symlinks cleared under", root)
PY

# Core scripts that matter for build tooling
SCRIPTS_DIR=$(find "$INST" -type d -name 'bin' -print -quit)
for s in prove pod2man perldoc cpan pod2text pod2html; do
  src=$(find "$INST" -type f -name "$s" -print -quit 2>/dev/null)
  if [[ -n "$src" ]]; then
    # Strip host shebang path → #!/usr/bin/env perl (slicc maps perl)
    mkdir -p "$DEST/bin"
    sed '1s|^#!.*perl.*|#!/usr/bin/env perl|' "$src" > "$DEST/bin/$s"
    chmod +x "$DEST/bin/$s"
  fi
done

homescoop_stage_license "$SRC/Artistic" "$SRC/Copying" "$SRC/LICENSE" "$WORK/perl-build/Artistic"
homescoop_notices_begin "perl.wasm statically links the following."
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2025-09-02.1
homescoop_notice "wasix-libc (@ai-ecoverse/wasix-sysroot 2025.9.30; files from tag v2025-09-02.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af \
  "$WLIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0

# package.json / README written separately; refresh version stamp if present
if [[ -f "$DEST/package.json" ]]; then
  node -e "
const fs=require('fs');
const p='$DEST/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
if (!String(j.version || '').startsWith('${VER}-')) j.version='${VER}-1';
j.homescoop={recipe:'wasix-perl',upstream:'${VER}'};
fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
"
fi

echo "== wasix-perl staged"
ls -la "$DEST/bin" | head
du -sh "$DEST/bin/perl.wasm" "$DEST/lib" 2>/dev/null || true
