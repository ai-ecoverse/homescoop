export default async function ({ run, serveWs, wsLog, assert }) {
  const curl = (url, extra = []) => run(['curl', '-sS', '--max-time', '15', ...extra, url], { cwd: '/tmp' });

  const none = await curl('ws://echo.test/none');
  assert.equal(none.status, 22, `no responder: ${none.stdout}${none.stderr}`);
  assert.match(none.stderr, /Refused WebSocket upgrade: 502/);

  await serveWs(({ url, protocols, send, close }) => {
    if (url.endsWith('/refuse')) return null;
    if (url.endsWith('/raw')) {
      return {
        message(data) {
          send(typeof data === 'string' ? `echo:${data}` : data);
          if (data === 'bye') close(1000, 'done');
        },
      };
    }
    setTimeout(() => {
      send(`hello ${url}`);
      send(new Uint8Array([0x41, 0x42, 0x0a]));
      setTimeout(() => close(4000, 'bye'), 50);
    }, 50);
    return { protocol: protocols[0] || '' };
  });

  const ws = await curl('ws://echo.test/x');
  assert.equal(ws.status, 0, ws.stderr);
  assert.ok(ws.stdout.startsWith('hello ws://echo.test/xAB\n'), JSON.stringify(ws.stdout));
  assert.match(ws.stdout, /bye$/, `curl prints the close frame's reason: ${JSON.stringify(ws.stdout)}`);

  const wss = await curl('wss://echo.test/s');
  assert.equal(wss.status, 0, wss.stderr);
  assert.ok(wss.stdout.startsWith('hello wss://echo.test/sAB\n'), JSON.stringify(wss.stdout));

  const refused = await curl('ws://echo.test/refuse');
  assert.equal(refused.status, 22);
  assert.match(refused.stderr, /Refused WebSocket upgrade: 502/);

  const raw = await run(['bash', '-c', String.raw`exec 3<>/dev/tcp/127.0.0.1/3128 || exit 9
printf 'GET http://echo.test/raw HTTP/1.1\r\nHost: echo.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n' >&3
printf '\x81\x85\x37\xfa\x21\x3d\x7f\x9f\x4d\x51\x58' >&3
printf '\x81\x83\x37\xfa\x21\x3d\x55\x83\x44' >&3
timeout 5 cat <&3 | od -An -c | tr -s ' \n' ' '`], { cwd: '/tmp' });
  assert.equal(raw.status, 0, raw.stderr);
  assert.match(raw.stdout, /H T T P \/ 1 \. 1 1 0 1 S w i t c h i n g/);
  assert.match(raw.stdout.replace(/ /g, ''), /Sec-WebSocket-Accept:s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/);
  assert.match(raw.stdout.replace(/ /g, ''), /echo:Hello.*echo:bye/);

  const log = await wsLog();
  const byPath = Object.fromEntries(log.map((l) => [new URL(l.url).pathname, l]));
  assert.deepEqual(byPath['/x'].sent, ['hello ws://echo.test/x', { binary: 3 }]);
  assert.deepEqual(byPath['/x'].closed, { code: 4000, reason: 'bye' });
  assert.equal(byPath['/s'].url, 'wss://echo.test/s');
  assert.deepEqual(byPath['/raw'].received, ['Hello', 'bye']);
  assert.deepEqual(byPath['/raw'].closed, { code: 1000, reason: 'done' });
  assert.ok(byPath['/x'].headers.some(([k]) => /^sec-websocket-key$/i.test(k)), JSON.stringify(byPath['/x'].headers));
  console.log('websocket: ws:// and wss:// through the proxy reach ctx.serveWs; text, binary, close codes; refusal 502; a raw client gets RFC 6455 101 and its frames round-trip');
}
