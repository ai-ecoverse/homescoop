/**
 * wasix-python 3.15.0-10: the pip guard knows the native-crypto chain
 * (cffi, cryptography, PyNaCl, bcrypt; homescoop#2119). With the homescoop
 * builds installed (this cert's needs), pip treats them as satisfied, so a
 * package that requires them installs from a local wheel. In a venv without
 * them, pip stops at once with a hint that names the @ai-ecoverse/py-* to
 * install and says nothing about pydata or matplotlib (3.15.0-8's hint did,
 * for every package outside the pydata catalog).
 */
const MKDEP = String.raw`
import base64, hashlib, sys, zipfile
name, ver = "hs_needs_crypto", "1.0"
di = f"{name}-{ver}.dist-info"
files = {
    f"{name}/__init__.py": "from cryptography.hazmat.primitives import hashes\nimport nacl.utils, bcrypt, _cffi_backend\nVALUE = len(nacl.utils.random(8))\n",
    f"{di}/METADATA": (
        f"Metadata-Version: 2.1\nName: {name}\nVersion: {ver}\n"
        "Requires-Dist: cryptography>=46\nRequires-Dist: PyNaCl>=1.5\nRequires-Dist: cffi>=2.0.0\nRequires-Dist: bcrypt\n"
    ),
    f"{di}/WHEEL": "Wheel-Version: 1.0\nGenerator: homescoop-cert\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
}
record = []
with zipfile.ZipFile(f"/home/pcwheels/{name}-{ver}-py3-none-any.whl", "w") as z:
    for path, text in files.items():
        data = text.encode()
        z.writestr(path, data)
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        record.append(f"{path},sha256={digest},{len(data)}")
    record.append(f"{di}/RECORD,,")
    z.writestr(f"{di}/RECORD", "\n".join(record) + "\n")
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const env = { PIP_NO_INDEX: '1', PIP_FIND_LINKS: '/home/pcwheels', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
  const sh = (script) => run(['bash', '-c', script], { cwd: '/home', env });
  const ok = async (script) => {
    const r = await sh(script);
    assert.equal(r.status, 0, `${script}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return `${r.stdout}\n${r.stderr}`;
  };
  const refused = async (script, names, npms) => {
    const r = await sh(script);
    const text = `${r.stdout}\n${r.stderr}`;
    assert.notEqual(r.status, 0, `${script}: expected a refusal, got rc 0\n${text}`);
    assert.match(text, new RegExp(`pip cannot install (${names}) on WASIX`), text);
    assert.match(text, new RegExp(`pnpm add -g @ai-ecoverse/py-(${npms})\\b`), text);
    assert.match(text, /Install the homescoop build/, text);
    assert.doesNotMatch(text, /pydata|Python data tools|matplotlib/, `the crypto hint names no data tools: ${text}`);
    assert.doesNotMatch(text, /Building wheel|setup\.py|Collecting .*\.tar\.gz/, `refused before any sdist build: ${text}`);
    return text;
  };

  await ok('mkdir -p /home/pcwheels');
  await write('/home/mkdep_crypto.py', MKDEP);
  await ok('python3 /home/mkdep_crypto.py');

  // Installed (this cert's needs): satisfied, under their PyPI names in any spelling.
  for (const cmd of ['pip install cryptography', 'pip3 install PyNaCl', 'python3 -m pip install CFFI', 'pip install bcrypt', 'pip install "cryptography>=46" "pynacl>=1.5"']) {
    assert.match(await ok(cmd), /Requirement already satisfied/, cmd);
  }
  // A dependent resolves to the installed homescoop packages and imports.
  const dep = await ok('pip install --user hs_needs_crypto');
  assert.match(dep, /Successfully installed hs[-_]needs[-_]crypto-1\.0/i, dep);
  assert.doesNotMatch(dep, /pip cannot install/, dep);
  assert.equal((await ok("python3 -c 'import hs_needs_crypto; print(hs_needs_crypto.VALUE)'")).trim(), '8');

  // A venv without system site-packages has none of them: refused, each with its own package.
  await ok('python3 -m venv /home/pcv');
  const cases = [
    ['/home/pcv/bin/pip install cryptography', 'cryptography', 'cryptography'],
    ['/home/pcv/bin/pip install PyNaCl', 'pynacl', 'pynacl'],
    ['/home/pcv/bin/pip install cffi', 'cffi', 'cffi'],
    ['/home/pcv/bin/pip install bcrypt', 'bcrypt', 'bcrypt'],
    // the dependent: refused at its first native requirement
    ['/home/pcv/bin/pip install hs_needs_crypto', 'cryptography|pynacl|cffi|bcrypt', 'cryptography|pynacl|cffi|bcrypt'],
  ];
  for (const [cmd, names, npms] of cases) await refused(cmd, names, npms);
  console.log('pip-crypto: with py-cffi/-cryptography/-pynacl/-bcrypt installed, pip sees them as satisfied and a wheel requiring all four installs and imports; a plain venv refuses each (and the dependent) at once, naming its @ai-ecoverse/py-* and no pydata');
}
