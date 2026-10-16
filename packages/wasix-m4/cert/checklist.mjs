export default async function (ctx) {
  const { run, write, assert, installed } = ctx;
  const m4 = (argv, o = {}) => run(['m4', ...argv], { cwd: '/tmp/m4', ...o });
  await write('/tmp/m4/inc/greet.m4', "define(`greet', `hello, $1')dnl\n");

  const engines = installed[0].engines?.['slicc-kernel'];
  assert.equal(engines, '>=1.44.0', `package.json engines.slicc-kernel (wasix-sysroot >= -20 asks the kernel for user ids): ${JSON.stringify(installed[0].engines)}`);

  const ver = await m4(['--version']);
  assert.equal(ver.status, 0, ver.stderr);
  assert.match(ver.stdout, /^m4 \(GNU M4\) 1\.4\.20\n/);

  const def = await m4([], { stdin: "define(`x', `y')x\n" });
  assert.deepEqual([def.status, def.stdout], [0, 'y\n'], def.stderr);

  const real = await m4(['-I', '/tmp/m4/inc'], { stdin: "include(`greet.m4')greet(`world')\neval(2**10)\nifelse(len(`abc'), 3, `three')\nchangequote([,])define([q],[ok])q\n" });
  assert.deepEqual([real.status, real.stdout], [0, 'hello, world\n1024\nthree\nok\n'], real.stderr);

  const sys = await m4([], { stdin: "syscmd(`true')sysval\nesyscmd(`echo hi')dnl\n" });
  assert.deepEqual([sys.status, sys.stdout], [0, '0\nhi\n'], `syscmd/esyscmd run /bin/sh through the kernel: ${sys.stderr}`);

  for (const env of [{}, { LC_ALL: 'C.UTF-8' }]) {
    const miss = await m4(['nosuchfile'], { env });
    assert.equal(miss.status, 1, JSON.stringify(env));
    assert.equal(miss.stderr, "m4: cannot open `nosuchfile': No such file or directory\n", JSON.stringify(env));
  }
  console.log('wasix-m4: engines >=1.44.0; --version 1.4.20; define, include -I, eval, ifelse/len, changequote; syscmd/esyscmd; a missing file is rc 1 in C and C.UTF-8');
}
