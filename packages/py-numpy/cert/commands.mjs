const PKG = '/node_modules/@ai-ecoverse/py-numpy';

export default async function (ctx) {
  const { run, read, assert } = ctx;
  const version = await run(['numpy-config', '--version'], { cwd: '/tmp' });
  assert.equal(version.status, 0, `numpy-config --version: rc=${version.status} stdout=${version.stdout} stderr=${version.stderr}`);
  assert.equal(version.stdout.trim(), '2.5.4', `numpy-config --version: ${version.stdout}`);

  const cflags = await run(['numpy-config', '--cflags'], { cwd: '/tmp' });
  assert.equal(cflags.status, 0, `numpy-config --cflags: rc=${cflags.status} stderr=${cflags.stderr}`);
  const flag = cflags.stdout.trim();
  assert.ok(flag.startsWith('-I') && flag.endsWith('/numpy/_core/include'), `numpy-config --cflags: ${flag}`);
  const header = await run(['python3', '-c', 'import os,sys; print(os.path.realpath(sys.argv[1]))', `${flag.slice(2)}/numpy/arrayobject.h`], { cwd: '/tmp' });
  assert.equal(header.stdout.trim(), `${PKG}/lib/python3.15/site-packages/numpy/_core/include/numpy/arrayobject.h`, `numpy-config --cflags names this package's headers: ${header.stdout}${header.stderr}`);
  const exists = await run(['python3', '-c', 'import os,sys; print(os.path.isfile(sys.argv[1]))', header.stdout.trim()], { cwd: '/tmp' });
  assert.equal(exists.stdout.trim(), 'True', `numpy/arrayobject.h exists: ${exists.stdout}${exists.stderr}`);

  const f2py = await run(['f2py', '-v'], { cwd: '/tmp' });
  assert.equal(f2py.status, 0, `f2py -v: rc=${f2py.status} stdout=${f2py.stdout} stderr=${f2py.stderr}`);
  assert.equal(f2py.stdout.trim(), '2.5.4', `f2py -v: ${f2py.stdout}`);

  const own = JSON.parse(await read(`${PKG}/package.json`));
  assert.deepEqual(Object.keys(own.slicc?.commands ?? {}).sort(), ['f2py', 'numpy-config'], `slicc.commands: ${JSON.stringify(own.slicc?.commands)}`);
  console.log(`commands: numpy-config --version ${version.stdout.trim()}, --cflags ${cflags.stdout.trim()}; f2py -v ${f2py.stdout.trim()} (homescoop#1405)`);
}
