#!/usr/bin/env -S python3 -S
"""aws and aws_completer for slicc: the AWS CLI v2 on wasix-python (homescoop#2115).

AWS's launchers are bin/aws and bin/aws_completer of its source tree, which
import awscli from the interpreter's path. This script runs them on
wasix-python, the interpreter it runs on, from lib/aws-cli/bin. It is
installed twice, as bin/aws and bin/aws_completer, and picks the tool by its
own file name.

  - The AWS CLI and its pure-Python dependencies are in lib/aws-cli, which
    goes first on sys.path. The shebang runs python3 -S, so wasix-python's
    site-packages (and any .pth file there) are never read; run another way
    (python3 bin/aws), site-packages are dropped from sys.path here. A py-*
    package installed beside this one can't shadow the CLI's own copies.
  - The py-* packages this one depends on (package.json: py-cryptography and
    py-cffi, for awscrt/crypto.py and SigV4a) go on sys.path after
    lib/aws-cli and the standard library, and only they: each is found as
    Node finds a dependency, from this package's directory, and taken only
    at exactly the version package.json pins, built for this python (its
    slicc.python.requires, and the wasix-python it resolves to is this
    one's version). Another py-* package, or another copy or version of
    these, is not read. One that is missing or doesn't match is left out,
    and the commands that need cryptography say so.
  - The kernel's proxy terminates TLS with its own CA, which it names in
    SSL_CERT_FILE. botocore trusts only its own bundle (botocore/cacert.pem)
    unless told otherwise, so AWS_CA_BUNDLE defaults to SSL_CERT_FILE when
    that file exists. A value of your own wins.
  - No pager by default: upstream pipes output on a terminal to `less`,
    which slicc doesn't have unless you install it. AWS_PAGER, cli_pager in
    ~/.aws/config and PAGER still choose one, as upstream.
"""
import json
import os
import runpy
import sys

PACKAGE = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
LIB = os.path.join(PACKAGE, "lib", "aws-cli")
TOOLS = ("aws", "aws_completer")
PYTHON = "@ai-ecoverse/wasix-python"


def manifest(pkgdir):
    try:
        with open(os.path.join(pkgdir, "package.json"), encoding="utf-8") as f:
            m = json.load(f)
    except (OSError, ValueError):
        return None
    return m if isinstance(m, dict) else None


def resolve(start, name):
    """Node's lookup of the package `name` from the directory `start`."""
    d = start
    while True:
        if os.path.basename(d) != "node_modules":
            cand = os.path.join(d, "node_modules", name)
            if os.path.isfile(os.path.join(cand, "package.json")):
                return os.path.realpath(cand)
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def py_dependencies():
    """The site-packages of this package's py-* dependencies, as pinned."""
    me = manifest(PACKAGE) or {}
    python = manifest(os.path.realpath(sys.base_prefix)) or {}
    if python.get("name") != PYTHON:
        return []
    want = (python.get("slicc") or {}).get("python") or {}
    dirs = []
    for name, pin in sorted((me.get("dependencies") or {}).items()):
        if not name.startswith("@ai-ecoverse/py-"):
            continue
        pkgdir = resolve(PACKAGE, name)
        m = manifest(pkgdir) if pkgdir else None
        py = ((m or {}).get("slicc") or {}).get("python") or {}
        req = py.get("requires") or {}
        if not m or m.get("name") != name or m.get("version") != pin or not py.get("sitePackages"):
            continue
        if any(req.get(k) not in (None, want.get(k)) for k in ("abi", "platform")):
            continue
        dep_python = resolve(pkgdir, PYTHON)
        if (manifest(dep_python) or {}).get("version") != python.get("version"):
            continue
        dirs.append(os.path.join(pkgdir, py["sitePackages"]))
    return dirs


def setup(tool):
    """sys.path and the environment for `tool`, before its code is imported."""
    if not sys.flags.no_site:
        sys.path[:] = [p for p in sys.path if "site-packages" not in p]
    sys.path.insert(0, LIB)
    sys.path.extend(d for d in py_dependencies() if d not in sys.path)
    ca = os.environ.get("SSL_CERT_FILE")
    if ca and os.path.isfile(ca):
        os.environ.setdefault("AWS_CA_BUNDLE", ca)
    if tool == "aws":
        import awscli.clidriver

        # The end of the pager chain (AWS_PAGER, cli_pager, PAGER, then
        # this): no pager, rather than `less`.
        awscli.clidriver.default_pager = ""


def main():
    tool = os.path.basename(__file__)
    if tool not in TOOLS:
        sys.exit(f"{tool}: this launcher runs only as {' or '.join(TOOLS)}")
    setup(tool)
    script = os.path.join(LIB, "bin", tool)
    sys.argv[0] = script
    runpy.run_path(script, run_name="__main__")


if __name__ == "__main__":
    main()
