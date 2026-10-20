/**
 * The package records its inputs by version, not build path (3.4.11-20,
 * homescoop#637, #1045). Up to 3.4.11-19 package.json's homescoop.openssl
 * was the CI runner's prefix, /home/runner/work/…/deps/wasix-openssl/package.
 */
const CODE = String.raw`
require "json"; require "openssl"; require "zlib"
pkg = File.expand_path("../..", RbConfig::CONFIG["bindir"] + "/x")
j = JSON.parse(File.read(File.join(pkg, "package.json")))
n = File.read(File.join(pkg, "THIRD-PARTY-NOTICES.md"))
strs = []
walk = ->(v) { case v when Hash then v.each_value { |x| walk.(x) } when Array then v.each { |x| walk.(x) } when String then strs << v end }
walk.(j)
bad = strs.grep(%r{/home/|/Users/|/tmp/|/__w/|/private/})
puts "openssl=" + j.dig("homescoop", "openssl").to_s[/\A[^;]*/]
puts "notices-openssl=" + n[/^## OpenSSL \S+ \(@ai-ecoverse\/wasix-openssl \S+\)/].to_s
puts "lib=" + OpenSSL::OPENSSL_LIBRARY_VERSION
puts "notices-zlib=" + n[/^## zlib \S+ \(@ai-ecoverse\/wasix-zlib \S+\)/].to_s
puts "zlib=" + Zlib::ZLIB_VERSION
puts "paths=" + bad.size.to_s + (bad.empty? ? "" : " " + bad.map { |s| s[0, 120] }.join(" ; "))
rb = RbConfig::CONFIG.select { |k, v| v.is_a?(String) && v.match?(%r{/home/|/Users/|/tmp/|/__w/|/private/|/work/}) }
puts "rbconfig=" + rb.size.to_s + (rb.empty? ? "" : " " + rb.map { |k, v| k + "=" + v[0, 120] }.join(" ; "))
puts "build=" + RbConfig::CONFIG["configure_args"][/--with-libyaml-dir=(\S+?)'/, 1].to_s
`;

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['ruby', '-e', CODE], { cwd: '/tmp' });
  const out = `rc=${r.status}\n${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  const get = (k) => new RegExp(`^${k}=(.*)$`, 'm').exec(r.stdout)?.[1] ?? '';
  const rec = /^linked against @ai-ecoverse\/wasix-openssl (\S+) \(OpenSSL (\S+)$/.exec(get('openssl'));
  assert.ok(rec, `homescoop.openssl names the wasix-openssl version and its OpenSSL (3.4.11-19: the runner's build path):\n${out}`);
  const not = /^## OpenSSL (\S+) \(@ai-ecoverse\/wasix-openssl (\S+)\)$/.exec(get('notices-openssl'));
  assert.ok(not, `THIRD-PARTY-NOTICES.md has an OpenSSL heading:\n${out}`);
  if (rec && not) {
    assert.equal(rec[1], not[2], `homescoop.openssl's wasix-openssl is the notices' one:\n${out}`);
    assert.equal(rec[2], not[1], `homescoop.openssl's OpenSSL is the notices' one:\n${out}`);
    assert.match(get('lib'), new RegExp(`^OpenSSL ${not[1].replace(/\./g, '\\.')}\\b`), `OPENSSL_LIBRARY_VERSION is the notices' OpenSSL:\n${out}`);
  }
  const z = /^## zlib (\S+) \(@ai-ecoverse\/wasix-zlib \S+\)$/.exec(get('notices-zlib'));
  assert.ok(z, `THIRD-PARTY-NOTICES.md has a zlib heading:\n${out}`);
  if (z) assert.equal(get('zlib'), z[1], `Zlib::ZLIB_VERSION is the notices' zlib:\n${out}`);
  assert.equal(get('paths'), '0', `no build path in package.json:\n${out}`);
  assert.equal(get('rbconfig'), '0', `no build path in RbConfig::CONFIG (homescoop#1114; 3.4.11-20: 9 lines with /home/runner/work/...):\n${out}`);
  assert.equal(get('build'), '/nonexistent-ruby-build/yaml-prefix', `the build tree is named /nonexistent-ruby-build in rbconfig.rb:\n${out}`);
  console.log(`package-meta: ${r.stdout.trim().replace(/\n/g, ' | ')}`);
}
