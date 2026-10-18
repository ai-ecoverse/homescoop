"""Sanitise the installed build configuration records (wasix-python -13).

sysconfig's _sysconfigdata*.py and _sysconfig_vars*.json describe how this
python.wasm was built, and extension builds read them. Drop what only made
sense on the build machine:

- the `-include <build>/stubs/fcntl_wasix_extra.h` CPython's own objects
  were compiled with;
- the private stub archive and the --wrap/--export flags it needs, from
  LIBS/SHLIBS (they would make an extension import __wrap_* symbols);
- CXX and LDCXXSHARED: configure recorded the host's clang++; wasixcc's C++
  driver is wasix++;
- LLVM_PROF_MERGER (the runner's emsdk) and userbase (the runner's ~/.local).

    python3 sanitize-sysconfig.py <lib/python3.14> <build root>
"""
import glob
import json
import os
import pprint
import re
import sys

pylib, build = sys.argv[1], sys.argv[2].rstrip('/')
stubs = re.escape(build + '/stubs/')
DROP = [
    re.compile(r'\s*-include\s+' + stubs + r'\S+'),
    re.compile(r'\s*' + stubs + r'libpython-wasix-stubs\.a'),
    re.compile(r'\s*-Wl,--(?:wrap|export)=__wrap_\w+|\s*-Wl,--wrap=\w+'),
]


def clean(key, value):
    if not isinstance(value, str):
        return value
    if value.startswith('clang++'):  # CXX, LDCXXSHARED
        value = 'wasix++' + value[len('clang++'):]
    if key == 'LLVM_PROF_MERGER':
        return ''
    for rx in DROP:
        value = rx.sub('', value)
    return value


def fix(d):
    out = {k: clean(k, v) for k, v in d.items()}
    out.pop('userbase', None)
    return out


n = 0
for path in glob.glob(os.path.join(pylib, '_sysconfig_vars_*.json')):
    with open(path) as f:
        data = json.load(f)
    with open(path, 'w') as f:
        json.dump(fix(data), f, indent=2, sort_keys=True)
        f.write('\n')
    n += 1
for path in glob.glob(os.path.join(pylib, '_sysconfigdata_*.py')):
    ns = {}
    with open(path) as f:
        exec(f.read(), ns)
    with open(path, 'w') as f:
        f.write('# system configuration generated and used by the sysconfig module\n')
        f.write('build_time_vars = ')
        pprint.pprint(fix(ns['build_time_vars']), stream=f, width=100)
    n += 1
if n != 2:
    sys.exit(f'sanitize-sysconfig: expected 2 records in {pylib}, found {n}')

# Nothing of the above may remain.
left = []
for path in glob.glob(os.path.join(pylib, '_sysconfig*')):
    text = open(path).read()
    for bad in ('/home/runner', build + '/stubs', 'clang++', 'llvm-profdata'):
        if bad in text:
            left.append(f'{os.path.basename(path)}: {bad}')
if left:
    sys.exit('sanitize-sysconfig: still present: ' + ', '.join(left))
print(f'sanitize-sysconfig: {n} records clean')
