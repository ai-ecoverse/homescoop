#!/usr/bin/env python3
"""Write packages/azure-cli/wheels.lock: the pure-Python closure of azure-cli.

  python3 packages/azure-cli/src/lock.py      # needs uv and the network

A maintainer tool, run after a version bump; build.sh only reads the lock.

The closure is upstream's own: src/azure-cli/requirements.py3.Linux.txt at the
release tag, the file Microsoft's deb and rpm builds install (with pip, over
azure-cli, azure-cli-core and azure-cli-telemetry installed from source with
--no-deps). Every pin in it is taken as is, as an override, so a pin that an
azure-cli-* wheel on PyPI declares more narrowly (azure-cli-telemetry 1.1.0
says portalocker<3, upstream ships 3.2.0) still wins, as in upstream's
packages. What the pins leave open (requests' charset_normalizer, knack's
PyYAML and pygments, ...) is resolved by uv for Linux and CPython 3.15, with
nothing newer than the azure-cli release on PyPI (--exclude-newer its upload
time), so running this again for the same release gives the same lock.

Native code comes from homescoop's npm packages, not from PyPI: cffi,
pycparser, cryptography, PyNaCl, bcrypt and pyOpenSSL are the @ai-ecoverse/
py-* packages package/package.json depends on (HOMESCOOP below), built for
wasix-python, and bin/az puts exactly those on sys.path (src/launcher.py).
Their PyPI versions are the ones those npm pins were built from (the
homescoop.upstream of each published package.json), not upstream's pins:
uv resolves the closure with them as plain requirements, so every declared
range of the closure (azure-cli-core's, msal's, paramiko's, ...) must accept
them, and the lock lists them in its header ("# homescoop ...") instead of as
files to fetch. A Renovate bump of azure-cli re-runs this and still fetches no
PyPI wheel for them; moving one is a bump of its npm pin in package.json.

Left out with its reason in the lock's header: psutil, native code with no
wasix build. az imports it only in a try (the parent process's name, for
telemetry and a PowerShell quoting hint).

Each remaining package is the one py3-none-any wheel PyPI has for that
version, or, for the packages in SDIST (no pure wheel on PyPI, but a
pure-Python fallback), the sdist, from which build.sh copies only the Python
package. The lock records each file's URL and PyPI's sha256, and the sha256 of
the requirements file it was made from, which build.sh checks against the
recipe's pin.
"""
import concurrent.futures as cf
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
LOCK = os.path.join(PKG, "wheels.lock")

# Native code with no wasix build: left out. az imports psutil in a try,
# only to name the parent process.
EXCLUDE = {
    "psutil": "native (C), no wasix build; az imports it in a try, only to name the parent process (telemetry, which is off, and a PowerShell quoting hint)",
}

# From homescoop's npm packages instead of PyPI: the distribution, and the
# npm package package/package.json pins for it.
HOMESCOOP = {
    "bcrypt": "@ai-ecoverse/py-bcrypt",
    "cffi": "@ai-ecoverse/py-cffi",
    "cryptography": "@ai-ecoverse/py-cryptography",
    "pycparser": "@ai-ecoverse/py-pycparser",
    "pynacl": "@ai-ecoverse/py-pynacl",
    "pyopenssl": "@ai-ecoverse/py-pyopenssl",
}

# No pure wheel on PyPI, a pure-Python fallback in the sdist: the package
# directory build.sh copies out of the sdist (the C/Cython accelerator is
# optional and left out).
SDIST = {
    "pyyaml": "lib/yaml",
}


def canon(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def recipe():
    text = open(os.path.join(PKG, "recipe.yaml"), encoding="utf-8").read()
    version = re.search(r'^version:\s*"([^"]+)"', text, re.M).group(1)
    url = re.search(r'^source:\n(?:  #.*\n)*  url:\s*"([^"]+)"', text, re.M)
    if not url:
        sys.exit("lock.py: recipe.yaml has no source.url")
    return version, url.group(1).replace("{{version}}", version)


def homescoop():
    """{dist: (npm name, npm pin, PyPI version)} from package/package.json's pins."""
    deps = json.load(open(os.path.join(PKG, "package", "package.json"), encoding="utf-8")).get("dependencies", {})
    out = {}
    for dist, npm in sorted(HOMESCOOP.items()):
        pin = deps.get(npm)
        if not pin or not re.fullmatch(r"[0-9][0-9A-Za-z.]*-[0-9.]+", pin):
            sys.exit(f"lock.py: package/package.json has no exact pin of {npm} (for {dist})")
        # The published manifest names the PyPI release it was built from.
        meta = json.loads(get(f"https://registry.npmjs.org/{npm}/{pin}"))
        upstream = (meta.get("homescoop") or {}).get("upstream")
        if not upstream:
            sys.exit(f"lock.py: {npm}@{pin} has no homescoop.upstream")
        out[dist] = (npm, pin, upstream)
    return out


def get(url):
    with urllib.request.urlopen(url) as r:
        return r.read()


def pypi(name, version):
    return json.loads(get(f"https://pypi.org/pypi/{name}/{version}/json"))


def pick(name, version):
    """(kind, filename, url, sha256) of the file to stage for name==version."""
    files = pypi(name, version)["urls"]
    wheels = [f for f in files if f["packagetype"] == "bdist_wheel" and f["filename"].endswith("-none-any.whl")]
    py3 = [f for f in wheels if any(t in ("py3", "py2.py3") for t in [f["filename"].split("-")[-3]])]
    if len(py3) > 1:
        py3 = [f for f in py3 if f["filename"].split("-")[-3] == "py3"] or py3
    if canon(name) in SDIST:
        if py3:
            sys.exit(f"lock.py: {name} {version} has a pure wheel now ({py3[0]['filename']}); drop it from SDIST")
        sd = [f for f in files if f["packagetype"] == "sdist"]
        if len(sd) != 1:
            sys.exit(f"lock.py: {name} {version}: {len(sd)} sdists")
        return "sdist:" + SDIST[canon(name)], sd[0]["filename"], sd[0]["url"], sd[0]["digests"]["sha256"]
    if len(py3) != 1:
        have = ", ".join(f["filename"] for f in files) or "nothing"
        sys.exit(f"lock.py: {name} {version} has no single pure py3 wheel (PyPI has {have}); "
                 "add it to EXCLUDE or SDIST with a reason")
    f = py3[0]
    return "wheel", f["filename"], f["url"], f["digests"]["sha256"]


def pins_of(text):
    pins = {}
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        m = re.fullmatch(r"([A-Za-z0-9._-]+)\s*(==|~=)\s*([A-Za-z0-9.]+)", line)
        if not m:
            sys.exit(f"lock.py: can't read upstream pin {line!r}")
        pins[canon(m.group(1))] = (m.group(1), m.group(2), m.group(3))
    return pins


def main():
    version, req_url = recipe()
    req = get(req_url)
    req_sha = hashlib.sha256(req).hexdigest()
    pins = pins_of(req.decode("utf-8"))
    if pins.get("azure-cli", (None, None, None))[1:] != ("==", version):
        sys.exit(f"lock.py: {req_url} doesn't pin azure-cli=={version}")
    native = homescoop()
    for name in [*EXCLUDE, *HOMESCOOP]:
        if name not in pins and name != "pycparser":
            print(f"lock.py: note: {name} is no longer in upstream's pins", file=sys.stderr)
    # The newest file of any exact pin: the release's own wheels (azure-cli,
    # azure-cli-core, azure-cli-telemetry) are uploaded last.
    with cf.ThreadPoolExecutor(16) as ex:
        uploads = ex.map(lambda p: max(f["upload_time_iso_8601"] for f in pypi(p[0], p[2])["urls"]),
                         [p for p in pins.values() if p[1] == "=="])
        upload = max(uploads)

    with tempfile.TemporaryDirectory() as tmp:
        inp = os.path.join(tmp, "in.txt")
        over = os.path.join(tmp, "overrides.txt")
        out = os.path.join(tmp, "out.txt")
        keep = [f"{n}{op}{v}" for c, (n, op, v) in sorted(pins.items()) if c not in EXCLUDE and c not in HOMESCOOP]
        # homescoop's versions are requirements, not overrides, so every
        # range the closure declares for them must hold.
        ours = [f"{c}=={native[c][2]}" for c in sorted(native)]
        open(inp, "w").write("\n".join(keep + ours) + "\n")
        # An override with a marker that never holds removes the package from
        # every dependency list, so what only it needed goes too.
        open(over, "w").write("\n".join(keep + [f'{n} ; python_version < "0"' for n in sorted(EXCLUDE)]) + "\n")
        subprocess.run(["uv", "pip", "compile", inp, "--override", over, "--python-version", "3.15",
                        "--python-platform", "x86_64-unknown-linux-gnu", "--exclude-newer", upload,
                        "--no-header", "--no-annotate", "-o", out], check=True)
        resolved = {}
        for line in open(out):
            line = line.strip()
            if line and not line.startswith("#"):
                n, v = line.split("==")
                resolved[canon(n)] = (n, v)

    for c, (npm, pin, v) in native.items():
        if resolved.pop(c, (None, None))[1] != v:
            sys.exit(f"lock.py: the closure doesn't take {c}=={v} ({npm}@{pin})")
    for c, (n, op, v) in pins.items():
        if c in EXCLUDE or c in HOMESCOOP:
            continue
        if c not in resolved:
            sys.exit(f"lock.py: upstream pins {n}{op}{v}, the closure has no {n}")
        if op == "==" and resolved[c][1] != v:
            sys.exit(f"lock.py: upstream pins {n}=={v}, the closure has {resolved[c][1]}")
    for c in EXCLUDE:
        if c in resolved:
            sys.exit(f"lock.py: {c} is excluded but still resolved")

    rows = []
    with cf.ThreadPoolExecutor(16) as ex:
        picked = dict(zip(sorted(resolved), ex.map(lambda c: pick(*resolved[c]), sorted(resolved))))
    for c in sorted(resolved):
        n, v = resolved[c]
        kind, filename, url, sha = picked[c]
        pinned = "pin" if c in pins else "dep"
        rows.append(f"{c} {v} {pinned} {kind} {sha} {url}")
        print(f"  {c}=={v} {kind} {filename}", file=sys.stderr)

    head = [
        "# azure-cli's closure, written by src/lock.py; build.sh reads it. The \"homescoop\" lines come from npm (package.json), the rest from PyPI.",
        "# Do not edit by hand: after a version bump, run python3 packages/azure-cli/src/lock.py.",
        f"# azure-cli {version}",
        f"# requirements {req_sha} {req_url}",
        f"# exclude-newer {upload}",
    ]
    head += [f"# excluded {n} {pins[n][2] if n in pins else '-'}: {why}" for n, why in sorted(EXCLUDE.items())]
    # <dist> <PyPI version> <npm name>@<npm pin> <what upstream pins, or ->
    head += [f"# homescoop {c} {v} {npm}@{pin} upstream {pins[c][2] if c in pins else '-'}" for c, (npm, pin, v) in sorted(native.items())]
    head.append("# <name> <version> <pin: upstream pins it | dep: resolved> <wheel | sdist:<dir>> <sha256> <url>")
    with open(LOCK, "w", encoding="utf-8") as f:
        f.write("\n".join(head + rows) + "\n")
    print(f"lock.py: {len(rows)} packages, {len(native)} from homescoop, {len(EXCLUDE)} excluded -> {os.path.relpath(LOCK)}", file=sys.stderr)


if __name__ == "__main__":
    main()
