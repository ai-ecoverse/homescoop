import os
import re
import sys
from pathlib import Path

conf, gemdir, rel = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
orig_dir = gemdir / rel
orig_file = orig_dir / "extconf.rb"
new_dir = conf.parent


def moved(target):
    return os.path.relpath(os.path.normpath(target), new_dir)


t = conf.read_text()
t = re.sub(r"(require_relative\s+['\"])(\.\./[^'\"]+)(['\"])",
           lambda m: m.group(1) + moved(orig_dir / m.group(2)) + m.group(3), t)
t = re.sub(r"\$\(srcdir\)/((?:\.\./)+[^\"' ]*)",
           lambda m: "$(srcdir)/" + moved(orig_dir / m.group(1)), t)
t = re.sub(r"File\.expand_path\((['\"])(\.\./[^'\"]*)\1,\s*__FILE__\)",
           lambda m: f"File.expand_path({m.group(1)}{moved(orig_file / m.group(2))}{m.group(1)}, __dir__)", t)
conf.write_text(t)
print(f"ext/{new_dir.name}: from {gemdir.name}/{rel}")
