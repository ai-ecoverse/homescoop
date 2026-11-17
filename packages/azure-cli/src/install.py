#!/usr/bin/env python3
"""Install the files of wheels.lock into one directory, as pip --no-deps would.

  python3 -S -B install.py <site dir> <wheels.lock> <download dir> <notices.md>

Run at build time by build.sh, with the build machine's python3, after every
file of the lock is downloaded into <download dir> and checked against the
lock's sha256. For each entry:

  wheel        unpacked as pip --target lays a wheel out: <name>.data/purelib
               and platlib into the top, the .dist-info kept; <name>.data/
               scripts (upstream's shell `az`, az.bat, az.completion.sh),
               headers and data are left out, and so are Windows .exe files
               (setuptools' script launchers).
  sdist:<dir>  only the Python package <dir> of the sdist (PyYAML's lib/yaml:
               its C accelerator is optional), with a .dist-info of the
               sdist's PKG-INFO as METADATA, its LICENSE and a RECORD, so
               importlib.metadata sees it as pip would.

Then <notices.md> lists every distribution with its version, its license as
its metadata gives it, and where in lib/azure-cli its license text is.

A path two distributions both ship must have the same bytes in each (the
azure-* namespace __init__.py files), or the install fails. Nothing is
compiled and no __pycache__ is written.
"""
import base64
import hashlib
import os
import sys
import tarfile
import zipfile


def die(msg):
    sys.exit(f"install.py: {msg}")


def safe(rel):
    parts = rel.split("/")
    if rel.startswith("/") or ".." in parts or "" in parts[:-1] or "\\" in rel:
        die(f"unsafe path {rel!r}")
    return rel


class Site:
    def __init__(self, root):
        self.root = root
        self.owner = {}

    def put(self, rel, data, who):
        rel = safe(rel)
        path = os.path.join(self.root, rel)
        if rel in self.owner:
            with open(path, "rb") as f:
                if f.read() != data:
                    die(f"{rel} differs between {self.owner[rel]} and {who}")
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        self.owner[rel] = who


def record_line(rel, data):
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
    return f"{rel},sha256={digest},{len(data)}"


def wheel(site, path, who):
    dropped = 0
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            name = info.filename
            if name.endswith("/"):
                continue
            if "/__pycache__/" in f"/{name}" or name.endswith((".pyc", ".pyo")):
                continue
            head, _, rest = name.partition("/")
            if head.endswith(".data"):
                kind, _, rest = rest.partition("/")
                if kind in ("purelib", "platlib"):
                    name = rest
                else:
                    dropped += 1
                    continue
            if name.endswith(".exe"):
                dropped += 1
                continue
            if name.endswith((".so", ".pyd", ".dylib", ".dll")):
                die(f"{who}: native file {name} in a pure wheel")
            site.put(name, z.read(info), who)
    return dropped


def sdist(site, path, pkgdir, name, version, who):
    with tarfile.open(path) as t:
        members = t.getmembers()
        top = members[0].name.split("/")[0]
        prefix = f"{top}/{pkgdir}/"
        pkginfo = t.extractfile(f"{top}/PKG-INFO").read()
        license_text = t.extractfile(f"{top}/LICENSE").read()
        dest = os.path.basename(pkgdir)
        record = []
        for m in members:
            if not m.name.startswith(prefix) or not m.isfile():
                continue
            rel = m.name[len(prefix):]
            if not rel.endswith(".py"):
                continue
            data = t.extractfile(m).read()
            site.put(f"{dest}/{rel}", data, who)
            record.append(record_line(f"{dest}/{rel}", data))
    if not record:
        die(f"{who}: no .py under {pkgdir} in {os.path.basename(path)}")
    info = f"{name.replace('-', '_')}-{version}.dist-info"
    site.put(f"{info}/METADATA", pkginfo, who)
    record.append(record_line(f"{info}/METADATA", pkginfo))
    site.put(f"{info}/licenses/LICENSE", license_text, who)
    record.append(record_line(f"{info}/licenses/LICENSE", license_text))
    record.append(f"{info}/RECORD,,")
    site.put(f"{info}/RECORD", ("\n".join(sorted(record)) + "\n").encode(), who)


def notices(root, out, version):
    """THIRD-PARTY-NOTICES.md: each distribution, its license, its license files."""
    from email.parser import HeaderParser

    rows = []
    for d in sorted(os.listdir(root), key=str.lower):
        if not d.endswith(".dist-info"):
            continue
        with open(os.path.join(root, d, "METADATA"), encoding="utf-8") as f:
            meta = HeaderParser().parse(f)
        name, ver = meta["Name"], meta["Version"]
        lic = meta.get("License-Expression") or (meta.get("License") or "").strip().splitlines()[0:1]
        if isinstance(lic, list):
            lic = lic[0] if lic and len(lic[0]) <= 80 else ""
        classifiers = [c.split(" :: ")[-1] for c in meta.get_all("Classifier") or [] if c.startswith("License ::")]
        label = lic or ", ".join(classifiers) or "not stated in its metadata"
        files = []
        for base, _dirs, names in os.walk(os.path.join(root, d)):
            for n in names:
                if n.upper().startswith(("LICEN", "COPYING", "NOTICE", "AUTHORS")):
                    files.append(os.path.relpath(os.path.join(base, n), root))
        rows.append((name, ver, label, sorted(files)))
    lines = [
        "# Third-party notices",
        "",
        f"@ai-ecoverse/azure-cli {version} is the Azure CLI (MIT, `LICENSE`) with the Python",
        "distributions upstream pins for it, unmodified, under `lib/azure-cli`. Each",
        "keeps its own license, as its metadata states it below. The license texts",
        "are the ones each distribution ships, in its `.dist-info` under `lib/azure-cli`;",
        "the distributions marked \"no license file\" ship none in their wheel.",
        "",
        "| distribution | version | license | license text |",
        "| --- | --- | --- | --- |",
    ]
    for name, ver, label, files in rows:
        where = "<br>".join(f"`lib/azure-cli/{f}`" for f in files) or "no license file"
        lines.append(f"| {name} | {ver} | {label.replace('|', '/')} | {where} |")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"install.py: {len(rows)} distributions in {os.path.basename(out)}, "
          f"{sum(not r[3] for r in rows)} with no license file")


def main():
    root, lock, downloads, out = sys.argv[1:]
    os.makedirs(root, exist_ok=True)
    site = Site(root)
    n = 0
    for line in open(lock, encoding="utf-8"):
        if line.startswith("#") or not line.strip():
            continue
        name, version, _pin, kind, _sha, url = line.split()
        path = os.path.join(downloads, url.rsplit("/", 1)[1])
        who = f"{name}=={version}"
        if kind == "wheel":
            dropped = wheel(site, path, who)
            if dropped:
                print(f"  {who}: left out {dropped} scripts/data files")
        elif kind.startswith("sdist:"):
            sdist(site, path, kind.split(":", 1)[1], name, version, who)
            print(f"  {who}: the Python package {kind.split(':', 1)[1]} of the sdist")
        else:
            die(f"unknown kind {kind} for {who}")
        n += 1
    print(f"install.py: {n} distributions, {len(site.owner)} files")
    version = next(l.split()[2] for l in open(lock, encoding="utf-8") if l.startswith("# azure-cli "))
    notices(root, out, version)


if __name__ == "__main__":
    main()
