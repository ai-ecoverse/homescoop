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
  };
  const TAILNET = { 'host.tailnet.test': [['A', 60, '100.64.1.7']] };
  const TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, OPT: 41, CAA: 257 };
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
    const flags = 0x8000 | (q[2] & 1 ? 0x0100 : 0) | 0x0080 | (nx ? 3 : 0);
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
}
