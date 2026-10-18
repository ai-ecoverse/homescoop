import { readFileSync } from 'node:fs';

const PYV = JSON.parse(readFileSync(new URL('../package/package.json', import.meta.url), 'utf8')).slicc.python.version;
const WHEEL = String.raw`
import base64, hashlib, sys, zipfile
name, ver = "hs_user", "1.0"
di = f"{name}-{ver}.dist-info"
files = {
    f"{name}/__init__.py": "VALUE = 17\n",
    f"{di}/METADATA": f"Metadata-Version: 2.1\nName: {name}\nVersion: {ver}\n",
    f"{di}/WHEEL": "Wheel-Version: 1.0\nGenerator: homescoop-cert\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
}
record = []
with zipfile.ZipFile(f"{sys.argv[1]}/{name}-{ver}-py3-none-any.whl", "w") as z:
    for path, text in files.items():
        data = text.encode()
        z.writestr(path, data)
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        record.append(f"{path},sha256={digest},{len(data)}")
    record.append(f"{di}/RECORD,,")
    z.writestr(f"{di}/RECORD", "\n".join(record) + "\n")
`;

export default async function (ctx) {
  const { run, write, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const as = async (user, argv, cwd = user === 'cone' ? '/home/cone' : '/root') => {
    const r = await run(argv, { cwd, ...(user === 'cone' && { user }) });
    assert.equal(r.status, 0, `${user}: ${argv.join(' ')}: rc=${r.status} ${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  };
  const py = (user, code) => as(user, ['python3', '-c', code]);

  const times = await py('root', [
    'import os, pathlib, time',
    'p = "/tmp/r17"; open(p, "w").close()',
    'os.utime(p, (1000000000, 1100000000)); e = int(os.stat(p).st_mtime)',
    'os.utime(p); u = int(os.stat(p).st_mtime)',
    'os.utime(p, (1000000000, 1100000000)); pathlib.Path(p).touch(); t = int(os.stat(p).st_mtime)',
    'near = lambda m: "now" if abs(m - time.time()) <= 5 else f"mtime={m}"',
    'print(e, near(u), near(t))',
  ].join('\n'));
  assert.equal(times, '1100000000 now now', 'os.utime explicit; os.utime(p) and Path.touch() set mtime to now');

  const cpu = await py('root', [
    'import os, resource, time',
    't0 = os.times(); r0 = resource.getrusage(resource.RUSAGE_SELF).ru_utime; w = time.time()',
    'p0 = time.process_time()',
    'while time.process_time() - p0 < 0.6 and time.time() - w < 20: pass',
    't1 = os.times(); r1 = resource.getrusage(resource.RUSAGE_SELF).ru_utime',
    'print(f"{t1.user - t0.user:.1f} {r1 - r0:.1f} {t1.system} {t1.children_user} {t1.children_system}")',
  ].join('\n'));
  const [tu, ru, ...rest] = cpu.split(' ');
  assert.ok(Number(tu) >= 0.4 && Number(tu) < 5 && Number(ru) >= 0.4 && Number(ru) < 5, `os.times / getrusage CPU: ${cpu}`);
  assert.deepEqual(rest, ['0.0', '0.0', '0.0'], `system and children's times: ${cpu}`);

  const site = `/usr/local/lib/python${PYV}/site-packages`;
  await as('root', ['mkdir', '-p', `${site}/hs_sys`]);
  await write(`${site}/hs_sys/__init__.py`, 'VALUE = "system"\n');
  await write(`${site}/hs-sys.pth`, 'import sys; sys.hs_sys_pth = True\n');
  const sys1 = await py('cone', `import sys, hs_sys; print(hs_sys.VALUE, getattr(sys, "hs_sys_pth", False), sys.path.index("${site}") > max(i for i, p in enumerate(sys.path) if p.endswith("/lib/python${PYV}/site-packages") and not p.startswith("/usr/local")))`);
  assert.equal(sys1, 'system True True', `cone sees the system site dir and its .pth, after python's own site-packages: ${sys1}`);
  await as('cone', ['python3', '-m', 'venv', 'iso']);
  await as('cone', ['python3', '-m', 'venv', '--without-pip', '--system-site-packages', 'withsys']);
  assert.equal(await as('cone', ['iso/bin/python', '-c', 'import importlib.util; print(importlib.util.find_spec("hs_sys") is None)']), 'True', 'a plain venv does not see the system site dir');
  assert.equal(await as('cone', ['withsys/bin/python', '-c', 'import hs_sys; print(hs_sys.VALUE)']), 'system', 'a --system-site-packages venv sees it');

  const pkgDir = await py('root', 'import os, sys; print(os.path.realpath(sys.base_prefix))');
  await as('root', ['rm', '-rf', `${pkgDir}/.slicc-site-cache`, '/root/.cache/slicc-site', '/home/cone/.cache/slicc-site']);
  for (const user of ['root', 'cone']) {
    await py(user, 'pass');
    await py(user, 'pass');
    const home = user === 'cone' ? '/home/cone' : '/root';
    const listed = await as(user, ['bash', '-c', `ls ${home}/.cache/slicc-site | wc -l; if [ -e ${pkgDir}/.slicc-site-cache ]; then echo 1; else echo 0; fi`]);
    assert.equal(listed, '1\n0', `${user}: one cache file under ~/.cache/slicc-site, none in the package dir: ${listed}`);
  }
  const noHome = await run(['python3', '-c', 'import _slicc_site as s; print(s._cache_path("/x"))'], { cwd: '/tmp', env: { HOME: '' } });
  assert.equal(noHome.stdout.trim(), 'None', `no HOME: no cache: ${noHome.stdout}${noHome.stderr}`);

  for (const user of ['root', 'cone']) {
    for (const cmd of ['pip', 'pip3']) {
      const v = await as(user, [cmd, '--version']);
      assert.match(v, /^pip \d+\.\d+(\.\d+)? from .* \(python 3\.14\)$/, `${user} ${cmd} --version: ${v}`);
    }
  }
  await as('cone', ['mkdir', '-p', '/home/cone/wheels']);
  await write('/home/cone/mkwheel.py', WHEEL);
  await as('cone', ['python3', '/home/cone/mkwheel.py', '/home/cone/wheels']);
  await as('cone', ['pip', 'install', '--user', '--no-index', '--find-links', '/home/cone/wheels', 'hs_user']);
  const user = await py('cone', 'import hs_user, site; print(hs_user.VALUE, hs_user.__file__.startswith(site.getusersitepackages()))');
  assert.equal(user, '17 True', `pip install --user lands in cone's user site: ${user}`);
  const venvPip = await as('cone', ['iso/bin/pip', '--version']);
  assert.match(venvPip, /\/home\/cone\/iso\/lib\/python3\.14\/site-packages\/pip /, `a venv's own bin/pip: ${venvPip}`);

  const fork = await py('root', 'import ctypes, os; l = ctypes.CDLL(None); print([n for n in ("fork", "_Fork", "_fork_internal", "__vfork_internal", "__wasi_proc_fork", "__wasi_proc_fork_env") if hasattr(l, n)], hasattr(os, "fork"), hasattr(l, "posix_spawn"), l.system(b"exit 3") >> 8)');
  assert.equal(fork, '[] False True 3', `no fork entry point through ctypes (homescoop#296); posix_spawn and system stay: ${fork}`);
  console.log(`round17: ${times}; cpu ${cpu}; system site ${sys1}; per-user cache; pip/pip3, --user, venv pip; ctypes has no fork entry point, posix_spawn/system stay: ${fork}`);
}
