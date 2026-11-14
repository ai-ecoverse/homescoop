import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fakePorts } from './fake-port.js';

const PYSERIAL = [
  'pyserial-3.5-py2.py3-none-any.whl',
  'c4451db6ba391ca6ca299fb3ec7bae67a5c55dde170964c7a14ceefec02f2cf0',
  'https://files.pythonhosted.org/packages/07/bc/587a445451b253b285629263eb51c2d8e9bcea4fc97826266d186f96f558/pyserial-3.5-py2.py3-none-any.whl',
];

const script = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

export default async function (ctx) {
  const { run, write, assert, page } = ctx;
  const serial = (responder, node) =>
    page.evaluate(async (src, n) => {
      if (typeof window.kernel.devices?.add !== 'function') return false;
      window.certSerialLog ??= [];
      const open = new Function(`return (${src})`)();
      window.certSerialClient ??= await window.kernel.connect({ devices: { open: (req) => open({ path: req.path, flags: req.flags }) } });
      await window.kernel.devices.add({ ...n, client: window.certSerialClient });
      return true;
    }, responder.toString(), node);
  const serialLog = () => page.evaluate(() => window.certSerialLog);
  const env = { PIP_NO_INDEX: '1', PIP_FIND_LINKS: '/home/serialwheels', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
  const ok = async (cmd, cwd = '/home') => {
    const r = await run(['bash', '-c', cmd], { cwd, env });
    assert.equal(r.status, 0, `${cmd}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return r;
  };

  assert.equal(await serial(fakePorts, { path: 'ttyUSB0', mode: 0o666, links: ['usb-10c4_ea60-if00'] }), true, 'this kernel has no kernel.devices');
  await serial(fakePorts, { path: 'ttyUSB1', mode: 0o666, links: ['usb-1a86_7523-if00'] });

  const [name, sha, url] = PYSERIAL;
  const res = await fetch(url);
  assert.ok(res.ok, `fetch ${name}: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, `${name} sha256`);
  await ok('mkdir -p /home/serialwheels');
  await write(`/home/serialwheels/${name}`, bytes);
  await ok('python -m venv /home/sv');
  const pip = await ok('/home/sv/bin/pip install pyserial');
  assert.match(pip.stdout, /Successfully installed pyserial-3\.5/, pip.stdout);

  await write('/home/loopback.py', script('loopback.py'));
  const lb = await ok('/home/sv/bin/python /home/loopback.py /dev/serial/by-id/usb-10c4_ea60-if00');
  assert.deepEqual(lb.stdout.trim().split('\n'), [
    'open True /dev/serial/by-id/usb-10c4_ea60-if00 115200',
    "read b'hello'",
    'lines True True False True',
    'in_waiting 3 out_waiting 0',
    'select readable True',
    'after reset_input_buffer 0',
    "read again b'again'",
    'pyserial done',
  ], `${lb.stdout}${lb.stderr}`);

  await write('/home/esp_rom.py', script('esp_rom.py'));
  const esp = await ok('/home/sv/bin/python /home/esp_rom.py /dev/ttyUSB1');
  assert.deepEqual(esp.stdout.trim().split('\n'), [
    'classic reset sync True',
    'chip magic 0xf01d83',
    'change baud 0',
    'sync at 460800 True',
    'custom speed (250000, 250000)',
    'sync at custom speed True',
    'normal reset sync False',
    'tight reset sync True',
    'mac word 0x8a3c4d5e',
    'esptool calls done',
  ], `${esp.stdout}${esp.stderr}`);

  const log = await serialLog();
  const usb0 = log.filter((l) => l.startsWith('ttyUSB0 ')).map((l) => l.slice(8));
  const usb1 = log.filter((l) => l.startsWith('ttyUSB1 ')).map((l) => l.slice(8));
  const frame = (baudRate, dataBits = 8, parity = 'none', stopBits = 1) =>
    `configure ${JSON.stringify({ baudRate, dataBits, parity, stopBits, flowControl: 'none' })}`;
  const has = (list, line, what) => assert.ok(list.includes(line), `${what}: no "${line}" in\n${list.join('\n')}`);
  has(usb0, frame(115200), 'pyserial opens at 115200');
  has(usb0, 'setSignals {"dataTerminalReady":false,"requestToSend":true}', 'dtr off, rts on');
  has(usb0, 'flush {"input":true,"output":false}', 'reset_input_buffer');
  has(usb0, 'flush {"input":false,"output":true}', 'reset_output_buffer');
  assert.ok(usb0.filter((l) => l === 'setSignals {"break":true}').length >= 2, `send_break and break_condition:\n${usb0.join('\n')}`);
  has(usb0, frame(460800), 'baudrate 460800');
  has(usb0, frame(460800, 7, 'even', 2), 'bytesize 7, parity even, two stop bits');
  has(usb0, 'close', 'close');
  const boots = usb1.filter((l) => l.startsWith('boot '));
  assert.deepEqual(boots, ['boot download', 'boot normal', 'boot download'], usb1.join('\n'));
  has(usb1, 'rom baud 460800', 'CHANGE_BAUDRATE');
  has(usb1, frame(460800), 'baudrate 460800 after CHANGE_BAUDRATE');
  has(usb1, frame(250000), 'TCSETS2 BOTHER 250000');
  console.log('serial (wasix-python, kernel.devices fake ports): pip-installed pyserial 3.5 opens /dev/ttyUSB0 through its by-id link, writes and reads back through a loopback, sets DTR/RTS, reads CTS/DSR/CD/RI, in_waiting, out_waiting, select, send_break, break_condition, reset_input/output_buffer, baud, byte size, parity and stop bits; on /dev/ttyUSB1 a fake ESP ROM loader answers esptool\'s calls: the classic and tight (TIOCMSET) DTR/RTS resets into the bootloader, SLIP SYNC, READ_REG of the chip magic, CHANGE_BAUDRATE to 460800 and a custom 250000 through TCSETS2 with BOTHER, while a reset with IO0 high boots normally and gets no answer');
}
