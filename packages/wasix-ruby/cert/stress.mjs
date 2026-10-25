import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const recipe = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'recipe.yaml'), 'utf8');
const MIB = 1024 * 1024;
const keptMiB = (n, per) => Math.floor((n * Array.from({ length: per }, (_, i) => MIB + 4096 + String(i).length).reduce((a, b) => a + b, 0)) / MIB);

const THREADS = String.raw`n = Integer(ARGV[0]); per = Integer(ARGV[1])
chunk = "abcdefgh" * 8192
results = Queue.new
n.times.map do |t|
  Thread.new do
    kept = []
    per.times do |i|
      blk = chunk * 16
      own = blk.dup
      own.setbyte(0, 65 + t)
      kept << own + own.byteslice(0, 4096) + i.to_s
      Thread.pass
    end
    good = kept.each_with_index.count { |k, i| k.bytesize == 1048576 + 4096 + i.to_s.bytesize && k.getbyte(0) == 65 + t && k.getbyte(1048576) == 65 + t && k.byteslice(8, 8) == "abcdefgh" && k.end_with?(i.to_s) }
    results << [t, good, kept.sum(&:bytesize)]
  end
end.each(&:join)
rows = n.times.map { results.pop }.sort
bad = rows.reject { |t, good, _| good == per }
puts "threads=#{n} per=#{per} mib=#{rows.sum { |r| r[2] } / 1048576} bad=#{bad.size}"
`;

const STDLIB = String.raw`%w[json yaml openssl set net/http erb digest zlib socket date time fileutils tempfile optparse pp ripper securerandom stringio strscan].each { |l| require l }
data = (1..20000).map { |i| { "id" => i, "name" => "item #{i}", "tags" => %w[a b c], "at" => Time.at(i).utc.iso8601 } }
j = JSON.generate(data)
y = data.first(3000).to_yaml
z = Zlib::Deflate.deflate(j)
ok = JSON.parse(j).size == 20000 && YAML.safe_load(y).size == 3000 && Zlib::Inflate.inflate(z) == j && OpenSSL::Digest::SHA256.hexdigest(j) == Digest::SHA256.hexdigest(j)
objs = Array.new(200000) { |i| [i, i.to_s] }
GC.start
puts "stdlib ok=#{ok} objs=#{objs.size} json=#{j.bytesize}"
`;

const SPEC = `Gem::Specification.new do |s|
  s.name = "heapgem"
  s.version = "0.1"
  s.summary = "h"
  s.authors = ["a"]
  s.files = ["lib/heapgem.rb"]
end
`;

function poll(name, cmd, measure) {
  return [
    `rm -f /tmp/rbs/${name}.peak /tmp/rbs/${name}.out /tmp/rbs/${name}.err`,
    `(export SLICC_WASM_BACKTRACE=1${measure ? ` HOMESCOOP_WASM_PEAK=/tmp/rbs/${name}.peak` : ''}; ${cmd}) >/tmp/rbs/${name}.out 2>/tmp/rbs/${name}.err & pid=$!; m=0`,
    'while kill -0 $pid 2>/dev/null; do',
    '  for s in /proc/[0-9]*/status; do n=; while read -r k v u; do case $k in Name:) n=$v;; VmSize:) case $n in ruby|gem|ri|irb|bundle) [ "$v" -gt "$m" ] && m=$v;; esac;; esac; done < $s 2>/dev/null; done',
    'done; wait $pid; rc=$?',
    `t=0; while IFS= read -r l; do case $l in *"wasm trap"*|*"out of bounds"*|*RuntimeError*) t=$((t+1));; esac; done < /tmp/rbs/${name}.err`,
    `pk=; [ -s /tmp/rbs/${name}.peak ] && read -r pk < /tmp/rbs/${name}.peak`,
    `echo "${name} rc=$rc vm_kb=$m traps=$t peak=$pk"; [ $rc = 0 ] || tail -5 /tmp/rbs/${name}.err`,
  ].join('\n');
}

export default async function stress(ctx) {
  const { run, write, assert } = ctx;
  const measure = process.env.WASIX_RUBY_HEAP_MEASURE === '1';
  const initialMiB = Number(/^wasm:\n(?:  .*\n)*?  initial-memory: (\d+)MiB$/m.exec(recipe)?.[1]);
  if (!measure) assert.ok(initialMiB > 0, 'recipe.yaml has wasm.initial-memory in MiB (homescoop#1881)');
  const growPer = Math.ceil(((measure ? 64 : initialMiB) + 64) / 8);
  await write('/tmp/rbs/threads.rb', THREADS);
  await write('/tmp/rbs/stdlib.rb', STDLIB);
  await write('/tmp/rbs/gem/heapgem.gemspec', SPEC);
  await write('/tmp/rbs/gem/lib/heapgem.rb', 'module Heapgem; end\n');
  const built = await run(['bash', '-c', 'cd /tmp/rbs/gem && rm -f heapgem-0.1.gem && gem build heapgem.gemspec'], { cwd: '/tmp' });
  assert.equal(built.status, 0, `gem build: ${built.stdout}${built.stderr}`);
  const typical = {
    boot: 'ruby -e \'puts RUBY_VERSION\'',
    stdlib: 'ruby /tmp/rbs/stdlib.rb',
    gem: 'gem install --local /tmp/rbs/gem/heapgem-0.1.gem',
    ri: "ri -T -f rdoc 'String#upcase'",
    irb: "printf 'x = (1..1000).map { _1 * 2 }.sum\\nputs x\\n' | irb -f --noprompt",
  };
  const want = {
    boot: /^3\.4\.11$/m,
    stdlib: /^stdlib ok=true objs=200000 json=\d+$/m,
    gem: /^Successfully installed heapgem-0\.1$/m,
    ri: /^= String#upcase$/m,
    irb: /^1001000$/m,
  };
  const rounds = measure ? 2 : 3;
  const stats = {};
  let traps = 0;
  const one = async (round, name, cmd, re) => {
    const r = await run(['bash', '-c', `mkdir -p /tmp/rbs; ${poll(name, cmd, measure)}`], { cwd: '/tmp' });
    const m = new RegExp(`^${name} rc=(\\d+) vm_kb=(\\d+) traps=(\\d+) peak=(\\d*) ?(\\d*)$`, 'm').exec(r.stdout) ?? [];
    assert.equal(Number(m[1]), 0, `round ${round} ${name}: ${r.stdout} ${r.stderr}`);
    traps += Number(m[3] ?? 1);
    const out = await run(['cat', `/tmp/rbs/${name}.out`]);
    assert.match(out.stdout, re, `round ${round} ${name}: ${out.stdout.slice(0, 600)}`);
    const s = (stats[name] ??= { vm: 0, heap: 0, mem: 0 });
    s.vm = Math.max(s.vm, Number(m[2] || 0));
    s.heap = Math.max(s.heap, Number(m[4] || 0));
    s.mem = Math.max(s.mem, Number(m[5] || 0));
  };
  for (let round = 1; round <= rounds; round++) {
    for (const [name, cmd] of Object.entries(typical)) await one(round, name, cmd, want[name]);
    await one(round, 'grow', `ruby /tmp/rbs/threads.rb 8 ${growPer}`, new RegExp(`^threads=8 per=${growPer} mib=${keptMiB(8, growPer)} bad=0$`, 'm'));
  }
  const mib = (b) => Math.round((b / MIB) * 10) / 10;
  console.log(`stress: ${rounds} × (${Object.keys(typical).join(', ')}, and 8 threads keeping ${8 * growPer} MiB of copied 1 MiB strings): ${traps} traps; VmSize peak MiB ${JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, mib(v.vm * 1024)])))}; malloc heap end/memory MiB ${JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, `${mib(v.heap)}/${mib(v.mem)}`])))}`);
  assert.equal(traps, 0, 'no wasm trap (homescoop#1287, slicc-kernel#1172)');
  const loaded = await run(['ruby', '-e', 'require "heapgem"; p Heapgem'], { cwd: '/tmp' });
  assert.equal(loaded.stdout, 'Heapgem\n', `the installed gem loads: ${loaded.stdout}${loaded.stderr}`);
  if (measure) return;
  const boot = stats.boot.vm;
  const initialKb = initialMiB * 1024;
  assert.ok(boot > initialKb && boot - initialKb <= 32 * 1024, `boot: ruby links the ${initialMiB} MiB initial heap (recipe.yaml wasm) and its startup mmap regions add at most 32 MiB above it (wasi-emulated-mman maps with sbrk): VmSize ${boot} kB`);
  for (const name of Object.keys(typical)) {
    assert.equal(stats[name].vm, boot, `${name}: after startup the memory never grows, malloc stays in the ${initialMiB} MiB initial heap (wasix-sysroot -40's dlmalloc uses the initial pages; homescoop#1881, #1287): VmSize peak ${stats[name].vm} kB, ruby -e ${boot} kB`);
  }
  assert.ok(stats.grow.vm > boot + 32 * 1024, `grow: 8 threads keeping ${8 * growPer} MiB grow the memory past the initial heap while they copy, with no trap: VmSize peak ${stats.grow.vm} kB, ruby -e ${boot} kB`);
}
