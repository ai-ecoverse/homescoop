// ctx.write and ctx.readBytes carry bytes exactly, in both directions
// (#591: a Uint8Array was written UTF-8 encoded; #738: read decoded UTF-8).
import { randomBytes } from 'node:crypto';

export default async function ({ run, write, read, readBytes, assert }) {
  const dir = '/tmp/binary-selftest';
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  const b64 = Buffer.from(all).toString('base64');

  // host -> kernel: the kernel sees the same 256 bytes.
  await write(`${dir}/all.bin`, all);
  const seen = await run(['base64', '-w0', `${dir}/all.bin`], { cwd: '/tmp' });
  assert.equal(seen.status, 0, seen.stderr);
  assert.equal(seen.stdout, b64, 'ctx.write(Uint8Array) is byte-exact (all 256 values)');
  const size = await run(['wc', '-c', `${dir}/all.bin`], { cwd: '/tmp' });
  assert.match(size.stdout, /^256 /, `256 bytes, not UTF-8 expanded: ${size.stdout}`);

  // kernel -> host: bytes the kernel wrote come back exact.
  const made = await run(['bash', '-c', `base64 -d > ${dir}/made.bin`], { cwd: '/tmp', stdin: b64 });
  assert.equal(made.status, 0, made.stderr);
  const back = await readBytes(`${dir}/made.bin`);
  assert.ok(Buffer.isBuffer(back), 'readBytes resolves a Buffer');
  assert.equal(back.length, 256);
  assert.deepEqual([...back], [...all], 'ctx.readBytes is byte-exact (all 256 values)');

  // Round trip of a Buffer, an ArrayBuffer and a typed-array view at an offset.
  const big = randomBytes(1 << 20);
  await write(`${dir}/big.bin`, big);
  assert.ok(big.equals(await readBytes(`${dir}/big.bin`)), '1 MiB of random bytes round-trips');
  await write(`${dir}/ab.bin`, all.buffer);
  assert.ok(Buffer.from(all).equals(await readBytes(`${dir}/ab.bin`)), 'an ArrayBuffer round-trips');
  await write(`${dir}/view.bin`, all.subarray(250));
  assert.deepEqual([...(await readBytes(`${dir}/view.bin`))], [250, 251, 252, 253, 254, 255], 'only the view is written');

  await write(`${dir}/arr.bin`, [0, 0x80, 0xff, 0x89, 0x50]);
  assert.deepEqual([...(await readBytes(`${dir}/arr.bin`))], [0, 0x80, 0xff, 0x89, 0x50], 'a number array is written as bytes');

  // Strings are unchanged: UTF-8 text in, text out.
  await write(`${dir}/text.txt`, 'caf\u00e9\n');
  assert.equal(await read(`${dir}/text.txt`), 'caf\u00e9\n');
  assert.deepEqual([...(await readBytes(`${dir}/text.txt`))], [0x63, 0x61, 0x66, 0xc3, 0xa9, 0x0a]);

  assert.equal(await readBytes(`${dir}/missing.bin`), null, 'a missing file is null');
  assert.equal(await read(`${dir}/missing.bin`), null);
}
