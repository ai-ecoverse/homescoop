export function fakePorts({ path }) {
  const log = (line) => window.certSerialLog.push(`${path.replace(/^\/dev\//, '')} ${line}`);
  let feed;
  const readable = new ReadableStream({
    type: 'bytes',
    start(c) {
      feed = c;
    },
  });
  const send = (bytes) => feed.enqueue(new Uint8Array(bytes));
  const rom = {
    dtr: true,
    rts: true,
    mode: 'off',
    buf: [],
    frame: null,
    esc: false,
  };
  const slip = (body) => {
    const out = [0xc0];
    for (const b of body) {
      if (b === 0xc0) out.push(0xdb, 0xdc);
      else if (b === 0xdb) out.push(0xdb, 0xdd);
      else out.push(b);
    }
    out.push(0xc0);
    return out;
  };
  const reply = (op, value, data = []) => {
    const status = [0, 0, 0, 0];
    const body = [...data, ...status];
    const head = [0x01, op, body.length & 0xff, body.length >> 8, value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24];
    send(slip([...head, ...body]));
  };
  const u32 = (a, i) => (a[i] | (a[i + 1] << 8) | (a[i + 2] << 16) | (a[i + 3] << 24)) >>> 0;
  const command = (pkt) => {
    if (pkt.length < 8 || pkt[0] !== 0x00) return;
    const op = pkt[1];
    const data = pkt.slice(8);
    log(`cmd 0x${op.toString(16).padStart(2, '0')}`);
    if (rom.mode !== 'download') return;
    if (op === 0x08) {
      for (let i = 0; i < 8; i++) reply(0x08, 0);
    } else if (op === 0x0a) {
      const addr = u32(data, 0);
      reply(0x0a, addr === 0x40001000 ? 0x00f01d83 : addr === 0x3ff5a004 ? 0x8a3c4d5e : 0);
    } else if (op === 0x0f) {
      log(`rom baud ${u32(data, 0)}`);
      reply(0x0f, 0);
    } else {
      reply(op, 0);
    }
  };
  const romBytes = (bytes) => {
    for (const b of bytes) {
      if (b === 0xc0) {
        if (rom.frame && rom.frame.length) command(rom.frame);
        rom.frame = [];
        rom.esc = false;
      } else if (rom.frame) {
        if (rom.esc) {
          rom.frame.push(b === 0xdc ? 0xc0 : b === 0xdd ? 0xdb : b);
          rom.esc = false;
        } else if (b === 0xdb) rom.esc = true;
        else rom.frame.push(b);
      }
    }
  };
  const isRom = path.endsWith('ttyUSB1');
  const writable = new WritableStream({
    write(chunk) {
      const bytes = new Uint8Array(chunk);
      if (isRom) romBytes(bytes);
      else send(bytes);
    },
  });
  const control = (op, args) => {
    if (op === 'signals') return { clearToSend: true, dataSetReady: true, dataCarrierDetect: false, ringIndicator: true };
    log(args === undefined ? op : `${op} ${JSON.stringify(args)}`);
    if (isRom && op === 'setSignals' && args.break === undefined) {
      const wasReset = rom.rts;
      if (args.dataTerminalReady !== undefined) rom.dtr = args.dataTerminalReady;
      if (args.requestToSend !== undefined) rom.rts = args.requestToSend;
      if (wasReset && !rom.rts) {
        rom.mode = rom.dtr ? 'download' : 'normal';
        rom.frame = null;
        log(`boot ${rom.mode}`);
      }
    }
    return undefined;
  };
  return { readable, writable, control };
}
