/**
 * homescoop#1287's stress row for websocat (4.0.0-alpha3-6): a mirror server
 * and 6 rounds of a 16 MiB binary round trip under SLICC_WASM_BACKTRACE=1.
 * websocat runs tokio's blocking threads for stdin/stdout next to the
 * runtime thread, so buffers are allocated on more than one thread while the
 * shared memory grows: V8 could trap a memset into a fresh block (stale
 * per-thread memory length, slicc-kernel#1172). The allocator refresh and
 * the initial heap (recipe.yaml wasm) must give 0 traps. Each round records
 * the client's and the server's wasm memory (VmSize from /proc/<pid>/status,
 * polled with bash builtins).
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const env = { SLICC_WASM_BACKTRACE: '1' };
  const MIB = 16;
  await write('home/ws/gen.sh', String.raw`
l='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde'
b="$l"; for i in 1 2 3 4 5 6 7 8 9 10; do b="$b$b"; done   # 63 KiB a line
for ((i = 0; i < $1 * 16; i++)); do printf '%s\n' "$b"; done
`);
  const script = String.raw`
peak() { local m=0 k v u; [ -r /proc/$1/status ] && while read -r k v u; do [ "$k" = VmSize: ] && m=$v; done < /proc/$1/status 2>/dev/null; echo $m; }
websocat --global-timeout-ms 600000 --global-timeout-force-exit -s 18090 mirror: 2>/tmp/ws-srv-err & srv=$!
sleep 1.5
bash gen.sh $MIB > /tmp/ws-in
want=$(wc -c < /tmp/ws-in)
for round in 1 2 3 4 5 6; do
  websocat -b ws://127.0.0.1:18090/ < /tmp/ws-in > /tmp/ws-out 2>/tmp/ws-err & pid=$!; m=0
  while kill -0 $pid 2>/dev/null; do v=$(peak $pid); [ "$v" -gt "$m" ] && m=$v; done
  wait $pid; rc=$?
  t=0; while IFS= read -r l; do case $l in *"wasm trap"*) t=$((t+1));; esac; done < /tmp/ws-err
  got=$(wc -c < /tmp/ws-out); read -r a _ < <(sha256sum /tmp/ws-in); read -r b _ < <(sha256sum /tmp/ws-out); [ "$a" = "$b" ] && same=1 || same=0
  echo "round=$round rc=$rc peak_kb=$m traps=$t bytes=$got/$want same=$same"
done
s=$(peak $srv); kill -0 $srv 2>/dev/null && alive=1 || alive=0
t=0; while IFS= read -r l; do case $l in *"wasm trap"*) t=$((t+1));; esac; done < /tmp/ws-srv-err
echo "server alive=$alive peak_kb=$s traps=$t"
kill $srv 2>/dev/null; wait $srv 2>/dev/null; true
`;
  const r = await run(['bash', '-c', script], { cwd: '/home/ws', env: { ...env, MIB: String(MIB) } });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stderr}`);
  const rounds = [...r.stdout.matchAll(/round=(\d+) rc=(\d+) peak_kb=(\d+) traps=(\d+) bytes=(\d+)\/(\d+) same=(\d)/g)];
  assert.equal(rounds.length, 6, `six rounds: ${r.stdout}`);
  let traps = 0;
  let peak = 0;
  for (const [line, round, rc, kb, t, got, want, same] of rounds) {
    traps += Number(t);
    peak = Math.max(peak, Number(kb));
    assert.equal(Number(rc), 0, `round ${round}: ${line}`);
    assert.ok(Number(want) > (MIB - 1) * 1024 * 1024 && got === want && same === '1', `round ${round}: a byte-equal round trip: ${line}`);
  }
  const srv = /server alive=(\d) peak_kb=(\d+) traps=(\d+)/.exec(r.stdout) ?? [];
  assert.equal(srv[1], '1', `the server is still serving: ${r.stdout}`);
  traps += Number(srv[3] ?? 1);
  peak = Math.max(peak, Number(srv[2] ?? 0));
  console.log(`stress: 6 × ${MIB} MiB websocat round trip: ${traps} traps, client and server peak ${Math.round(peak / 1024)} MiB`);
  console.log(`stress: ${r.stdout.trim().split('\n').map((l) => l.replace(/ bytes=.*/, '')).join('; ')}`);
  assert.equal(traps, 0, 'no wasm trap in the client or the server');
  const limit = Number(process.env.WEBSOCAT_INITIAL_MIB || 128) * 1024;
  assert.ok(peak > 0 && peak <= limit, `the wasm memory stays within the initial heap (peak ${peak} kB, limit ${limit} kB)`);
}
