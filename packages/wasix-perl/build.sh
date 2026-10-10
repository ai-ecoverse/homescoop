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
      -Accflags="-O2 -DNO_LOCALE -DHAS_DEFINITIVE_UTF8NESS_DETERMINATION $EMU_CFLAGS -fno-strict-aliasing -include $PKG/wasix-posix-stubs.h" \
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
cfg_path.write_text(t)
print(f"forced define={len(force_def)} undef={len(force_undef)}")
PY
  (cd "$SRC" && sh config_h.SH)
  cp -f "$SRC/config.h" "$SRC/xconfig.h"

  echo "== make (host miniperl + target perl)"
  # Strip -fPIC from XS: asyncify sysroot rejects PIC objects.
  # CFLAGS already omit -fPIC via WASIXCC_PIC=no; force in Makefile.config if make re-adds.
  if [[ -f Makefile.config ]]; then
    sed -i.bak -E 's/ -fPIC//g; s/-fPIC //g' Makefile.config || true
  fi
  make -j"${HOMESCOOP_JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}" \
    2>&1 | tee "$WORK/make-wasix.log" || true

  # Final link: perl-cross/wasm-ld often fails on main rename + re.a dups.
  # wasixcc renames int main → __main_argc_argv; K&R/3-arg main needs:
  #   -DNO_ENV_ARRAY_IN_MAIN -Dmain=__main_argc_argv
  # Full ext/re/*.o required (my_reg*); --allow-multiple-definition vs libperl.
  # Locale: -DHAS_LOCALECONV so NO_LOCALE stub UTF8 helpers exist.
  if [[ ! -f perl ]] || [[ "${FORCE_RELINK:-}" == 1 ]]; then
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
    export WASIXCC_LINKER_FLAGS="--allow-multiple-definition"
    mapfile -t STATARS < static.list || STATARS=($(cat static.list))
    # Drop -lwasi-emulated-signal (absent from asyncify sysroot).
    wasixcc -lwasi-emulated-getpid -lwasi-emulated-process-clocks -lwasi-emulated-mman -lm \
      -o perl perlmain.o libperl.a "${STATARS[@]}" -lm \
      2>&1 | tee "$WORK/link-wasix.log"
  fi
  [[ -f perl ]] || { echo "homescoop: perl link failed" >&2; exit 1; }

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
PERL_BIN=$(find "$INST" -type f -name 'perl' | head -1)
[[ -n "$PERL_BIN" && -f "$PERL_BIN" ]] || {
  # Some builds name the wasm with .wasm already
  PERL_BIN=$(find "$INST" -type f \( -name 'perl' -o -name 'perl.wasm' \) | head -1)
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

# Pure-Perl lib tree — real directories, no symlinks
LIBSRC=$(find "$INST" -type d -path '*/lib/perl5*' | head -1)
if [[ -z "$LIBSRC" ]]; then
  LIBSRC=$(find "$INST" -type d -name 'perl5' | head -1)
fi
[[ -d "$LIBSRC" ]] || { echo "no perl5 lib under $INST" >&2; exit 1; }
# Prefer arch+version layout under lib/perl5
mkdir -p "$DEST/lib"
# Copy entire usr/lib/perl5 if present
if [[ -d "$INST/lib/perl5" ]]; then
  cp -a "$INST/lib/perl5" "$DEST/lib/"
else
  mkdir -p "$DEST/lib/perl5"
  cp -a "$LIBSRC/." "$DEST/lib/perl5/"
fi

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
SCRIPTS_DIR=$(find "$INST" -type d -name 'bin' | head -1)
for s in prove pod2man perldoc cpan pod2text pod2html; do
  src=$(find "$INST" -type f -name "$s" 2>/dev/null | head -1)
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
