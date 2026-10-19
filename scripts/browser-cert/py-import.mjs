const S = '@ai-ecoverse';
const SCRIPT = String.raw`
import importlib, json, os, sys, sysconfig
top, skip = sys.argv[1], json.loads(sys.argv[2])
dist = sys.argv[3] if len(sys.argv) > 3 else ""
m = importlib.import_module(top)
site = os.path.dirname(os.path.dirname(os.path.abspath(m.__file__))) if hasattr(m, "__path__") else os.path.dirname(os.path.abspath(m.__file__))
suffix = sysconfig.get_config_var("EXT_SUFFIX") or ".cpython-314-wasm32-wasix.so"
ext, failed = [], []
for d, _, files in sorted(os.walk(os.path.join(site, top))):
    for f in sorted(files):
        if f.endswith(suffix):
            name = os.path.relpath(os.path.join(d, f[: -len(suffix)]), site).replace(os.sep, ".")
            if name in skip:
                continue
            try:
                importlib.import_module(name)
                ext.append(name)
            except Exception as e:
                failed.append([name, type(e).__name__ + ": " + str(e)])
md = None
if dist:
    import importlib.metadata
    try:
        md = importlib.metadata.version(dist)
    except importlib.metadata.PackageNotFoundError as e:
        md = "PackageNotFoundError: " + str(e)
print(json.dumps({"version": getattr(m, "__version__", None), "metadata": md, "file": os.path.realpath(m.__file__), "site": site, "ext": ext, "failed": failed, "pythonpath": os.environ.get("PYTHONPATH"), "python": sys.version.split()[0], "prefix": os.path.realpath(sys.base_prefix)}))
`;

export async function pythonUnderTest(ctx) {
  return JSON.parse(await ctx.read(`/node_modules/${S}/wasix-python/package.json`)).version;
}

// dist: also check importlib.metadata.version(dist) is the module's version
// (the package ships its dist-info; homescoop#731).
export async function pyImport(ctx, { pkg, module, version, minExt = 0, skip = [], dist }) {
  const { run, write, read, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  const own = JSON.parse(await read(`/node_modules/${S}/${pkg}/package.json`));
  const nested = await run(['python3', '-c', `import os,sys; print(os.path.exists(sys.argv[1]))`, `/node_modules/${S}/${pkg}/node_modules/${S}/wasix-python`], { cwd: '/tmp' });
  assert.equal(nested.stdout.trim(), 'False', `${pkg} brings no python of its own: ${nested.stdout}${nested.stderr}`);
  await write(`/tmp/${pkg}-import.py`, SCRIPT);
  const r = await run(['python3', `/tmp/${pkg}-import.py`, module, JSON.stringify(skip), ...(dist ? [dist] : [])], { cwd: '/tmp' });
  assert.equal(r.status, 0, `import ${module}: rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  if (version !== undefined) assert.equal(out.version, version, o);
  if (dist) assert.equal(out.metadata, out.version, `importlib.metadata.version(${JSON.stringify(dist)}) is ${module}'s version (dist-info shipped): ${o}`);
  assert.equal(out.pythonpath, null, `no PYTHONPATH: ${o}`);
  assert.ok(out.file.startsWith(`/node_modules/${S}/${pkg}/`), `${module} comes from ${pkg} (slicc.python discovery): ${o}`);
  assert.equal(out.prefix, `/node_modules/${S}/wasix-python`, o);
  assert.deepEqual(out.failed, [], `every side module of ${module} imports: ${o}`);
  assert.ok(out.ext.length >= minExt, `${module}: ${out.ext.length} side modules, at least ${minExt}: ${o}`);
  console.log(`${pkg} ${own.version} (${module} ${out.version}) on ${S}/wasix-python ${python} (CPython ${out.python}), found without PYTHONPATH; ${out.ext.length} side modules import${skip.length ? ` (not imported: ${skip.join(', ')})` : ''}`);
  return { python, ...out };
}
