export const kernelOptions = { hostname: 'r42-node' };

const LONG = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijkl';

export default async function (ctx) {
  const { run, assert } = ctx;
  const requireServed = process.env.R42_KERNEL === '1';
  const r = await run(['r42'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  const served = lines[0] === 'start: HOSTNAME set, /etc/hostname present';
  if (requireServed) assert.ok(served, `R42_KERNEL=1: the kernel serves no /etc/hostname to WASIX\n${r.stdout}`);
  else assert.ok(served || lines[0] === 'start: HOSTNAME set, /etc/hostname absent', r.stdout);
  const gone = served ? 'r42-node' : null;
  const want = [
    lines[0],
    `kernel file, no HOSTNAME: 0 ${served ? 'r42-node' : 'slicc'} uname=same`,
    'file: 0 r42-file uname=same',
    'file without newline: 0 r42-nonl uname=same',
    `file 64 chars: 0 ${LONG} uname=same`,
    'empty file: 0 r42-env uname=same',
    'blank line: 0 r42-second uname=same',
    'comment line: 0 r42-after uname=same',
    'comment only: 0 r42-env uname=same',
    'comment, no newline: 0 r42-env uname=same',
    'indented comment and blank lines: 0 r42-third uname=same',
    'comment then a bad line: 0 r42-env uname=same',
    '700-byte file, comment first: 0 r42-long uname=same',
    'file 65 chars: 0 r42-env uname=same',
    'file 399 chars, no newline: 0 r42-env uname=same',
    'file with a slash: 0 r42-env uname=same',
    'file with a space inside: 0 r42-env uname=same',
    ...(served ? ['mkfifo /etc/hostname: -1'] : [
      'mkfifo /etc/hostname: 0',
      'fifo, no writer: 0 r42-env',
      'fifo writer: 1',
      'fifo, a prefix then EAGAIN: 0 r42-env',
      'fifo, a comment then EAGAIN: 0 r42-env',
      'fifo, a whole line: 0 r42-pipe',
      'fifo, a comment then a line: 0 r42-pipe2',
    ]),
    `unlink /etc/hostname: ${served ? -1 : 0}`,
    `after unlink: /etc/hostname ${served ? 'present' : 'absent'}`,
    `no file: 0 ${gone ?? 'r42-env'} uname=same`,
    `no file, empty HOSTNAME: 0 ${gone ?? 'slicc'} uname=same`,
    `no file, no HOSTNAME: 0 ${gone ?? 'slicc'} uname=same`,
    'empty file, no HOSTNAME: 0 slicc uname=same',
    'gethostname 4 bytes: 0 r42',
    'r42 done',
  ];
  assert.deepEqual(lines, want, r.stdout);
  const rows = served
    ? 'the kernel serves /etc/hostname (r42-node) with HOSTNAME unset; a root-written file wins'
    : 'no kernel /etc/hostname for WASIX; a FIFO there with no writer or with a prefix and then EAGAIN gives HOSTNAME, a whole line in it is used; file missing gives HOSTNAME, both missing slicc';
  console.log(`r42 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): gethostname()/uname().nodename take /etc/hostname's first line that isn't blank or a '#' comment, trimmed (with or without a newline, 64 chars kept, comments up to 1024 bytes skipped); a comment-only file, an empty, 65-char, 399-char, slash or inner-space line falls back to HOSTNAME, then slicc; errno untouched; ${rows}`);
}
