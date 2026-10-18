/**
 * patches/cpython-stdout-line-buffer-nonreg.patch (since 3.14.2-7,
 * homescoop#1145): stdout is line-buffered whenever it isn't a regular file,
 * so a pipe streams line by line, and a regular file stays block-buffered.
 * Stock CPython block-buffers a pipe (st_mode S_IFIFO since wasix-sysroot
 * -21). A line printed before a long sleep reaches the reader of the pipe
 * before the process ends; -u and PYTHONUNBUFFERED still turn buffering off.
 */
const PROBE = 'import sys; print(sys.stdout.line_buffering, sys.stdout.isatty(), sys.stdout.write_through)';

export default async function (ctx) {
  const { run, assert } = ctx;
  const sh = async (script) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${script}: rc=${r.status} ${r.stderr}`);
    return r.stdout;
  };
  assert.equal(await sh(`python3 -c '${PROBE}' | cat`), 'True False False\n', 'stdout on a pipe is line-buffered');
  assert.equal(await sh(`python3 -c '${PROBE}' > /tmp/sb.txt; cat /tmp/sb.txt`), 'False False False\n', 'stdout on a regular file stays block-buffered');
  assert.equal(await sh(`python3 -u -c '${PROBE}' | cat`), 'False False True\n', '-u: write-through, no buffering');
  assert.equal(await sh(`PYTHONUNBUFFERED=1 python3 -c '${PROBE}' | cat`), 'False False True\n', 'PYTHONUNBUFFERED: write-through');
  const reader = 'import sys, time; l = sys.stdin.readline(); a = time.monotonic(); sys.stdin.read(); print(l.strip(), round(time.monotonic() - a, 2))';
  const stream = (await sh(`python3 -c 'import time; print("first"); time.sleep(3); print("second")' | python3 -c '${reader}'`)).trim().split(' ');
  const gap = Number(stream[1]);
  assert.equal(stream[0], 'first', stream.join(' '));
  assert.ok(gap >= 2, `the first line reached the pipe's reader ${gap} s before the end, not only at exit`);
  console.log(`stdout-buffer: a pipe is line-buffered (the first line arrived ${gap} s before python exited), a regular file block-buffered, -u and PYTHONUNBUFFERED write-through`);
}
