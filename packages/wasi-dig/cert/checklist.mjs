/**
 * wasi-dig checklist (homescoop#101). slicc's kernel has no UDP: dig asks
 * over DNS over HTTPS through the realm proxy (ctx.serve answers as the
 * DoH endpoint) or over DNS over TCP to @server (a tailnet resolver: the
 * uplink's 100.100.100.100:53 is a raw TCP peer). Both are answered by
 * dnsFake, which encodes real DNS wire messages from the zone inside it.
 */

// Self-contained: ctx.serve and the uplink peer evaluate it from source.
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
  const { run, assert, serve, uplink } = ctx;
  const cwd = '/home';
  const dig = (args, opts = {}) => run(['dig', ...args], { cwd, ...opts });
  const ok = async (args, opts) => {
    const r = await dig(args, opts);
    assert.equal(r.status, 0, `dig ${args.join(' ')}: rc=${r.status} stderr=${r.stderr}`);
    return r.stdout;
  };
  await serve(dnsFake);
  await uplink({
    peers: {
      '100.100.100.100:53': { tcp: dnsFake.toString() },
      '100.64.9.9:53': { error: 'ECONNREFUSED' },
    },
  });

  assert.match(await ok(['-v']), /^DiG 0\.1\.0 \(wasi-dig/);
  assert.match(await ok(['-h']), /Usage: {2}dig \[@server\]/);

  // Full output, DoH to the default endpoint through the realm proxy.
  const full = await ok(['example.test']);
  assert.match(full, /^; <<>> DiG 0\.1\.0 \(wasi-dig\) <<>> example\.test$/m);
  assert.match(full, /^;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 0$/m);
  assert.match(full, /^;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1$/m);
  assert.match(full, /^; EDNS: version: 0, flags:; udp: 1232$/m);
  assert.ok(full.includes(';; QUESTION SECTION:\n;example.test.\t\t\tIN\tA\n\n'), full);
  assert.ok(full.includes(';; ANSWER SECTION:\nexample.test.\t\t300\tIN\tA\t192.0.2.10\n\n'), full);
  assert.match(full, /^;; SERVER: https:\/\/cloudflare-dns\.com\/dns-query \(HTTPS\)$/m);
  assert.match(full, /^;; MSG SIZE {2}rcvd: \d+$/m);

  // Record types, +short.
  const short = async (...args) => (await ok(['+short', ...args])).trimEnd().split('\n');
  assert.deepEqual(await short('aaaa', 'example.test'), ['2001:db8::10']);
  assert.deepEqual(await short('example.test', 'MX'), ['10 mail.example.test.', '20 mx2.example.test.']);
  assert.deepEqual(await short('-t', 'txt', 'example.test'), ['"v=spf1 -all"', '"two" "strings \\"quoted\\""']);
  assert.deepEqual(await short('www.example.test'), ['example.test.', '192.0.2.10']);
  assert.deepEqual(await short('www.example.test', 'cname'), ['example.test.']);
  assert.deepEqual(await short('ns', 'example.test'), ['ns1.example.test.']);
  assert.deepEqual(await short('soa', 'example.test'), [
    'ns1.example.test. hostmaster.example.test. 2026101001 7200 3600 1209600 300',
  ]);
  assert.deepEqual(await short('srv', '_sip._tcp.example.test'), ['0 5 5060 sip.example.test.']);
  assert.deepEqual(await short('caa', 'example.test'), ['0 issue "letsencrypt.org"']);
  assert.deepEqual(await short('-x', '192.0.2.10'), ['example.test.']);

  // +noall +answer: just the records.
  assert.equal(
    await ok(['+noall', '+answer', 'mx', 'example.test']),
    'example.test.\t\t3600\tIN\tMX\t10 mail.example.test.\nexample.test.\t\t3600\tIN\tMX\t20 mx2.example.test.\n',
  );

  // NXDOMAIN: rc 0, the SOA in AUTHORITY, nothing for +short.
  const nx = await ok(['nope.example.test']);
  assert.match(nx, /status: NXDOMAIN/);
  assert.match(nx, /;; AUTHORITY SECTION:\nexample\.test\.\t\t3600\tIN\tSOA\tns1\.example\.test\. /);
  assert.equal(await ok(['+short', 'nope.example.test']), '');

  // Which endpoint answered: the default, @https://…, DIG_DOH_URL.
  assert.deepEqual(await short('whoami.test', 'txt'), ['"doh cloudflare-dns.com/dns-query"']);
  assert.deepEqual(await short('@https://doh.test/q', 'whoami.test', 'txt'), ['"doh doh.test/q"']);
  assert.deepEqual(await short('+https=https://alt.test/dns', 'whoami.test', 'txt'), ['"doh alt.test/dns"']);
  const env = await run(['bash', '-c', 'DIG_DOH_URL=https://env.test/dq dig +short whoami.test txt'], { cwd });
  assert.equal(env.stdout, '"doh env.test/dq"\n', `DIG_DOH_URL stderr=${env.stderr}`);

  // DNS over TCP to a tailnet resolver through the uplink.
  const tcp = await ok(['@100.100.100.100', 'host.tailnet.test']);
  assert.ok(tcp.includes('host.tailnet.test.\t60\tIN\tA\t100.64.1.7\n'), tcp);
  assert.match(tcp, /^;; SERVER: 100\.100\.100\.100#53\(100\.100\.100\.100\) \(TCP\)$/m);
  assert.match(tcp, /^;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: \d+$/m);
  assert.deepEqual(await short('@100.100.100.100', 'whoami.test', 'txt'), ['"tcp 100.100.100.100:53"']);
  // The tailnet name is only in the tailnet resolver's zone.
  assert.match(await ok(['host.tailnet.test']), /status: NXDOMAIN/);
  const log = await ctx.uplinkLog();
  assert.ok(log.dialled.some((d) => d.host === '100.100.100.100' && d.port === 53), JSON.stringify(log.dialled));

  // Failures: rc 9 when no server answers, rc 1 for usage.
  const refused = await dig(['@100.64.9.9', '+tries=1', 'example.test']);
  assert.equal(refused.status, 9, `refused rc=${refused.status}`);
  assert.match(refused.stderr, /communications error to 100\.64\.9\.9#53: .*refused/i);
  assert.match(refused.stderr, /no servers could be reached/);
  const down = await dig(['@https://doh.test/down', '+tries=1', 'example.test']);
  assert.equal(down.status, 9);
  assert.match(down.stderr, /HTTP 503 from https:\/\/doh\.test\/down/);
  const html = await dig(['@https://doh.test/html', '+tries=1', 'example.test']);
  assert.equal(html.status, 9);
  assert.match(html.stderr, /Content-Type 'text\/html'/);
  const udp = await dig(['+notcp', 'example.test']);
  assert.equal(udp.status, 1);
  assert.match(udp.stderr, /no UDP/);
  const badType = await dig(['-t', 'BOGUS', 'example.test']);
  assert.equal(badType.status, 1);
  assert.match(badType.stderr, /invalid type: BOGUS/);
  // A browser embedder: a DoH endpoint without CORS comes back as 502.
  const cors = await dig(['@https://doh.test/cors', '+tries=1', 'example.test']);
  assert.equal(cors.status, 9);
  assert.match(cors.stderr, /HTTP 502 from https:\/\/doh\.test\/cors \(the DoH endpoint may be offline, or may not allow cross-origin requests from a browser; cloudflare-dns\.com does\)/);
  for (const url of ['https://cloudflare-dns.com/bad-gateway', 'https://1.1.1.1/bad-gateway']) {
    const r = await run(['bash', '-c', `DIG_DOH_URL=${url} dig +tries=1 example.test`], { cwd });
    assert.equal(r.status, 9, `${url}: rc=${r.status}`);
    assert.ok(r.stderr.includes(`HTTP 502 from ${url} (the network or the proxy failed)`), `${url}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /cross-origin/, `${url}: no CORS hint for an endpoint that allows CORS`);
  }

  // homescoop#177: the AD flag. dig sets AD in its queries, so a validating
  // resolver says `ad`; +noadflag clears it; +cdflag sets CD.
  const flags = async (...args) => /^;; flags: ([a-z ]+);/m.exec(await ok(args))?.[1];
  assert.equal(await flags('signed.test'), 'qr rd ra ad');
  assert.equal(await flags('+noadflag', 'signed.test'), 'qr rd ra');
  assert.equal(await flags('+cdflag', 'signed.test'), 'qr rd ra ad cd');
  assert.equal(await flags('example.test'), 'qr rd ra');

  // homescoop#177: BIND's columns when the owner is wider than one.
  assert.equal(
    await ok(['+noall', '+answer', 'a-very-long-owner-name-for-testing.example.test']),
    'a-very-long-owner-name-for-testing.example.test. 300 IN\tA 192.0.2.20\n',
  );
  assert.equal(
    await ok(['+noall', '+question', 'a-very-long-owner-name-for-testing.example.test']),
    ';a-very-long-owner-name-for-testing.example.test. IN A\n',
  );

  // homescoop#177: DNSSEC records in RFC 4034 / 5155 presentation format,
  // as BIND prints them (base64 and hex in 56-character words).
  assert.deepEqual(await short('dnskey', 'signed.test'), [
    '257 3 13 mdsswUyr3DPW132mOi8V9xESWE8jTo0dxCjjnopKl+GqJxpVXckHAeF+ KkxLbxILfDLUT0rAK9iUzy1L53eKGQ==',
  ]);
  assert.deepEqual(await short('+nocrypto', 'dnskey', 'signed.test'), ['257 3 13 [key id = 2371]']);
  assert.deepEqual(await short('ds', 'signed.test'), [
    '2371 13 2 32996839A6D808AFE3EB4A795A0E6A7A39A76FC52FF228B22B76F6D6 3826F2B9',
  ]);
  assert.deepEqual(await short('rrsig', 'signed.test'), [
    'A 13 2 300 20261017080114 20261015060114 34505 cloudflare.com. 5k+y7M2V0Fma4jOdCNKarfsjHnX5KWA5o3jNY6sPhmkQw3fzwF5pP5Ud JMUYBdgz1tbAmKoM40JEbI4b7LkSXA==',
  ]);
  assert.deepEqual(await short('+nocrypto', 'rrsig', 'signed.test'), [
    'A 13 2 300 20261017080114 20261015060114 34505 cloudflare.com. [omitted]',
  ]);
  assert.deepEqual(await short('nsec', 'nonexist.signed.test'), ['\\000.nonexist.signed.test. RRSIG NSEC TYPE128']);
  assert.deepEqual(await short('nsec3param', 'signed.test'), ['1 0 0 -']);
  assert.equal(
    await ok(['+noall', '+answer', 'nsec3', '763un4dcc4ck4mccm0gpgd68pmclpt31.signed.test']),
    '763un4dcc4ck4mccm0gpgd68pmclpt31.signed.test. 1800 IN NSEC3 1 0 0 - 76UIA83IHH95A8VNRVA0PK5ETKLUJ48J A AAAA RRSIG\n',
  );
  assert.equal(
    await ok(['+noall', '+answer', 'dnskey', 'signed.test']),
    'signed.test.\t\t3600\tIN\tDNSKEY\t257 3 13 mdsswUyr3DPW132mOi8V9xESWE8jTo0dxCjjnopKl+GqJxpVXckHAeF+ KkxLbxILfDLUT0rAK9iUzy1L53eKGQ==\n',
  );

  // homescoop#403: HTTPS in BIND's format, unknown types as RFC 3597.
  assert.deepEqual(await short('-t', 'HTTPS', 'https.test'), ['1 . alpn="h2"']);
  assert.equal(
    await ok(['+noall', '+answer', 'https', 'cloudflare.test']),
    'cloudflare.test.\t300\tIN\tHTTPS\t1 . alpn="h3,h2" ipv4hint=104.16.132.229,104.16.133.229 ipv6hint=2606:4700::6810:84e5,2606:4700::6810:85e5\n',
  );
  assert.deepEqual(await short('https', 'ech.test'), [
    '1 . alpn="h2" ipv4hint=162.159.135.79,162.159.136.79 ech=AEX+DQBBsAAgACB+dFchLJQ3GPiCSN3wnClRhIMj2qCqKT+vkiuTE6zsSQAEAAEAAQASY2xvdWRmbGFyZS1lY2guY29tAAA= ipv6hint=2606:4700:7::a29f:874f,2606:4700:7::a29f:884f',
  ]);
  assert.deepEqual(await short('-t', 'TYPE999', 'unknown.test'), ['\\# 4 01020304']);
  assert.deepEqual(await short('-t', 'NULL', 'null.test'), ['\\# 0']);
  assert.equal(await ok(['+noall', '+answer', '-t', 'NULL', 'null.test']), 'null.test.\t\t60\tIN\tNULL\t\\# 0\n');
  assert.deepEqual(await short('-t', 'TYPE999', 'emptyunknown.test'), ['\\# 0']);
  const emptyA = await dig(['+tries=1', 'emptya.test']);
  assert.equal(emptyA.status, 9, `an empty A record is a bad packet: rc=${emptyA.status}`);
  assert.match(emptyA.stderr, /Got bad packet: unexpected record with length 0/);
  assert.deepEqual(await short('dnskey', 'emptykey.test'), ['257 3 13']);
  assert.deepEqual(await short('ds', 'emptykey.test'), ['2371 13 2']);
  assert.equal(await ok(['+noall', '+answer', 'dnskey', 'emptykey.test']), 'emptykey.test.\t\t3600\tIN\tDNSKEY\t257 3 13\n');
  assert.equal(await ok(['+noall', '+answer', 'ds', 'emptykey.test']), 'emptykey.test.\t\t3600\tIN\tDS\t2371 13 2\n');
  assert.deepEqual(await short('-t', 'UID', 'uid.test'), ['\\# 4 000003E8']);
  assert.ok((await ok(['+noall', '+answer', '-t', 'uid', 'uid.test'])).includes('\tIN\tUID\t'), 'UID mnemonic');
  assert.deepEqual(await short('rrsig', 'wrap.signed.test'), [
    'A 13 2 300 19691231235959 19700101000000 34505 cloudflare.com. q80=',
  ]);
  const unknown = await ok(['-t', 'TYPE999', 'unknown.test']);
  assert.ok(unknown.includes(';; QUESTION SECTION:\n;unknown.test.\t\t\tIN\tTYPE999\n'), unknown);
  assert.ok(unknown.includes(';; ANSWER SECTION:\nunknown.test.\t\t60\tIN\tTYPE999\t\\# 4 01020304\n'), unknown);
}
