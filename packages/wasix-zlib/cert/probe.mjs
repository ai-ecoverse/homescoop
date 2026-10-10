/** wasix-zlib: the probe in both flavours (static lib/, PIC lib-pic/). */
export default async function (ctx) {
  const { run, assert } = ctx;
  for (const cmd of ['zprobe', 'zprobe-pic']) {
    const cwd = `/home/${cmd}`;
    assert.equal((await run(['mkdir', '-p', cwd])).status, 0);
    const r = await run([cmd], { cwd });
    assert.equal(r.status, 0, `${cmd}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout, /^zlib 1\.3\.1$/m, cmd);
    // WASI off_t is 64-bit; the shipped zconf.h makes z_off_t off_t.
    assert.match(r.stdout, /^sizeof\(z_off_t\) 8$/m, cmd);
    assert.match(r.stdout, /^zprobe ok$/m, cmd);
    const magic = await run(['bash', '-c', 'od -An -tx1 -N2 probe.gz | tr -d " \\n"'], { cwd });
    assert.equal(magic.stdout, '1f8b', `${cmd}: probe.gz magic`);
  }
}
