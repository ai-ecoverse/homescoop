#!/usr/bin/env python3
"""uv for slicc: uv's everyday commands over python -m venv and pip (homescoop#103).

Astral's uv does not build for WASI yet (see homescoop#103); this covers
venv, pip, run, add, remove, sync and init with the pip that ships in
@ai-ecoverse/wasix-python. Anything else exits 2 and says so.

A venv's python is the base interpreter told where it lives: PYTHONEXECUTABLE
set to <venv>/bin/python makes site.venv() pick the venv's pyvenv.cfg up, so
venvs work whether or not the kernel passes the invoked path as argv[0].
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib

PROG = "uv"
SHIM = "@ai-ecoverse/wasix-uv-shim"
NOTE = f"uv here is a shim over pip ({SHIM}), not Astral's uv"
SUPPORTED = "venv, pip, run, add, remove, sync, init"
PIP_SUPPORTED = ("install", "uninstall", "list", "freeze", "show", "check")
BASE_PYTHON = "/usr/bin/python3"


class UvError(Exception):
    def __init__(self, message, code=2):
        super().__init__(message)
        self.code = code


def shim_version():
    here = os.path.dirname(os.path.abspath(sys.argv[0] if sys.argv and sys.argv[0] else __file__))
    try:
        with open(os.path.join(here, "..", "package.json"), encoding="utf-8") as f:
            return json.load(f)["version"]
    except (OSError, ValueError, KeyError):
        return "0.0.0"


def info(msg):
    print(msg, file=sys.stderr, flush=True)


def norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def req_name(spec):
    m = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", spec)
    if not m:
        raise UvError(f"error: not a requirement: `{spec}`")
    return m.group(1)


def status_of(rc):
    return 128 - rc if rc < 0 else rc


# ---------------------------------------------------------------- locations

def project_root(start=None):
    d = os.path.abspath(start or os.getcwd())
    while True:
        if os.path.isfile(os.path.join(d, "pyproject.toml")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def is_venv(path):
    return bool(path) and os.path.isfile(os.path.join(path, "pyvenv.cfg"))


def project_venv(root):
    env = os.environ.get("UV_PROJECT_ENVIRONMENT")
    if env:
        return os.path.join(root, env) if not os.path.isabs(env) else env
    return os.path.join(root, ".venv")


def find_venv():
    """The venv uv pip / uv run use: $VIRTUAL_ENV, else .venv here or above."""
    active = os.environ.get("VIRTUAL_ENV")
    if is_venv(active):
        return os.path.abspath(active)
    d = os.getcwd()
    while True:
        cand = os.path.join(d, ".venv")
        if is_venv(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def base_env():
    env = dict(os.environ)
    for k in ("VIRTUAL_ENV", "PYTHONEXECUTABLE", "PYTHONPATH"):
        env.pop(k, None)
    env["PYTHONEXECUTABLE"] = BASE_PYTHON
    return env


def venv_env(venv, pip=False):
    env = dict(os.environ)
    env["VIRTUAL_ENV"] = venv
    env["PYTHONEXECUTABLE"] = os.path.join(venv, "bin", "python")
    env["PATH"] = os.path.join(venv, "bin") + os.pathsep + env.get("PATH", "")
    if pip:
        # The base interpreter's pip, run inside the venv (uv's venvs have no pip).
        import pip as _pip
        env["PYTHONPATH"] = os.path.dirname(os.path.dirname(_pip.__file__))
        env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    else:
        env.pop("PYTHONPATH", None)
    return env


def run(argv, env, to_stderr=False):
    try:
        r = subprocess.run(argv, env=env, stdout=sys.stderr if to_stderr else None)
    except FileNotFoundError:
        raise UvError(f"error: failed to spawn: `{argv[0]}`: No such file or directory", 2)
    return status_of(r.returncode)


def pip(venv, args, to_stderr=False):
    return run(["python3", "-m", "pip", *args], venv_env(venv, pip=True), to_stderr)


# ---------------------------------------------------------------- venv

def create_venv(path, seed=False, quiet=False):
    path = os.path.abspath(path)
    if os.path.exists(path):
        if not is_venv(path) and os.listdir(path):
            raise UvError(f"error: `{path}` exists and is not a virtual environment", 2)
        shutil.rmtree(path)
    if not quiet:
        info(f"Using CPython {sys.version.split()[0]} interpreter at: {BASE_PYTHON}")
        info(f"Creating virtual environment {'with seed packages ' if seed else ''}at: {os.path.relpath(path)}")
    rc = run(["python3", "-m", "venv", "--without-pip", path], base_env())
    if rc:
        raise UvError("error: failed to create the virtual environment", rc)
    if seed:
        rc = run(["python3", "-m", "ensurepip", "--default-pip"], venv_env(path), to_stderr=True)
        if rc:
            raise UvError("error: failed to seed pip", rc)
    return path


def cmd_venv(args):
    seed = quiet = False
    path = None
    it = iter(args)
    for a in it:
        if a == "--seed":
            seed = True
        elif a in ("-q", "--quiet"):
            quiet = True
        elif a in ("--clear", "--allow-existing", "--no-project"):
            pass
        elif a in ("-p", "--python"):
            want = next(it, "")
            check_python(want)
        elif a.startswith("--python="):
            check_python(a.split("=", 1)[1])
        elif a.startswith("-"):
            raise UvError(f"error: unexpected argument '{a}' for `uv venv` ({NOTE})")
        elif path is None:
            path = a
        else:
            raise UvError(f"error: unexpected argument '{a}' for `uv venv`")
    if path is None:
        root = project_root()
        path = project_venv(root) if root else ".venv"
    path = create_venv(path, seed, quiet)
    if not quiet:
        info(f"Activate with: source {os.path.relpath(path)}/bin/activate")
    return 0


def check_python(want):
    ok = {"", "python", "python3", "python3.14", "3", "3.14", "3.14.2", "cpython", "cpython3.14", BASE_PYTHON, "/usr/bin/python"}
    if want not in ok and not want.startswith(("3.14", ">=3")):
        raise UvError(f"error: No interpreter found for `{want}`: this uv shim only uses @ai-ecoverse/wasix-python {sys.version.split()[0]}", 2)


# ---------------------------------------------------------------- uv pip

def cmd_pip(args):
    if not args or args[0] in ("-h", "--help"):
        info(f"usage: uv pip {{{'|'.join(PIP_SUPPORTED)}}} … ({NOTE})")
        return 0 if args else 2
    sub, rest = args[0], args[1:]
    if sub not in PIP_SUPPORTED:
        raise UvError(f"error: `uv pip {sub}` is not supported by this uv shim ({NOTE}); it covers uv pip {', '.join(PIP_SUPPORTED)}")
    system = "--system" in rest
    rest = [a for a in rest if a not in ("--system", "--strict")]
    if system:
        env = base_env()
        return run(["python3", "-m", "pip", sub, *rest], env)
    venv = find_venv()
    if venv is None:
        raise UvError("error: No virtual environment found; run `uv venv` to create an environment, or pass `--system` to install into a non-virtual environment", 2)
    if sub == "uninstall" and "-y" not in rest and "--yes" not in rest:
        rest = ["-y", *rest]
    return pip(venv, [sub, *rest])


# ---------------------------------------------------------------- pyproject

def load_project(root):
    with open(os.path.join(root, "pyproject.toml"), "rb") as f:
        return tomllib.load(f)


def project_deps(data, dev=True):
    deps = list(data.get("project", {}).get("dependencies", []))
    if dev:
        deps += [d for d in data.get("dependency-groups", {}).get("dev", []) if isinstance(d, str)]
    return deps


def toml_str(s):
    return json.dumps(s)


def find_table(text, header):
    """(start, end) of a [header] table's body in text, or None."""
    m = re.search(r"^\[" + re.escape(header) + r"\][ \t]*(#.*)?$", text, re.M)
    if not m:
        return None
    nxt = re.search(r"^\[", text[m.end():], re.M)
    return m.end(), (m.end() + nxt.start() if nxt else len(text))


def array_span(text, start, end, key):
    """(start, end) of `key = [ … ]` inside text[start:end], or None."""
    m = re.compile(r"^[ \t]*" + re.escape(key) + r"[ \t]*=[ \t]*\[", re.M).search(text, start, end)
    if not m:
        return None
    i, depth, quote = m.end(), 1, None
    while i < len(text):
        c = text[i]
        if quote:
            if c == "\\" and quote == '"':
                i += 1
            elif c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif c == "#":
            i = text.find("\n", i)
            if i < 0:
                break
        elif c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return m.start(), i + 1
        i += 1
    raise UvError("error: could not parse pyproject.toml", 2)


def set_array(text, table, key, items):
    body = "".join(f"    {toml_str(x)},\n" for x in items)
    block = f"{key} = [\n{body}]" if items else f"{key} = []"
    span = find_table(text, table)
    if span is None:
        sep = "" if text.endswith("\n") or not text else "\n"
        return f"{text}{sep}\n[{table}]\n{block}\n"
    arr = array_span(text, span[0], span[1], key)
    if arr:
        return text[: arr[0]] + block + text[arr[1]:]
    return text[: span[0]] + "\n" + block + text[span[0]:]


def edit_deps(root, dev, change):
    path = os.path.join(root, "pyproject.toml")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    data = tomllib.loads(text)
    if dev:
        table, current = "dependency-groups", list(data.get("dependency-groups", {}).get("dev", []))
        key = "dev"
    else:
        if "project" not in data:
            raise UvError("error: No `project` table found in: `pyproject.toml`", 2)
        table, current, key = "project", list(data["project"].get("dependencies", [])), "dependencies"
    new = change(current)
    text = set_array(text, table, key, new)
    tomllib.loads(text)  # still valid TOML
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def require_project():
    root = project_root()
    if root is None:
        raise UvError(f"error: No `pyproject.toml` found in current directory or any parent directory", 2)
    return root


def sync(root, quiet=False):
    venv = project_venv(root)
    if not is_venv(venv):
        create_venv(venv, quiet=quiet)
    data = load_project(root)
    deps = project_deps(data)
    has_build = "build-system" in data
    targets = (["-e", root] if has_build else []) + deps
    if not targets:
        return 0
    rc = pip(venv, ["install", *(["-q"] if quiet else []), *targets], to_stderr=True)
    if rc:
        raise UvError("error: failed to sync the environment", rc)
    return 0


def installed_version(venv, name):
    r = subprocess.run(
        ["python3", "-c", "import importlib.metadata,sys; print(importlib.metadata.version(sys.argv[1]))", name],
        env=venv_env(venv), capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def cmd_add(args):
    dev = False
    specs = []
    for a in args:
        if a in ("--dev", "--group=dev"):
            dev = True
        elif a.startswith("-"):
            raise UvError(f"error: unexpected argument '{a}' for `uv add` ({NOTE})")
        else:
            specs.append(a)
    if not specs:
        raise UvError("error: `uv add` needs at least one package")
    root = require_project()
    names = {norm(req_name(s)) for s in specs}
    edit_deps(root, dev, lambda cur: [d for d in cur if norm(req_name(d)) not in names] + specs)
    sync(root)
    # Like uv: a bare name gets the installed version as its lower bound.
    venv = project_venv(root)
    bounds = {}
    for s in specs:
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", s.strip()):
            v = installed_version(venv, s.strip())
            if v:
                bounds[norm(s)] = f"{s.strip()}>={v}"
    if bounds:
        edit_deps(root, dev, lambda cur: [bounds.get(norm(d), d) if d.strip() == req_name(d) else d for d in cur])
    return 0


def cmd_remove(args):
    dev = "--dev" in args
    names = [a for a in args if not a.startswith("-")]
    if not names:
        raise UvError("error: `uv remove` needs at least one package")
    root = require_project()
    data = load_project(root)
    current = project_deps(data, dev=False) if not dev else data.get("dependency-groups", {}).get("dev", [])
    gone = {norm(n) for n in names}
    missing = [n for n in names if norm(n) not in {norm(req_name(d)) for d in current}]
    if missing:
        raise UvError(f"error: The dependency `{missing[0]}` could not be found in `{'dependency-groups.dev' if dev else 'project.dependencies'}`", 2)
    edit_deps(root, dev, lambda cur: [d for d in cur if norm(req_name(d)) not in gone])
    venv = project_venv(root)
    if is_venv(venv):
        pip(venv, ["uninstall", "-y", "-q", *names], to_stderr=True)
    return 0


def cmd_sync(args):
    quiet = any(a in ("-q", "--quiet") for a in args)
    for a in args:
        if a not in ("-q", "--quiet", "--all-groups", "--dev", "--no-dev", "--inexact", "--frozen", "--locked"):
            raise UvError(f"error: unexpected argument '{a}' for `uv sync` ({NOTE})")
    sync(require_project(), quiet)
    return 0


def cmd_init(args):
    name = None
    for a in args:
        if a in ("--app", "--no-readme", "--bare", "--vcs=none"):
            continue
        if a.startswith("-"):
            raise UvError(f"error: unexpected argument '{a}' for `uv init` ({NOTE})")
        name = a
    target = os.path.abspath(name) if name else os.getcwd()
    os.makedirs(target, exist_ok=True)
    py = os.path.join(target, "pyproject.toml")
    if os.path.exists(py):
        raise UvError(f"error: Project is already initialized in `{target}` (`pyproject.toml` file exists)", 2)
    proj = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.basename(target)) or "project"
    with open(py, "w", encoding="utf-8") as f:
        f.write(
            f'[project]\nname = {toml_str(proj)}\nversion = "0.1.0"\n'
            f'description = "Add your description here"\nrequires-python = ">=3.14"\ndependencies = []\n')
    main = os.path.join(target, "main.py")
    if not os.path.exists(main):
        with open(main, "w", encoding="utf-8") as f:
            f.write(f'def main():\n    print("Hello from {proj}!")\n\n\nif __name__ == "__main__":\n    main()\n')
    info(f"Initialized project `{proj}`" + (f" at `{target}`" if name else ""))
    return 0


# ---------------------------------------------------------------- uv run

def cmd_run(args):
    no_sync = False
    i = 0
    while i < len(args) and args[i].startswith("-"):
        a = args[i]
        if a in ("--no-sync", "--frozen", "--locked"):
            no_sync = True
        elif a in ("-q", "--quiet", "--no-project", "--active"):
            pass
        elif a in ("-p", "--python"):
            i += 1
            check_python(args[i] if i < len(args) else "")
        elif a == "--":
            i += 1
            break
        else:
            raise UvError(f"error: unexpected argument '{a}' for `uv run` ({NOTE})")
        i += 1
    cmd = args[i:]
    if not cmd:
        raise UvError("error: `uv run` needs a command")
    root = project_root()
    if root and not no_sync:
        sync(root, quiet=True)
    venv = project_venv(root) if root and is_venv(project_venv(root)) else find_venv()
    env = venv_env(venv) if venv else base_env()
    prog, rest = cmd[0], cmd[1:]
    if prog in ("python", "python3", "python3.14") or (prog.endswith(".py") and os.path.isfile(prog)):
        argv = ["python3", *([] if prog.startswith("python") else [prog]), *rest]
    elif venv and os.path.isfile(os.path.join(venv, "bin", prog)):
        argv = [os.path.join(venv, "bin", prog), *rest]
    else:
        argv = [prog, *rest]
    return run(argv, env)


# ---------------------------------------------------------------- main

def usage():
    print(f"""An extremely small uv: {NOTE}.

Usage: uv <COMMAND>

Commands:
  venv [PATH] [--seed]     Create a virtual environment (python -m venv)
  pip install|uninstall|list|freeze|show|check
                           pip in the active or nearest .venv
  run [--no-sync] CMD…     Run a command or script in the project's environment
  add [--dev] PKG…         Add dependencies to pyproject.toml and sync
  remove [--dev] PKG…      Remove dependencies from pyproject.toml
  sync                     Install the project's dependencies into .venv
  init [PATH]              Create a pyproject.toml
  --version                Show the shim's version

No lock files, tools, Python installs or builds; those exit 2.""")


COMMANDS = {
    "venv": cmd_venv, "pip": cmd_pip, "run": cmd_run, "add": cmd_add,
    "remove": cmd_remove, "sync": cmd_sync, "init": cmd_init,
}


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        usage()
        return 0 if argv else 2
    cmd, rest = argv[0], argv[1:]
    if cmd in ("-V", "--version", "version") or (cmd == "self" and rest[:1] == ["version"]):
        print(f"uv {shim_version()} ({SHIM})")
        info(NOTE)
        return 0
    fn = COMMANDS.get(cmd)
    if fn is None:
        raise UvError(f"error: `uv {cmd}` is not supported: {NOTE}; it covers {SUPPORTED}")
    return fn(rest)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except UvError as e:
        info(str(e))
        sys.exit(e.code)
    except KeyboardInterrupt:
        sys.exit(130)
