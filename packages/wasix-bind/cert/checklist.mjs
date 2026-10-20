/**
 * wasix-bind checklist (homescoop#1282): BIND 9.20's dig, host and nslookup
 * in slicc-kernel. The cert uplink carries TCP and no UDP, as most of
 * seven's do, so every UDP query fails to send (network unreachable) and
 * the patched dighost.c asks the same server over TCP at once. The uplink's
 * 100.100.100.100:53 is a raw TCP peer answering with dnsFake (wasi-dig's
 * zone: real DNS wire messages); 100.64.9.9:53 refuses.
 */

// Self-contained: the uplink peer evaluates it from source.
function dnsFake(req) {
  const ZONE = {
    'example.test': [
      ['A', 300, '192.0.2.10'],
      ['AAAA', 300, '2001:db8::10'],
      ['MX', 3600, [10, 'mail.example.test']],
      ['MX', 3600, [20, 'mx2.example.test']],
      ['TXT', 300, ['v=spf1 -all']],
      ['TXT', 300, ['two', 'strings "quoted"']],
      ['NS', 86400, 'ns1.example.test'],
      ['SOA', 3600, ['ns1.example.test', 'hostmaster.example.test', 2026101001, 7200, 3600, 1209600, 300]],
      ['CAA', 3600, [0, 'issue', 'letsencrypt.org']],
    ],
    'www.example.test': [['CNAME', 600, 'example.test']],
    '_sip._tcp.example.test': [['SRV', 300, [0, 5, 5060, 'sip.example.test']]],
    'nss.test': [
      ['NS', 86400, '100.100.100.100'],
      ['SOA', 3600, ['ns1.nss.test', 'hostmaster.nss.test', 2026102001, 7200, 3600, 1209600, 300]],
    ],
    'nss2.test': [
      ['NS', 86400, '100.64.9.9'],
      ['NS', 86400, '100.100.100.100'],
      ['SOA', 3600, ['ns1.nss2.test', 'hostmaster.nss2.test', 2026102002, 7200, 3600, 1209600, 300]],
    ],
    '10.2.0.192.in-addr.arpa': [['PTR', 300, 'example.test']],
    'a-very-long-owner-name-for-testing.example.test': [['A', 300, '192.0.2.20']],
    // homescoop#403: HTTPS (RFC 9460) and a type nobody knows (RFC 3597).
    'https.test': [['HTTPS', 300, { hex: '00010000010003026832' }]],
    'cloudflare.test': [
      ['HTTPS', 300, { hex: '0001000001000602683302683200040008681084e5681085e500060020260647000000000000000000681084e5260647000000000000000000681085e5' }],
    ],
    'ech.test': [
      ['HTTPS', 300, { hex: '0001000001000302683200040008a29f874fa29f884f000500470045fe0d0041b0002000207e7457212c943718f88248ddf09c2951848323daa0aa293faf922b9313acec490004000100010012636c6f7564666c6172652d6563682e636f6d0000000600202606470000070000000000' + '00a29f874f260647000007000000000000a29f884f' }],
    ],
    'unknown.test': [['TYPE999', 60, { hex: '01020304' }]],
    'null.test': [['NULL', 60, { hex: '' }]],
    'emptyunknown.test': [['TYPE999', 60, { hex: '' }]],
    'emptya.test': [['A', 60, { hex: '' }]],
    'uid.test': [['UID', 60, { hex: '000003e8' }]],
    'emptykey.test': [['DNSKEY', 3600, { hex: '0101030d' }], ['DS', 3600, { hex: '09430d02' }]],
    'wrap.signed.test': [['RRSIG', 300, { hex: '00010d020000012cffffffff0000000086c90a636c6f7564666c61726503636f6d00abcd' }]],
    // homescoop#177: DNSSEC records (cloudflare.com's KSK, DS and an RRSIG,
    // ietf.org's NSEC, nic.cz's NSEC3), under a zone the fake "validates".
    'signed.test': [
      ['A', 300, '192.0.2.30'],
      ['DNSKEY', 3600, { hex: '0101030d99db2cc14cabdc33d6d77da63a2f15f71112584f234e8d1dc428e39e8a4a97e1aa271a555dc90701e17e2a4c4b6f120b7c32d44f4ac02bd894cf2d4be7778a19' }],
      ['DS', 86400, { hex: '09430d0232996839a6d808afe3eb4a795a0e6a7a39a76fc52ff228b22b76f6d63826f2b9' }],
      ['RRSIG', 300, { hex: '00010d020000012c6ad32b4a6ad06c2a86c90a636c6f7564666c61726503636f6d00e64fb2eccd95d0599ae2339d08d29aadfb231e75f9296039a378cd63ab0f866910c377f3c05e693f951d24c51805d833d6d6c098aa0ce342446c8e1becb9125c' }],
      ['NSEC3PARAM', 0, { hex: '0100000000' }],
    ],
    'nonexist.signed.test': [['NSEC', 1800, { hex: '0100086e6f6e6578697374067369676e656404746573740000110000000000030000000000000000000080' }]],
    '763un4dcc4ck4mccm0gpgd68pmclpt31.signed.test': [['NSEC3', 1800, { hex: '01000000001439bd2520728c525523f7dfd40cd0aeed2be991130006400000080002' }]],
  };
  const TAILNET = { 'host.tailnet.test': [['A', 60, '100.64.1.7']] };
  const TYPES = {
    A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, OPT: 41, CAA: 257,
    DS: 43, RRSIG: 46, NSEC: 47, DNSKEY: 48, NSEC3: 50, NSEC3PARAM: 51, HTTPS: 65, TYPE999: 999,
    NULL: 10, UID: 101,
  };
  const u16 = (n) => [(n >> 8) & 255, n & 255];
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const name = (s) => {
    const out = [];
    for (const l of s.split('.').filter(Boolean)) out.push(l.length, ...new TextEncoder().encode(l));
    return [...out, 0];
  };
  const str = (s) => {
    const b = new TextEncoder().encode(s);
    return [b.length, ...b];
  };
  const rdata = (type, d) => {
    if (d && typeof d.hex === 'string') return (d.hex.match(/../g) ?? []).map((x) => parseInt(x, 16));
    switch (type) {
      case 'A': return d.split('.').map(Number);
      case 'AAAA': {
        const [head, tail = ''] = d.split('::');
        const h = head ? head.split(':') : [];
        const t = tail ? tail.split(':') : [];
        const g = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
        return g.flatMap((x) => u16(parseInt(x, 16)));
      }
      case 'MX': return [...u16(d[0]), ...name(d[1])];
      case 'TXT': return d.flatMap(str);
      case 'SOA': return [...name(d[0]), ...name(d[1]), ...d.slice(2).flatMap(u32)];
      case 'SRV': return [...u16(d[0]), ...u16(d[1]), ...u16(d[2]), ...name(d[3])];
      case 'CAA': return [d[0], ...str(d[1]), ...new TextEncoder().encode(d[2])];
      default: return name(d);
    }
  };
  const rr = (owner, [type, ttl, d]) => {
    const rd = rdata(type, d);
    return [...name(owner), ...u16(TYPES[type]), ...u16(1), ...u32(ttl), ...u16(rd.length), ...rd];
  };
  const answer = (q, via) => {
    // Question: one name, uncompressed.
    let i = 12;
    const labels = [];
    while (q[i]) {
      labels.push(new TextDecoder().decode(q.slice(i + 1, i + 1 + q[i])));
      i += q[i] + 1;
    }
    const qname = labels.join('.').toLowerCase();
    const qtype = (q[i + 1] << 8) | q[i + 2];
    const qend = i + 5;
    const hasOpt = ((q[10] << 8) | q[11]) > 0;
    const zone = via.startsWith('tcp') ? { ...ZONE, ...TAILNET } : ZONE;
    const ans = [];
    let owner = qname;
    if (qname === 'whoami.test') ans.push(rr(owner, ['TXT', 0, [via]]));
    for (let hop = 0; hop < 4 && zone[owner]; hop++) {
      const recs = zone[owner];
      const cname = recs.find((r) => r[0] === 'CNAME');
      for (const r of recs) if (TYPES[r[0]] === qtype || r === cname) ans.push(rr(owner, r));
      if (!cname || qtype === TYPES.CNAME) break;
      owner = cname[2];
    }
    const nx = qname !== 'whoami.test' && !zone[qname];
    const auth = nx || !ans.length ? [rr('example.test', ZONE['example.test'].find((r) => r[0] === 'SOA'))] : [];
    const opt = hasOpt ? [[0, ...u16(41), ...u16(1232), ...u32(0), ...u16(0)]] : [];
    // A validating resolver: AD when the query asks for it (dig sets AD
    // by default) and the name is in the signed zone; CD echoed.
    const ad = q[3] & 0x20 && (qname === 'signed.test' || qname.endsWith('.signed.test')) ? 0x0020 : 0;
    const flags = 0x8000 | (q[2] & 1 ? 0x0100 : 0) | 0x0080 | ad | (q[3] & 0x10) | (nx ? 3 : 0);
    return new Uint8Array([
      q[0], q[1], ...u16(flags), ...u16(1), ...u16(ans.length), ...u16(auth.length), ...u16(opt.length),
      ...q.slice(12, qend), ...ans.flat(), ...auth.flat(), ...opt.flat(),
    ]);
  };
  if (req.tcp) {
    const b = req.tcp;
    if (b.length < 2 || b.length < 2 + ((b[0] << 8) | b[1])) return null;
    const a = answer(b.slice(2, 2 + ((b[0] << 8) | b[1])), `tcp ${req.peer}`);
    return new Uint8Array([...u16(a.length), ...a]);
  }
  const url = new URL(req.url);
  if (url.pathname === '/down') return { status: 503, body: 'resolver down\n' };
  // What the realm proxy answers when an endpoint refuses CORS.
  if (url.pathname === '/cors' || url.pathname === '/bad-gateway') return { status: 502, body: 'Bad Gateway\n' };
  if (url.pathname === '/html') return { headers: [['content-type', 'text/html']], body: '<p>not dns</p>' };
  const ctype = (req.headers.find(([k]) => k.toLowerCase() === 'content-type') ?? [])[1];
  if (req.method !== 'POST' || ctype !== 'application/dns-message') {
    return { status: 415, body: `want POST application/dns-message, got ${req.method} ${ctype}\n` };
  }
  return { headers: [['content-type', 'application/dns-message']], body: answer(req.body, `doh ${url.host}${url.pathname}`) };
}


export default async function (ctx) {
  const { run, assert, uplink, uplinkLog } = ctx;
  const cwd = '/home';
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;
  const cmd = async (argv, want = 0) => {
    const r = await run(argv, { cwd });
    assert.equal(r.status, want, `${argv.join(' ')}: ${out(r)}`);
    return r;
  };
  const NS = '100.100.100.100';
  await uplink({
    peers: {
      [`${NS}:53`]: { tcp: dnsFake.toString() },
      '100.64.9.9:53': { error: 'ECONNREFUSED' },
    },
  });

  assert.equal((await cmd(['dig', '-v'])).stdout, 'DiG 9.20.29\n');
  assert.equal((await cmd(['host', '-V'])).stdout, 'host 9.20.29\n');
  assert.equal((await cmd(['nslookup', '-version'])).stdout, 'nslookup 9.20.29\n');

  // UDP can't leave: dig says so once and asks over TCP, well inside one
  // +time (the unpatched dig waits out +time=5 per try, then gives up).
  const t0 = Date.now();
  const full = (await cmd(['dig', '+tries=1', `@${NS}`, 'example.test'])).stdout;
  assert.ok(Date.now() - t0 < 4000, `dig took ${Date.now() - t0} ms`);
  assert.match(full, /^;; UDP network unreachable, retrying in TCP mode\.$/m);
  assert.match(full, /^; <<>> DiG 9\.20\.29 <<>> \+tries=1 @100\.100\.100\.100 example\.test$/m);
  assert.match(full, /^;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: \d+$/m);
  assert.match(full, /^;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1$/m);
  assert.ok(full.includes(';; ANSWER SECTION:\nexample.test.\t\t300\tIN\tA\t192.0.2.10\n\n'), full);
  assert.match(full, /^;; SERVER: 100\.100\.100\.100#53\(100\.100\.100\.100\) \(TCP\)$/m);
  assert.ok((await uplinkLog()).dialled.some((d) => d.host === NS && d.port === 53), 'TCP dial to the tailnet resolver');

  // An address no uplink routes fails at UDP setup, not at send (#1370):
  // dig retries over TCP there too, at once, and reports that failure.
  const t1 = Date.now();
  const unrouted = await cmd(['dig', '+tries=1', '@192.0.2.53', 'example.test'], 9);
  assert.ok(Date.now() - t1 < 4000, `dig @192.0.2.53 took ${Date.now() - t1} ms`);
  assert.match(unrouted.stdout, /^;; UDP network unreachable, retrying in TCP mode\.$/m);
  assert.match(unrouted.stdout, /^;; Connection to 192\.0\.2\.53#53\(192\.0\.2\.53\) for example\.test failed: /m);
  assert.doesNotMatch(unrouted.stdout, /UDP setup with/);

  // +tcp asks over TCP from the start: no UDP line.
  const tcp = (await cmd(['dig', '+tcp', `@${NS}`, 'example.test'])).stdout;
  assert.doesNotMatch(tcp, /UDP/);
  assert.match(tcp, /\(TCP\)$/m);

  const t2 = Date.now();
  const nss = await cmd(['dig', '+time=2', '+tries=1', '+nssearch', `@${NS}`, 'nss.test']);
  assert.ok(Date.now() - t2 < 4000, `dig +nssearch took ${Date.now() - t2} ms`);
  assert.match(nss.stdout, /^SOA ns1\.nss\.test\. hostmaster\.nss\.test\. 2026102001 7200 3600 1209600 300 from server 100\.100\.100\.100 in \d+ ms\.$/m);
  assert.doesNotMatch(nss.stdout + nss.stderr, /timed out|no servers could be reached/);
  const nssTcp = await cmd(['dig', '+time=2', '+tries=1', '+tcp', '+nssearch', `@${NS}`, 'nss.test']);
  assert.match(nssTcp.stdout, /^SOA ns1\.nss\.test\. .* from server 100\.100\.100\.100 in \d+ ms\.$/m);
  const nss2 = await cmd(['dig', '+time=2', '+tries=1', '+nssearch', `@${NS}`, 'nss2.test']);
  assert.match(nss2.stdout, /^SOA ns1\.nss2\.test\. hostmaster\.nss2\.test\. 2026102002 7200 3600 1209600 300 from server 100\.100\.100\.100 in \d+ ms\.$/m);
  assert.match(nss2.stdout, /^;; Connection to 100\.64\.9\.9#53\(100\.64\.9\.9\) for nss2\.test failed: connection refused\.$/m);

  const short = async (...args) => (await cmd(['dig', '+short', `@${NS}`, ...args])).stdout.trimEnd().split('\n');
  assert.deepEqual(await short('example.test'), ['192.0.2.10']);
  assert.deepEqual(await short('aaaa', 'example.test'), ['2001:db8::10']);
  assert.deepEqual(await short('example.test', 'MX'), ['10 mail.example.test.', '20 mx2.example.test.']);
  assert.deepEqual(await short('-t', 'txt', 'example.test'), ['"v=spf1 -all"', '"two" "strings \\"quoted\\""']);
  assert.deepEqual(await short('www.example.test'), ['example.test.', '192.0.2.10']);
  assert.deepEqual(await short('ns', 'example.test'), ['ns1.example.test.']);
  assert.deepEqual(await short('soa', 'example.test'), ['ns1.example.test. hostmaster.example.test. 2026101001 7200 3600 1209600 300']);
  assert.deepEqual(await short('srv', '_sip._tcp.example.test'), ['0 5 5060 sip.example.test.']);
  assert.deepEqual(await short('caa', 'example.test'), ['0 issue "letsencrypt.org"']);
  assert.deepEqual(await short('-x', '192.0.2.10'), ['example.test.']);
  assert.deepEqual(await short('+nocrypto', 'dnskey', 'signed.test'), ['257 3 13 [key id = 2371]']);
  assert.deepEqual(await short('https', 'https.test'), ['1 . alpn="h2"']);
  assert.equal(
    (await cmd(['dig', '+noall', '+answer', `@${NS}`, 'mx', 'example.test'])).stdout,
    'example.test.\t\t3600\tIN\tMX\t10 mail.example.test.\nexample.test.\t\t3600\tIN\tMX\t20 mx2.example.test.\n',
  );
  const nx = (await cmd(['dig', `@${NS}`, 'nope.example.test'])).stdout;
  assert.match(nx, /status: NXDOMAIN/);
  assert.match(nx, /^;; AUTHORITY SECTION:\nexample\.test\.\t\t3600\tIN\tSOA\t/m);

  // host: A, AAAA and MX by default; -t; reverse; NXDOMAIN is rc 1.
  const server = 'Using domain server:\nName: 100.100.100.100\nAddress: 100.100.100.100#53\nAliases: \n\n';
  assert.equal(
    (await cmd(['host', 'example.test', NS])).stdout,
    `${server}example.test has address 192.0.2.10\nexample.test has IPv6 address 2001:db8::10\n` +
      'example.test mail is handled by 10 mail.example.test.\nexample.test mail is handled by 20 mx2.example.test.\n',
  );
  assert.equal(
    (await cmd(['host', '-t', 'mx', 'example.test', NS])).stdout,
    `${server}example.test mail is handled by 10 mail.example.test.\nexample.test mail is handled by 20 mx2.example.test.\n`,
  );
  assert.equal((await cmd(['host', '192.0.2.10', NS])).stdout, `${server}10.2.0.192.in-addr.arpa domain name pointer example.test.\n`);
  assert.equal((await cmd(['host', 'www.example.test', NS])).stdout.split('\n')[5], 'www.example.test is an alias for example.test.');
  assert.match((await cmd(['host', 'nope.example.test', NS], 1)).stdout, /^Host nope\.example\.test not found: 3\(NXDOMAIN\)$/m);

  // nslookup, one-shot.
  const ns = (await cmd(['nslookup', 'example.test', NS])).stdout;
  assert.match(ns, /^Server:\t\t100\.100\.100\.100\nAddress:\t100\.100\.100\.100#53\n\nNon-authoritative answer:\nName:\texample\.test\nAddress: 192\.0\.2\.10\n/m);
  assert.match((await cmd(['nslookup', '-type=mx', 'example.test', NS])).stdout, /^example\.test\tmail exchanger = 10 mail\.example\.test\.$/m);

  // nslookup, interactive on stdin.
  const session = await run(['nslookup'], { cwd, stdin: `server ${NS}\nset type=mx\nexample.test\nset type=a\nwww.example.test\nexit\n` });
  assert.equal(session.status, 0, out(session));
  assert.match(session.stdout, /^Default server: 100\.100\.100\.100\nAddress: 100\.100\.100\.100#53$/m, out(session));
  assert.match(session.stdout, /^example\.test\tmail exchanger = 20 mx2\.example\.test\.$/m, out(session));
  assert.match(session.stdout, /^www\.example\.test\tcanonical name = example\.test\.$/m, out(session));

  // Failures: a refusing server is rc 9 (dig) / 1 (host). As in BIND, a bad
  // type is a warning (rc 0) and a bad option a usage error (rc 1).
  const refused = await cmd(['dig', '+tries=1', '@100.64.9.9', 'example.test'], 9);
  assert.match(refused.stdout, /Connection to 100\.64\.9\.9#53\(100\.64\.9\.9\) for example\.test failed: connection refused\./);
  assert.match(refused.stdout, /no servers could be reached/);
  assert.match((await cmd(['host', '-W', '2', 'example.test', '100.64.9.9'], 1)).stdout, /no servers could be reached/);
  assert.equal((await cmd(['dig', '+short', `@${NS}`, '-t', 'NOPE', 'example.test'])).stderr, ';; Warning, ignoring invalid type NOPE\n');
  assert.match((await cmd(['dig', '+nosuchoption', 'example.test'], 1)).stderr, /Invalid option: \+nosuchoption/);

  // /etc/resolv.conf: no server argument. Without it BIND asks 127.0.0.1,
  // and nothing listens there; with a nameserver line it asks that.
  assert.match((await cmd(['host', '-W', '2', 'example.test'], 1)).stdout, /127\.0\.0\.1#53: connection refused/);
  await cmd(['bash', '-c', `printf 'nameserver ${NS}\\n' > /etc/resolv.conf`]);
  try {
    assert.equal((await cmd(['host', '-t', 'a', 'example.test'])).stdout, 'example.test has address 192.0.2.10\n');
    assert.deepEqual((await cmd(['dig', '+short', 'example.test'])).stdout, '192.0.2.10\n');
    assert.match((await cmd(['nslookup', 'example.test'])).stdout, /^Server:\t\t100\.100\.100\.100$/m);
  } finally {
    await cmd(['rm', '-f', '/etc/resolv.conf']);
  }
}
