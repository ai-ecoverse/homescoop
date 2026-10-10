/**
 * wasix-ruby checklist: version and platform, core numerics and sprintf,
 * the statically linked C extensions (zlib, openssl, psych/libyaml, json,
 * socket, etc), Process spawn (posix_spawn), Fiber, Thread, gem.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/ruby-cert';
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  const rb = async (code, opts = {}) => {
    const r = await run(['ruby', '-e', code], { cwd, ...opts });
    assert.equal(r.status, 0, `ruby -e ${code}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    return r.stdout;
  };

  const v = await run(['ruby', '-v'], { cwd });
  assert.match(v.stdout, /^ruby 3\.4\.11 .*\[wasm32-wasi\]$/m, v.stdout + v.stderr);
  assert.equal(await rb('puts RUBY_PLATFORM, [1, 2, 3].sum, 2**64, 7.0 / 2'), 'wasm32-wasi\n6\n18446744073709551616\n3.5\n');
  assert.equal(await rb('puts format("%d|%x|%o|%5.2f|%-4s|%e", 2**62, 2**40, 8, 3.14159, "ab", 12345.678)'),
    '4611686018427387904|10000000000|10| 3.14|ab  |1.234568e+04\n');
  assert.equal(await rb('p [1, -2, 2**33].pack("q<l<Q>").unpack("q<l<Q>"), 1.0.nan?, (0.1 + 0.2).round(15)'), '[1, -2, 8589934592]\nfalse\n0.3\n');

  // zlib (wasix-zlib), including a gzip file round trip.
  assert.equal(await rb('require "zlib"; d = Zlib::Deflate.deflate("homescoop" * 100); puts Zlib.crc32("123456789").to_s(16), Zlib.adler32("123456789").to_s(16), Zlib::Inflate.inflate(d).size, d.size < 100, Zlib::ZLIB_VERSION'),
    'cbf43926\n91e01de\n900\ntrue\n1.3.1\n');
  assert.equal(await rb('require "zlib"; Zlib::GzipWriter.open("t.gz") { |g| g.write("hello gz\\n") }; print Zlib::GzipReader.open("t.gz", &:read), File.binread("t.gz", 2).unpack1("H*"), "\\n"'), 'hello gz\n1f8b\n');

  // openssl (wasix-openssl).
  assert.match(await rb('require "openssl"; puts OpenSSL::OPENSSL_LIBRARY_VERSION'), /^OpenSSL 3\.5\.9 /);
  assert.equal(await rb('require "openssl"; require "digest"; puts Digest::SHA256.hexdigest("abc"), OpenSSL::HMAC.hexdigest("SHA256", "key", "The quick brown fox jumps over the lazy dog")'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\nf7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8\n');
  // AES-256-GCM, GCM spec test case 16.
  assert.equal(await rb(`require "openssl"; c = OpenSSL::Cipher.new("aes-256-gcm").encrypt
    c.key = ["feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308"].pack("H*"); c.iv = ["cafebabefacedbaddecaf888"].pack("H*")
    c.auth_data = ["feedfacedeadbeeffeedfacedeadbeefabaddad2"].pack("H*")
    ct = c.update(["d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39"].pack("H*")) + c.final
    puts ct.unpack1("H*")[0, 32], c.auth_tag.unpack1("H*")`), '522dc1f099567d07f47f37a32a84427d\n76fc6ece0f4e1768cddf8853bb2d551b\n');
  assert.equal(await rb('require "openssl"; k = OpenSSL::PKey::EC.generate("prime256v1"); s = k.sign("SHA256", "msg"); puts k.verify("SHA256", s, "msg"), k.verify("SHA256", s, "msX"), OpenSSL::Random.random_bytes(16).bytesize, Random.urandom(8) != Random.urandom(8)'),
    'true\nfalse\n16\ntrue\n');

  // psych (libyaml) and json.
  assert.equal(await rb('require "yaml"; require "json"; h = YAML.safe_load("a: [1, 2]\\nb: {c: x}\\n"); puts h.inspect, JSON.generate(h), JSON.parse(%q({"k":[true,null,1.5]})).inspect, ({"z" => 1}.to_yaml)'),
    '{"a" => [1, 2], "b" => {"c" => "x"}}\n{"a":[1,2],"b":{"c":"x"}}\n{"k" => [true, nil, 1.5]}\n---\nz: 1\n');

  // Processes: posix_spawn (no fork).
  assert.equal(await rb('$stdout.sync = true; puts `echo backtick`; system("echo", "system"); pid = Process.spawn("sh", "-c", "exit 7"); Process.wait(pid); puts $?.exitstatus; IO.popen(["echo", "popen"]) { |io| puts io.read }'),
    'backtick\nsystem\n7\npopen\n');
  assert.equal(await rb('begin; fork; rescue NotImplementedError => e; puts "no fork"; end'), 'no fork\n');

  // Fiber, Thread, Etc, Socket constants.
  assert.equal(await rb('f = Fiber.new { |x| y = Fiber.yield(x * 2); y + 1 }; a = f.resume(5); puts a, f.resume(10); puts Thread.new { 6 * 7 }.value; q = Queue.new; t = Thread.new { q.pop * 2 }; q << 21; puts t.value'),
    '10\n11\n42\n42\n');
  assert.equal(await rb('require "etc"; require "socket"; puts Etc.getpwuid(Process.uid)&.name.to_s.empty? ? "nopw" : "pw", Process.uid, Socket::AF_INET > 0'), 'pw\n1000\ntrue\n');

  // gem / bundler run.
  assert.match((await run(['gem', '--version'], { cwd })).stdout, /^\d+\.\d+\.\d+$/m);
  const err = await run(['ruby', '-e', 'raise ArgumentError, "boom"'], { cwd });
  assert.equal(err.status, 1);
  assert.match(err.stderr, /boom \(ArgumentError\)/);
}
