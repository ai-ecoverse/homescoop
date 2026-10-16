// homescoop#439: zip - writes a well-formed archive to stdout, redirected to
// a file (zip seeks back and fills in each local header) or into a pipe
// (zip can't seek: data descriptors), as on Unix.
import { HOME, USER, localHeaders, readBytes, sh } from './lib/zipkit.mjs';

export default async function stdout(ctx) {
  const { assert } = ctx;
  await ctx.addUser({ name: USER });
  const big = Array.from({ length: 3000 }, (_, i) => `row ${i} of the stdout cert\n`).join('');
  const cwd = `${HOME}/so`;
  await ctx.write('/tmp/zc-so/big.txt', big);
  const made = await sh(ctx, `mkdir -p so && cd so && printf 'alpha\\n' > a.txt && cp /tmp/zc-so/big.txt . && zip -q - a.txt big.txt > file.zip && zip -q - a.txt big.txt | cat > pipe.zip`);
  assert.equal(made.status, 0, `zip -: rc ${made.status}\n${made.stderr}`);
  for (const [zip, descriptors] of [['file.zip', 0], ['pipe.zip', 8]]) {
    const t = await ctx.run(['unzip', '-t', zip], { cwd, user: USER });
    assert.equal(t.status, 0, `unzip -t ${zip}: rc ${t.status}\n${t.stdout}${t.stderr}`);
    assert.doesNotMatch(t.stdout + t.stderr, /extra bytes|bad zipfile offset/, `${zip}: no stray bytes`);
    assert.match(t.stdout, new RegExp(`No errors detected in compressed data of ${zip.replace('.', '\\.')}\\.`));
    const p = await ctx.run(['unzip', '-p', zip, 'a.txt'], { cwd, user: USER });
    assert.equal(p.stdout, 'alpha\n', `${zip}: unzip -p a.txt`);
    const b = await ctx.run(['unzip', '-p', zip, 'big.txt'], { cwd, user: USER });
    assert.equal(b.stdout, big, `${zip}: unzip -p big.txt returns the bytes`);
    const heads = localHeaders(await readBytes(ctx, `${cwd}/${zip}`));
    assert.equal(heads[0].at, 0, `${zip}: the first local header is at 0`);
    assert.equal(heads[0].name, 'a.txt');
    assert.equal(heads[0].flags & 8, descriptors, `${zip}: data descriptors ${descriptors ? 'on a pipe' : 'off when the redirect seeks'}`);
    if (!descriptors) assert.deepEqual(heads.map((h) => h.name), ['a.txt', 'big.txt'], `${zip}: one header per entry`);
  }
}
