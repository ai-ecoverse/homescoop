/**
 * wasix-python 3.14.2-12: file modes on wasix-sysroot 2025.9.30-17 with
 * slicc-kernel >= 1.35.1's slicc_fs (homescoop#169, #181). umask 027 →
 * open() 640 and mkdir 750; mkstemp 600; mkdtemp 700; os.chmod reads back
 * through os.stat and coreutils' stat; a pip-installed console script (from
 * a wheel built here, installed into a venv) is 755 and runs.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const ok = async (argv, cwd = '/home') => {
    const r = await run(argv, { cwd, env: { PIP_NO_INDEX: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' } });
    assert.equal(r.status, 0, `${argv.join(' ')}: rc=${r.status}\n${r.stdout}\n${r.stderr}`);
    return r.stdout;
  };

  await ok(['mkdir', '-p', '/home/modes']);
  const modes = await ok(['python', '-c', `
import os, stat, tempfile
m = lambda p: oct(stat.S_IMODE(os.stat(p).st_mode))
print(oct(os.umask(0o027)))
open("f", "w").close(); print(m("f"))
os.mkdir("sub"); print(m("sub"))
fd, p = tempfile.mkstemp(dir="."); os.close(fd); print(m(p))
print(m(tempfile.mkdtemp(dir=".")))
os.chmod("f", 0o755); print(m("f"), os.access("f", os.X_OK))
os.chmod("f", 0o600); print(m("f"))
`], '/home/modes');
  assert.equal(modes, '0o22\n0o640\n0o750\n0o600\n0o700\n0o755 True\n0o600\n');
  assert.equal(await ok(['stat', '-c', '%a', 'f', 'sub'], '/home/modes'), '600\n750\n');

  // A wheel with a console script, built here (zipfile), pip-installed into a venv.
  await write('/home/mkwheel.py', `
import base64, hashlib, zipfile
name, ver = "hs_hello", "1.0"
di = f"{name}-{ver}.dist-info"
files = {
    f"{name}/__init__.py": "def main():\\n    print('hello from a wheel')\\n",
    f"{di}/METADATA": f"Metadata-Version: 2.1\\nName: {name}\\nVersion: {ver}\\n",
    f"{di}/WHEEL": "Wheel-Version: 1.0\\nGenerator: homescoop-cert\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n",
    f"{di}/entry_points.txt": f"[console_scripts]\\nhs-hello = {name}:main\\n",
}
record = []
with zipfile.ZipFile(f"/home/wheels/{name}-{ver}-py3-none-any.whl", "w") as z:
    for path, text in files.items():
        data = text.encode()
        z.writestr(path, data)
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        record.append(f"{path},sha256={digest},{len(data)}")
    record.append(f"{di}/RECORD,,")
    z.writestr(f"{di}/RECORD", "\\n".join(record) + "\\n")
`);
  await ok(['mkdir', '-p', '/home/wheels']);
  await ok(['python', '/home/mkwheel.py']);
  await ok(['python', '-m', 'venv', 'mv']);
  await ok(['mv/bin/pip', 'install', '--find-links', '/home/wheels', 'hs_hello']);
  assert.equal(await ok(['stat', '-c', '%a', 'mv/bin/hs-hello']), '755\n');
  assert.equal(await ok(['python', '-c', 'import os, stat; print(oct(stat.S_IMODE(os.stat("mv/bin/hs-hello").st_mode)))']), '0o755\n');
  assert.equal(await ok(['mv/bin/hs-hello']), 'hello from a wheel\n');
}
