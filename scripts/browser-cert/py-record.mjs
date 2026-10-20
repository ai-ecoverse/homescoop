const S = '@ai-ecoverse';
const SCRIPT = String.raw`
import base64, csv, hashlib, importlib.util, json, os, shutil, sys
def check(site):
    infos = sorted(d for d in os.listdir(site) if d.endswith(".dist-info"))
    out = {"dist_info": infos, "ok": 0, "missing": [], "mismatch": [], "unlisted": [], "pyc": 0, "pyc_bad": []}
    listed = set()
    for info in infos:
        with open(os.path.join(site, info, "RECORD"), newline="") as f:
            for row in csv.reader(f):
                if not row:
                    continue
                listed.add(row[0])
                if not row[1]:
                    continue
                path = os.path.join(site, row[0])
                if not os.path.isfile(path):
                    out["missing"].append(row[0])
                    continue
                algo, want = row[1].split("=", 1)
                got = base64.urlsafe_b64encode(hashlib.new(algo, open(path, "rb").read()).digest()).rstrip(b"=").decode()
                if got == want:
                    out["ok"] += 1
                else:
                    out["mismatch"].append(row[0])
    for d, dirs, files in os.walk(site):
        for f in files:
            rel = os.path.relpath(os.path.join(d, f), site)
            if f.endswith(".pyc") and os.path.basename(d) == "__pycache__":
                out["pyc"] += 1
                src = os.path.join(os.path.dirname(d), f.split(".")[0] + ".py")
                data = open(os.path.join(d, f), "rb").read(16)
                flags = int.from_bytes(data[4:8], "little")
                if not os.path.isfile(src) or flags != 1 or data[8:16] != importlib.util.source_hash(open(src, "rb").read()):
                    out["pyc_bad"].append(rel)
            elif rel not in listed:
                out["unlisted"].append(rel)
    return out
site = sys.argv[1]
real = check(site)
copy = "/tmp/py-record-selftest"
shutil.rmtree(copy, ignore_errors=True)
shutil.copytree(site, copy)
victim = sorted(r for r in (os.path.relpath(os.path.join(d, f), copy) for d, _, fs in os.walk(copy) for f in fs) if r.endswith(".py"))[0]
with open(os.path.join(copy, victim), "r+b") as f:
    b = f.read(1)
    f.seek(0)
    f.write(bytes([b[0] ^ 1]))
bad = check(copy)
shutil.rmtree(copy, ignore_errors=True)
print(json.dumps({"real": real, "victim": victim, "selftest": {"mismatch": bad["mismatch"], "pyc_bad": bad["pyc_bad"]}}))
`;

export async function pyRecord(ctx, { pkg, minFiles = 1 }) {
  const { run, write, read, assert } = ctx;
  const pj = JSON.parse(await read(`/node_modules/${S}/${pkg}/package.json`));
  const site = `/node_modules/${S}/${pkg}/${pj.slicc.python.sitePackages}`;
  await write(`/tmp/${pkg}-record.py`, SCRIPT);
  const r = await run(['python3', `/tmp/${pkg}-record.py`, site], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  const { real, victim, selftest } = out;
  assert.equal(real.dist_info.length, 1, `one dist-info: ${o}`);
  assert.ok(real.ok >= minFiles, `${real.ok} files match the wheel's RECORD, at least ${minFiles}: ${o}`);
  assert.deepEqual([real.missing, real.mismatch, real.unlisted], [[], [], []], `every file is the wheel's, none missing or extra: ${o}`);
  // A version-neutral package (lib/python3/site-packages, homescoop#1283)
  // ships no .pyc: they're tied to one minor.
  const neutral = pj.slicc.python.sitePackages === 'lib/python3/site-packages';
  if (neutral) assert.equal(real.pyc, 0, `a version-neutral package ships no .pyc: ${o}`);
  else assert.ok(real.pyc > 0, o);
  assert.deepEqual(real.pyc_bad, [], `every .pyc is unchecked-hash and matches its source: ${o}`);
  // The cache tag of the python line the package targets (lib/python3.X/site-packages).
  const minor = /^lib\/python3\.(\d+)\//.exec(pj.slicc.python.sitePackages)?.[1] ?? '14';
  const tag = `cpython-3${minor}`;
  const pyc = victim.replace(/([^/]+)\.py$/, `__pycache__/$1.${tag}.pyc`);
  assert.deepEqual(selftest.mismatch, [victim], `self-test: one flipped byte in ${victim} is a RECORD mismatch: ${o}`);
  assert.deepEqual(selftest.pyc_bad, neutral ? [] : [pyc], `self-test: and its .pyc no longer matches its source: ${o}`);
  console.log(`${pkg} ${pj.version}: ${real.dist_info[0]}: all ${real.ok} RECORD files match the wheel (none missing, none extra), ${real.pyc} .pyc unchecked-hash on their sources; self-test: a flipped byte in ${victim} is caught (RECORD and .pyc)`);
  return out;
}
