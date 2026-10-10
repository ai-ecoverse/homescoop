"""slicc (homescoop wasix-python): sys.executable, and py-* packages on sys.path.

fix(): WASI stat() has no permission bits, so CPython's PATH search for
argv[0] (getpath's isxfile) never matches the kernel's /usr/bin commands and
sys.executable stays '' (python -m venv then refuses to run). fix() fills
it in from PATH. It runs twice per start, idempotently: from
site-packages/slicc-executable.pth (base interpreter; a sitecustomize on
PYTHONPATH cannot shadow it) and from the stdlib sitecustomize.py (venvs
without system site-packages, which skip the base .pth files). A venv's own
bin/python gets its path from argv[0] on slicc-kernel >= 1.29.0.

discover() (3.14.2-15): npm packages that carry Python code (py-numpy, …)
declare `slicc.python.sitePackages` in package.json. discover() appends those
directories to sys.path (as PYTHONPATH would: .pth files there are not run), so no PYTHONPATH is needed. It runs from
the .pth only (the base interpreter, or a venv with system site-packages).
It looks at:
  A. this python's own project: the node_modules above sys.base_prefix
     (npm, or pnpm's node_modules/.pnpm/<entry>/node_modules/... layout);
  B. pnpm >= 11 global installs, where every `pnpm add -g` package is its own
     project under $PNPM_HOME/global/v<N>/: the sibling projects.
A package is accepted if its `slicc.python.requires` (abi, platform) match
this python's, or it has none (pure Python), and the wasix-python it
resolves to (Node-style lookup from its real directory), if any, has the
same exact version as this python: the same version is the same build, so
native side modules never mix interpreter builds. The first package of a
name wins; others are skipped (reported under -v).
The result is cached in <python>/.slicc-site-cache, keyed on the package
directories and their package.json stamps; -v always rescans.
"""
import os
import sys

_PY_PKG = "@ai-ecoverse/wasix-python"


def fix():
    if sys.executable:
        return
    argv0 = sys.orig_argv[0] if sys.orig_argv else ""
    name = os.path.basename(argv0) or "python3"
    for d in os.environ.get("PATH", "/usr/bin:/bin").split(os.pathsep):
        p = os.path.abspath(os.path.join(d or ".", name))
        if os.path.isfile(p):
            sys.executable = p
            if not getattr(sys, "_base_executable", ""):
                sys._base_executable = p
            return


def _say(msg):
    if sys.flags.verbose:
        print(f"slicc discover: {msg}", file=sys.stderr)


class _JsonContext:  # what _json.make_scanner reads from a JSONDecoder
    strict = True
    object_hook = None
    object_pairs_hook = None
    parse_float = float
    parse_int = int
    parse_constant = None
    memo = None


_scan = None


def _manifest(pkgdir):
    """package.json as a dict; the C scanner directly, so startup skips json/re."""
    global _scan
    try:
        with open(os.path.join(pkgdir, "package.json"), "rb") as f:
            text = f.read().decode("utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return None
    try:
        if _scan is None:
            import _json

            _scan = _json.make_scanner(_JsonContext())
        obj, _ = _scan(text, text.index("{"))
    except Exception:
        try:
            import json

            obj = json.loads(text)
        except ValueError:
            return None
    return obj if isinstance(obj, dict) else None


def _project_node_modules(path):
    """The node_modules of the project that `path` is installed in."""
    parts = path.split(os.sep)
    for i in range(len(parts) - 1, 0, -1):
        if parts[i] == ".pnpm" and parts[i - 1] == "node_modules":
            return os.sep.join(parts[:i])
    for i in range(len(parts) - 1, 0, -1):
        if parts[i] == "node_modules":
            return os.sep.join(parts[: i + 1])
    return None


def _global_siblings(nm):
    """pnpm >= 11: <PNPM_HOME>/global/v<N>/<project>/node_modules -> the other projects'."""
    project = os.path.dirname(nm)
    gdir = os.path.dirname(project)
    v = os.path.basename(gdir)
    if not (v[:1] == "v" and v[1:].isdigit() and os.path.basename(os.path.dirname(gdir)) == "global"):
        return []
    out = []
    try:
        entries = sorted(os.listdir(gdir))
    except OSError:
        return []
    for e in entries:
        d = os.path.join(gdir, e)
        if d == project or os.path.islink(d):  # hash-named aliases point at the real projects
            continue
        n = os.path.join(d, "node_modules")
        if os.path.isdir(n):
            out.append(n)
    return out


def _packages(nm):
    """Package directories in one project's node_modules (top level, then pnpm's store)."""
    def scoped(base):
        try:
            names = os.listdir(base)
        except OSError:
            return
        for n in names:
            if n.startswith("@"):
                try:
                    subs = os.listdir(os.path.join(base, n))
                except OSError:
                    continue
                for s in subs:
                    yield os.path.join(base, n, s)
            elif not n.startswith("."):
                yield os.path.join(base, n)

    yield from scoped(nm)
    store = os.path.join(nm, ".pnpm")
    try:
        entries = os.listdir(store)
    except OSError:
        return
    for e in entries:
        # <name with / as +>@<version>[_<peers>]; the package itself is
        # node_modules/<name> inside the entry.
        at = e.find("@", 1)
        if at <= 0:
            continue
        name = e[:at].replace("+", "/", 1) if e.startswith("@") else e[:at]
        yield os.path.join(store, e, "node_modules", name)


def _resolve(pkgdir, dep, memo):
    """Node's lookup of `dep` from the real directory `pkgdir` (memo: dir -> result)."""
    seen = []
    d = pkgdir
    while True:
        if d in memo:
            found = memo[d]
            break
        seen.append(d)
        if os.path.basename(d) != "node_modules":
            cand = os.path.join(d, "node_modules", dep)
            if os.path.isfile(os.path.join(cand, "package.json")):
                found = cand
                break
        parent = os.path.dirname(d)
        if parent == d:
            found = None
            break
        d = parent
    for s in seen:
        memo[s] = found
    return found


def _stamp(pkgdir):
    try:
        st = os.stat(os.path.join(pkgdir, "package.json"))
    except OSError:
        return None
    return f"{pkgdir}\t{st.st_mtime_ns}\t{st.st_size}"


def discover():
    if os.environ.get("SLICC_PYTHON_DISCOVER", "1") == "0":
        return
    base = os.path.abspath(sys.base_prefix)
    real = os.path.realpath(base)
    roots = []
    for p in (base, real):
        nm = _project_node_modules(p)
        if nm and nm not in roots:
            roots.append(nm)
    if not roots:
        return
    for nm in list(roots):
        for s in _global_siblings(nm):
            if s not in roots:
                roots.append(s)
    found = [p for nm in roots for p in _packages(nm)]
    # The cache is keyed on what a scan would look at: the package
    # directories and their package.json stamps (file mtimes are reliable on
    # slicc's OPFS; directory mtimes are not). A hit costs one stat per
    # package instead of realpath + read + parse + lookup.
    key = "\n".join(filter(None, [base, _stamp(real), *map(_stamp, found)]))
    cache = os.path.join(real, ".slicc-site-cache")
    if not sys.flags.verbose:
        try:
            with open(cache, encoding="utf-8") as f:
                head, _, dirs = f.read().partition("\n\n")
            if head == key:
                for d in dirs.split("\n"):
                    if d and d not in sys.path:
                        sys.path.append(d)
                return
        except OSError:
            pass
    dirs = _scan(real, found)
    for d in dirs:
        if d not in sys.path:  # as PYTHONPATH would: .pth files there are not run
            sys.path.append(d)
    try:
        tmp = f"{cache}.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(key + "\n\n" + "\n".join(dirs))
        os.replace(tmp, cache)
    except OSError:  # read-only install: no cache, scan every start
        pass


def _scan(real, found):
    me = _manifest(real)
    if not me or me.get("name") != _PY_PKG:
        return []
    version = me.get("version")
    want = (me.get("slicc") or {}).get("python") or {}
    seen_dirs = {real}
    memo = {}
    by_name = {}
    dirs = []
    for pkgdir in found:
        rdir = os.path.realpath(pkgdir)
        if rdir in seen_dirs:
            continue
        seen_dirs.add(rdir)
        m = _manifest(rdir)
        py = ((m or {}).get("slicc") or {}).get("python")
        if not isinstance(py, dict) or not py.get("sitePackages"):
            continue
        name = m.get("name") or rdir
        req = py.get("requires") or {}
        if any(req.get(k) not in (None, want.get(k)) for k in ("abi", "platform")):
            _say(f"skip {name} {m.get('version')}: requires {req}, this python is {want.get('abi')}/{want.get('platform')}")
            continue
        deps = {**(m.get("peerDependencies") or {}), **(m.get("dependencies") or {})}
        if _PY_PKG in deps:
            dep = _resolve(rdir, _PY_PKG, memo)
            got = (_manifest(dep) or {}).get("version") if dep else deps[_PY_PKG]
            if got != version:
                _say(f"skip {name} {m.get('version')}: built for wasix-python {got}, this is {version}")
                continue
        if name in by_name:
            if by_name[name] != m.get("version"):
                _say(f"skip {name} {m.get('version')} in {rdir}: {by_name[name]} is already on sys.path")
            continue
        by_name[name] = m.get("version")
        dirs.append(os.path.join(rdir, py["sitePackages"]))
    return dirs
