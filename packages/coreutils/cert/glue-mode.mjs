import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

function tarball() {
  if (process.env.CERT_TARBALL) return process.env.CERT_TARBALL;
  const i = process.argv.indexOf('--tarball');
  return i >= 0 ? process.argv[i + 1] : '.homescoop-out/package.tgz';
}

export default async function (ctx) {
  const { run, write, assert, addUser } = ctx;
  await write('/tmp/cu.tar', gunzipSync(readFileSync(tarball())));
  const x = await run(['bash', '-c', 'rm -rf /tmp/cu && mkdir -p /tmp/cu && tar -xf /tmp/cu.tar -C /tmp/cu && stat -c "%a %n" /tmp/cu/package/bin/coreutils /tmp/cu/package/bin/coreutils.wasm'], { cwd: '/tmp' });
  assert.equal(x.status, 0, `tar -xf of the package: ${x.stdout}${x.stderr}`);
  assert.deepEqual(x.stdout.trim().split('\n'), ['755 /tmp/cu/package/bin/coreutils', '755 /tmp/cu/package/bin/coreutils.wasm'], `modes in the tarball: ${x.stdout}`);
  await addUser({ name: 'cone' });
  const v = await run(['bash', '-c', '/tmp/cu/package/bin/coreutils --coreutils-prog=true; echo "rc=$?"; /tmp/cu/package/bin/coreutils --version | head -1'], { cwd: '/tmp', user: 'cone' });
  assert.equal(v.status, 0, `${v.stdout}${v.stderr}`);
  assert.deepEqual(v.stdout.trim().split('\n'), ['rc=0', 'coreutils (GNU coreutils) 9.12'], `bin/coreutils by path as cone under users enforce: ${v.stdout}${v.stderr}`);
  console.log('glue-mode: the tarball has bin/coreutils and bin/coreutils.wasm 755; as cone (users enforce) bin/coreutils by path runs');
}
