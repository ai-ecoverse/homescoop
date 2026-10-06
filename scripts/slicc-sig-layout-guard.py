#!/usr/bin/env python3
"""Guard relink recipes against pre-Oct-2026 musl sigset_t / sigaction layouts.

slicc-emscripten's musl sigset_t went 16 → 128 bytes (struct sigaction 20 → 140)
on 2026-10-01. Relinking .o/.a compiled before that date against today's EM_CACHE
corrupts memory. --version still passes; the failure is a trap at shutdown or
"Option … registered more than once".

This scans the ninja graph for objects that are actually linked, greps their
sources (and first-party headers that inline sigaction) for layout tokens,
recompiles the allowlisted hits with today's emcc, and fails if a new source
appears that is not on the allowlist.

Usage:
  slicc-sig-layout-guard.py --ninja BUILD/build.ninja \\
    --allowlist packages/foo/sig-layout-sources.txt \\
    --archive libfoo.a --object extra.o [--recompile]
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

SIG_RE = re.compile(
    r"\b(sigaction|sigprocmask|sigset_t|struct\s+sigaction)\b"
)
INCLUDE_RE = re.compile(
    r'^\s*#\s*include\s*[<"]([^>"]+)[>"]', re.MULTILINE
)
# Headers whose inlines lay out sigaction / sigset_t in every including TU.
LAYOUT_HEADERS = frozenset(
    {
        "sigpipe.h",
        "curl/sigpipe.h",
    }
)

BUILD_RE = re.compile(r"^build (.+): (\S+)(?: (.+))?$")


def parse_ninja(ninja: Path) -> tuple[dict[str, str], dict[str, list[str]], Path]:
    """Return (object_relpath -> source, archive_relpath -> [object_relpath], workdir)."""
    text = ninja.read_text(errors="replace").splitlines()
    workdir = ninja.parent.resolve()
    for line in text:
        if line.startswith("cmake_ninja_workdir"):
            _, _, val = line.partition("=")
            workdir = Path(val.strip().rstrip("/") + "/")
            break

    obj_src: dict[str, str] = {}
    archives: dict[str, list[str]] = {}
    i = 0
    while i < len(text):
        m = BUILD_RE.match(text[i])
        i += 1
        if not m:
            continue
        outs_raw, rule, rest = m.group(1), m.group(2), m.group(3) or ""
        outs = [p.strip() for p in outs_raw.split() if p.strip()]
        ins = []
        order = rest.split("||", 1)[0]
        implicit = order.split("|", 1)[0]
        for tok in implicit.split():
            if tok in ("$in", "$out"):
                continue
            ins.append(tok)
        if "STATIC_LIBRARY" in rule:
            objs = [p for p in ins if p.endswith(".o")]
            for out in outs:
                if out.endswith(".a"):
                    archives[norm(out)] = objs
            continue
        if "COMPILER" in rule or rule.endswith("_COMPILER"):
            srcs = [
                p
                for p in ins
                if p.endswith((".c", ".cc", ".cpp", ".cxx", ".C", ".m", ".mm"))
            ]
            if len(outs) == 1 and outs[0].endswith(".o") and srcs:
                obj_src[norm(outs[0])] = srcs[0]
    return obj_src, archives, workdir


def norm(p: str) -> str:
    return p.replace("\\", "/").lstrip("./")


def read_allowlist(path: Path) -> set[str]:
    lines = []
    for raw in path.read_text().splitlines():
        s = raw.split("#", 1)[0].strip()
        if s:
            lines.append(norm(s))
    return set(lines)


def file_has_layout(path: Path) -> bool:
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return False
    if SIG_RE.search(text):
        return True
    for inc in INCLUDE_RE.findall(text):
        base = inc.replace("\\", "/").split("/")[-1]
        if base in LAYOUT_HEADERS or inc in LAYOUT_HEADERS:
            return True
    return False


def source_key(src: str, src_root: Path | None) -> str:
    p = Path(src)
    if src_root is not None:
        try:
            return norm(str(p.resolve().relative_to(src_root.resolve())))
        except ValueError:
            pass
    return norm(str(p))


def collect_hits(
    obj_src: dict[str, str],
    archives: dict[str, list[str]],
    archive_args: list[str],
    object_args: list[str],
    src_root: Path | None,
) -> dict[str, list[str]]:
    """source_key -> [object relpaths]."""
    wanted_objs: list[str] = []
    for a in archive_args:
        key = norm(a)
        if key not in archives:
            # allow basename match
            hits = [k for k in archives if k.endswith("/" + key) or k == key]
            if not hits:
                raise SystemExit(f"slicc-sig-layout-guard: archive not in ninja: {a}")
            key = hits[0]
        wanted_objs.extend(archives[key])
    wanted_objs.extend(norm(o) for o in object_args)

    by_src: dict[str, list[str]] = {}
    missing_src = []
    for obj in wanted_objs:
        objn = norm(obj)
        src = obj_src.get(objn)
        if src is None:
            # ninja paths are relative to build dir
            alt = [k for k in obj_src if k.endswith("/" + objn) or k == objn]
            if alt:
                objn = alt[0]
                src = obj_src[objn]
        if src is None:
            missing_src.append(obj)
            continue
        sp = Path(src)
        if not sp.is_absolute():
            # sources in ninja are absolute in this tree; if not, leave as-is
            pass
        if not file_has_layout(sp if sp.is_absolute() else sp):
            continue
        key = source_key(src, src_root)
        by_src.setdefault(key, []).append(objn)
    if missing_src:
        print(
            "slicc-sig-layout-guard: note: no ninja source for "
            + ", ".join(missing_src[:8]),
            file=sys.stderr,
        )
    return by_src


def recompile(build_dir: Path, objects: list[str], archives: list[str]) -> None:
    """Rebuild only the listed .o files, then emar-replace them into archives.

    Do not ninja the .a targets: that restats emcc vs every member and can
    rebuild hundreds of unrelated objects.
    """
    for obj in objects:
        p = build_dir / obj
        if p.exists():
            p.unlink()
            print(f"  rm {obj}")
    print("== slicc-sig-layout-guard: ninja", " ".join(objects))
    subprocess.check_call(["ninja", "-C", str(build_dir), *objects])
    emar = os.environ.get("EMAR") or "emar"
    for archive in archives:
        lib = build_dir / archive
        if not lib.exists():
            print(f"slicc-sig-layout-guard: missing archive {archive}", file=sys.stderr)
            continue
        listed = subprocess.check_output([emar, "t", str(lib)], text=True).splitlines()
        names = {Path(x).name for x in listed}
        refresh = [str(build_dir / o) for o in objects if Path(o).name in names]
        if not refresh:
            continue
        print(f"== slicc-sig-layout-guard: {emar} r {archive} ({len(refresh)} objects)")
        subprocess.check_call([emar, "r", str(lib), *refresh])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ninja", required=True, type=Path)
    ap.add_argument("--allowlist", required=True, type=Path)
    ap.add_argument("--src-root", type=Path, default=None)
    ap.add_argument("--archive", action="append", default=[])
    ap.add_argument("--object", action="append", default=[])
    ap.add_argument("--recompile", action="store_true")
    args = ap.parse_args()

    obj_src, archives, workdir = parse_ninja(args.ninja)
    allow = read_allowlist(args.allowlist)
    hits = collect_hits(obj_src, archives, args.archive, args.object, args.src_root)

    extra = sorted(set(hits) - allow)
    unused = sorted(allow - set(hits))
    if extra:
        print("slicc-sig-layout-guard: NEW sigaction/sigset_t sources not on allowlist:", file=sys.stderr)
        for s in extra:
            print(f"  {s}  ({', '.join(hits[s])})", file=sys.stderr)
        print(
            f"  Add them to {args.allowlist} and recompile; do not relink stale objects.",
            file=sys.stderr,
        )
        return 1
    print(f"== slicc-sig-layout-guard: {len(hits)} layout source(s) (allowlist {len(allow)})")
    for s in sorted(hits):
        print(f"  {s}")
    if unused:
        print("  allowlist entries not in this link set (ok if platform-skipped):")
        for s in unused:
            print(f"    {s}")

    if args.recompile and hits:
        objects = sorted({o for objs in hits.values() for o in objs})
        objset = set(objects)
        touched_archives = []
        for a in args.archive:
            key = norm(a)
            if key not in archives:
                hits_a = [k for k in archives if k.endswith("/" + key) or k == key]
                key = hits_a[0] if hits_a else key
            members = archives.get(key, [])
            if any(norm(m) in objset or m in objset for m in members):
                touched_archives.append(key)
        recompile(workdir, objects, touched_archives)
    elif args.recompile:
        print("== slicc-sig-layout-guard: nothing to recompile")
    return 0


if __name__ == "__main__":
    sys.exit(main())
