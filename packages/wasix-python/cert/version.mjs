/**
 * wasix-python 3.15.0-1 (homescoop#761): the interpreter is the CPython of
 * recipe.yaml's version, with the matching ABI tags, and what 3.15 changes.
 *
 * - sys.version_info, platform.python_version() and package.json's version
 *   upstream agree; slicc.python (version, abi, soabi, stdlib, sitePackages)
 *   is what the interpreter reports: sysconfig SOABI / EXT_SUFFIX,
 *   importlib's first EXTENSION_SUFFIXES entry, sys.implementation.cache_tag,
 *   purelib and stdlib under lib/pythonX.Y.
 * - A start prints nothing on stderr: 3.15's getpath warns "Could not find
 *   the platform standard library directory!" when PYTHONHOME is set and
 *   lib/pythonX.Y/lib-dynload is missing, which npm would drop as empty.
 * - PEP 686 (3.15): UTF-8 mode is the default, so open() without an encoding
 *   and the filesystem encoding are UTF-8; -X utf8=0 turns it off.
 * - The discovery ABI gate: a py-* stand-in requiring another abi (cp314,
 *   what every py-* published for 3.14 declares) stays off sys.path and
 *   python -v names it; the same stand-in requiring this python's abi is
 *   found. Both stand-ins are pure Python, so the gate is the metadata only.
 */
import { readFileSync } from 'node:fs';

const PKG = JSON.parse(readFileSync(new URL('../package/package.json', import.meta.url), 'utf8'));
const PY = PKG.slicc.python;
const NM = '/node_modules/@ai-ecoverse';

const SCRIPT = String.raw`
import importlib.machinery as m, io, json, locale, platform, sys, sysconfig
print(json.dumps({
    "version": platform.python_version(),
    "major_minor": f"{sys.version_info[0]}.{sys.version_info[1]}",
    "soabi": sysconfig.get_config_var("SOABI"),
    "ext_suffix": sysconfig.get_config_var("EXT_SUFFIX"),
    "suffixes": m.EXTENSION_SUFFIXES,
    "cache_tag": sys.implementation.cache_tag,
    "purelib": sysconfig.get_path("purelib"),
    "stdlib": sysconfig.get_path("stdlib"),
    "base_prefix": sys.base_prefix,
    "utf8_mode": sys.flags.utf8_mode,
    "text_encoding": io.text_encoding(None),
    "fs_encoding": sys.getfilesystemencoding(),
    "locale_encoding": locale.getencoding(),
}))
`;

const standIn = (name, abi) => ({
  name: `@ai-ecoverse/${name}`,
  version: '1.0.0-1',
  slicc: { python: { sitePackages: `lib/python${PY.version}/site-packages`, requires: { abi, platform: PY.platform } } },
});

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const py = (args, env = {}) => run(['python3', ...args], { cwd: '/home', env });
  await write('/tmp/version_rows.py', SCRIPT);
  const r = await py(['/tmp/version_rows.py']);
  assert.equal(r.status, 0, `rc=${r.status} ${r.stderr}`);
  assert.equal(r.stderr, '', `a plain start prints nothing on stderr (3.15's getpath warns when lib/pythonX.Y/lib-dynload is missing): ${r.stderr}`);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  const s = JSON.stringify(o);
  const tag = PY.abi.slice(2);
  assert.equal(o.version, PKG.homescoop.upstream, `python_version vs package.json homescoop.upstream: ${s}`);
  assert.equal(o.major_minor, PY.version, s);
  assert.equal(o.soabi, PY.soabi, s);
  assert.equal(o.soabi, `cpython-${tag}-wasm32-wasix`, s);
  assert.equal(o.ext_suffix, `.${PY.soabi}.so`, s);
  assert.equal(o.suffixes[0], `.${PY.soabi}.so`, `importlib looks for this SOABI first: ${s}`);
  assert.ok(!o.suffixes.some((x) => new RegExp(`cpython-(?!${tag}-)\\d+-`).test(x)), `no other cpython tag among EXTENSION_SUFFIXES: ${s}`);
  assert.equal(o.cache_tag, `cpython-${tag}`, s);
  assert.ok(o.purelib.endsWith(`/${PY.sitePackages}`), s);
  assert.ok(o.stdlib.endsWith(`/${PY.stdlib}`), s);
  assert.equal(o.utf8_mode, 1, `PEP 686: UTF-8 mode by default: ${s}`);
  assert.equal(o.text_encoding, 'utf-8', s);
  assert.equal(o.fs_encoding, 'utf-8', s);
  const off = await py(['-X', 'utf8=0', '-c', 'import sys; print(sys.flags.utf8_mode)']);
  assert.equal(off.stdout.trim(), '0', `-X utf8=0 disables UTF-8 mode: ${off.stdout}${off.stderr}`);

  const other = 'py-abiprobe-other';
  const same = 'py-abiprobe-same';
  const otherAbi = tag === '314' ? 'cp313' : 'cp314';
  try {
    for (const [n, abi] of [[other, otherAbi], [same, PY.abi]]) {
      await write(`${NM}/${n}/package.json`, JSON.stringify(standIn(n, abi)));
      await write(`${NM}/${n}/lib/python${PY.version}/site-packages/${n.replaceAll('-', '_')}.py`, `ABI = ${JSON.stringify(abi)}\n`);
    }
    const v = await py(['-v', '-c', 'import importlib.util as u; print(u.find_spec("py_abiprobe_other") is None, u.find_spec("py_abiprobe_same") is not None)']);
    assert.equal(v.status, 0, v.stderr.slice(-2000));
    assert.equal(v.stdout.trim(), 'True True', `the ${otherAbi} stand-in stays off sys.path, the ${PY.abi} one is found: ${v.stdout}`);
    const notes = v.stderr.split('\n').filter((l) => l.startsWith('slicc discover:') && l.includes(other));
    assert.ok(notes.length === 1 && notes[0].includes(`'abi': '${otherAbi}'`) && notes[0].includes(`this python is ${PY.abi}/${PY.platform}`), `-v note: ${notes}`);
    const imp = await py(['-c', 'import py_abiprobe_other']);
    assert.equal(imp.status, 1, `import of the refused stand-in: rc=${imp.status} ${imp.stderr}`);
    assert.match(imp.stderr, /ModuleNotFoundError: No module named 'py_abiprobe_other'/);
    console.log(`version: CPython ${o.version}, SOABI ${o.soabi}, cache tag ${o.cache_tag}, ${PY.sitePackages}; UTF-8 mode ${o.utf8_mode} (locale ${o.locale_encoding}; -X utf8=0 gives 0); a ${otherAbi} py-* stand-in is refused (${notes[0]}), a ${PY.abi} one is found`);
  } finally {
    await run(['bash', '-c', `rm -rf ${NM}/${other} ${NM}/${same}`], { cwd: '/' });
  }
}
