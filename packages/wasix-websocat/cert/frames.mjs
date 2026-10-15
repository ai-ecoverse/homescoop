export default async function frames(ctx) {
  const { assert } = ctx;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  ctx.run(['websocat', '--global-timeout-ms', '30000', '--global-timeout-force-exit', '-s', '18090', 'mirror:'], { cwd: '/home' }).catch(() => {});
  await sleep(1500);
  const upgrade = 'GET / HTTP/1.1\\r\\nHost: x\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n';
  const raw = async (frame) => {
    const r = await Promise.race([sleep(20000).then(() => ({ status: 'no exit within 20000 ms', stdout: '', stderr: '' })), ctx.run(['bash', '-c', `printf '${upgrade}${frame}' | websocat -b --global-timeout-ms 2000 --global-timeout-force-exit tcp:127.0.0.1:18090 | od -An -tx1 -v`], { cwd: '/home' })]);
    assert.equal(r.status, 0, r.stderr);
    const hex = r.stdout.replace(/\s+/g, ' ').trim();
    const http = Buffer.from(hex.split(' ').map((h) => parseInt(h, 16))).toString('latin1');
    const end = http.indexOf('\r\n\r\n');
    assert.ok(end > 0, `an HTTP response: ${http.slice(0, 200)}`);
    return { head: http.slice(0, end), frames: hex.split(' ').slice(end + 4).join(' ') };
  };
  const ping = await raw('\\x89\\x84\\x00\\x00\\x00\\x00ping');
  assert.match(ping.head, /^HTTP\/1\.1 101 /);
  assert.match(ping.head, /\r\nsec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/i, 'RFC 6455 accept key');
  assert.match(ping.frames, /^8a 04 70 69 6e 67\b/, `a pong with the ping's payload: ${ping.frames}`);
  const close = await raw('\\x88\\x82\\x00\\x00\\x00\\x00\\x0f\\xa0');
  assert.equal(close.frames, '88 02 0f a0', 'close 4000 is echoed');
  const text = await raw('\\x81\\x82\\x00\\x00\\x00\\x00hi\\x88\\x82\\x00\\x00\\x00\\x00\\x03\\xe8');
  assert.equal(text.frames, '81 02 68 69 88 02 03 e8', 'text, then close 1000, in order');
}
