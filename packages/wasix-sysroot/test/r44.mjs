const log = [];

const loopback = () => {
  let feed;
  const readable = new ReadableStream({
    type: 'bytes',
    start(c) {
      feed = c;
    },
  });
  const writable = new WritableStream({
    write(chunk) {
      feed.enqueue(new Uint8Array(chunk));
    },
  });
  const control = (op, args) => {
    log.push(args === undefined ? op : `${op} ${JSON.stringify(args)}`);
    if (op === 'signals') return { clearToSend: true, dataSetReady: false, dataCarrierDetect: true, ringIndicator: false };
    return undefined;
  };
  return { readable, writable, control };
};

export const kernelOptions = { devices: { open: async () => loopback() } };

const PIPE_NEW = [
  'pipe TIOCMGET: ENOTTY',
  'pipe TIOCMBIS: ENOTTY',
  'pipe TIOCSBRK: ENOTTY',
  'pipe TIOCEXCL: ENOTTY',
  'pipe TIOCOUTQ: ENOTTY',
  'pipe TCSBRK 1: ENOTTY',
  'pipe TCGETS2: ENOTTY',
  'pipe tcdrain: ENOTTY',
  'pipe tcflush TCIFLUSH: ENOTTY',
  'pipe tcflush 7: EINVAL',
  'pipe tcsendbreak: 0',
  'pipe unknown 0x5432: EINVAL',
  'pipe FIONREAD linux: 0 3',
  'pipe FIONREAD wasi: 0 3',
  'closed TIOCMGET: EBADF',
  'closed tcdrain: EBADF',
];

const PIPE_OLD = PIPE_NEW.map((l) => (/^pipe (TIOC|TC[SG])/.test(l) || l.startsWith('closed TIOCMGET') ? l.replace('ENOTTY', 'EINVAL').replace('EBADF', 'EINVAL') : l));

const SERIAL = [
  'open: 0 isatty=1',
  'TIOCEXCL: 0',
  'TIOCMGET: 0 dtr rts cts cd',
  'TIOCMBIC dtr: 0',
  'after TIOCMBIC: 0 rts cts cd',
  'TIOCMBIS dtr rts: 0',
  'TIOCMSET rts: 0',
  'after TIOCMSET: 0 rts cts cd',
  'TIOCSBRK: 0',
  'TIOCCBRK: 0',
  'TCSBRKP 1: 0',
  'tcsendbreak: 0',
  'write: 5',
  'tcdrain: 0',
  'TIOCOUTQ: 0 0',
  'FIONREAD linux: 5',
  'FIONREAD wasi: 0 5',
  'read: 5 hello',
  'pending: 3',
  'tcflush TCIFLUSH: 0',
  'after tcflush: 0',
  'TCFLSH TCIOFLUSH: 0',
  'tcflush TCOFLUSH: 0',
  'tcflush 7: EINVAL',
  'TCGETS2: 0 cbaud=15 ispeed=9600 ospeed=9600',
  'TCSETS2 250000: 0',
  'TCGETS2: 0 cbaud=10000 ispeed=250000 ospeed=250000',
  'TCSETSW2 460800: 0',
  'TCSETSF2 921600: 0',
  'tcsetattr B115200: 0 0',
  'TCGETS2: 0 ispeed=115200 ospeed=115200',
  'unknown 0x5432: EINVAL',
  'TIOCNXCL: 0',
  'close: 0',
];

const frame = (baudRate) => `configure {"baudRate":${baudRate},"dataBits":8,"parity":"none","stopBits":1,"flowControl":"none"}`;

const CONTROL = [
  'signals',
  'setSignals {"dataTerminalReady":false,"requestToSend":true}',
  'signals',
  'setSignals {"dataTerminalReady":true,"requestToSend":true}',
  'setSignals {"dataTerminalReady":false,"requestToSend":true}',
  'signals',
  'setSignals {"break":true}',
  'setSignals {"break":false}',
  'setSignals {"break":true}',
  'setSignals {"break":false}',
  'setSignals {"break":true}',
  'setSignals {"break":false}',
  'flush {"input":true,"output":false}',
  'flush {"input":true,"output":true}',
  'flush {"input":false,"output":true}',
  frame(250000),
  frame(460800),
  frame(921600),
  'flush {"input":true,"output":false}',
  frame(115200),
  'close',
];

const TTY = [
  'tty isatty: 1',
  'tty TIOCMGET: ERR',
  'tty tcdrain: 0',
  'tty tcflush TCIFLUSH: 0',
  'tty tcsendbreak: 0',
  'tty FIONREAD: 0 0',
];

export default async function (ctx) {
  const { run, pty, kernel, assert } = ctx;
  const serial = typeof kernel.devices?.add === 'function';
  if (process.env.R44_KERNEL === '1') assert.ok(serial, 'R44_KERNEL=1: this kernel has no kernel.devices');
  if (serial) await kernel.devices.add({ path: 'ttyUSB0', mode: 0o666, links: ['usb-10c4_ea60-if00'] });
  const r = await run(serial ? ['r44', '/dev/serial/by-id/usb-10c4_ea60-if00'] : ['r44'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.deepEqual(r.stdout.trim().split('\n'), [...(serial ? PIPE_NEW : PIPE_OLD), ...(serial ? SERIAL : []), 'r44 done'], r.stdout);
  if (serial) assert.deepEqual(log, CONTROL, log.join('\n'));
  const t = await pty(['r44', 'tty'], { cwd: '/tmp', steps: [{ expect: 'r44 tty done' }], timeoutMs: 10000 });
  assert.ok(!t.failedStep, `stuck at ${JSON.stringify(t.failedStep)}:\n${t.out}`);
  const ttyLines = t.out.split(/\r?\n/).map((l) => l.replace(/\r/g, '')).filter((l) => l.startsWith('tty '));
  assert.deepEqual(ttyLines, TTY.map((l) => l.replace('ERR', serial ? 'ENOTTY' : 'EINVAL')), t.out);
  console.log(`r44 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): ${serial
    ? 'on a serial node (kernel.devices with a loopback hook) TIOCMGET/TIOCMSET/TIOCMBIS/TIOCMBIC, TIOCSBRK/TIOCCBRK, TCSBRKP, tcsendbreak, tcdrain, TIOCOUTQ, FIONREAD (0x541B and 1), tcflush and TCFLSH, TCGETS2/TCSETS2/TCSETSW2/TCSETSF2 with BOTHER, TIOCEXCL/TIOCNXCL go through slicc_tty.ioctl and reach the hook; pipes answer ENOTTY, a closed fd EBADF'
    : 'no slicc_tty.ioctl: the serial requests answer EINVAL as before, FIONREAD polls, tcdrain/tcflush keep their -21 answers'}; on a pty tcdrain, tcflush and tcsendbreak still succeed and FIONREAD is 0`);
}
