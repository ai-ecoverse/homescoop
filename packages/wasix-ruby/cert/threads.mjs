/**
 * wasix-ruby 3.4.11-9: interrupting threads blocked in fd waits, and
 * OpenSSL from several threads.
 * - Thread#kill / Thread#raise / Timeout / Thread.main.raise on a thread in
 *   a pipe read, IO.select, IO#wait_readable, TCPServer#accept or a socket
 *   read. Up to -8 these killed the whole process (exit 155: ruby's
 *   pthread_kill(SIGVTALRM) arrives as SIGPROF, slicc-kernel#246) or hung.
 *   thread-ubf-wake-pipe-wasi.patch wakes the blocked poll/select through a
 *   per-thread pipe instead of a signal.
 * - wasix-openssl 3.5.9-3 is thread-safe (OPENSSL_THREADS): 4 Ruby threads
 *   hash, HMAC, encrypt/decrypt and run TLS handshakes at once.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const rb = async (name, code, want) => {
    await write(`/home/t_${name}.rb`, code);
    const r = await run(['timeout', '20', 'ruby', `/home/t_${name}.rb`], { cwd: '/home' });
    assert.equal(r.status, 0, `${name}: rc=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.equal(r.stdout, want, `${name}: ${r.stdout}`);
  };

  const killed = 'ok false\nend\n';
  await rb('pipe_gets_kill', 'r, w = IO.pipe; th = Thread.new { r.gets }; sleep 0.3; th.kill; th.join(5); puts "ok #{th.status.inspect}"; puts "end"\n', killed);
  await rb('select_kill', 'r, w = IO.pipe; th = Thread.new { IO.select([r]) }; sleep 0.3; th.kill; th.join(5); puts "ok #{th.status.inspect}"; puts "end"\n', killed);
  await rb('wait_readable_kill', 'r, w = IO.pipe; th = Thread.new { r.wait_readable }; sleep 0.3; th.kill; th.join(5); puts "ok #{th.status.inspect}"; puts "end"\n', killed);
  await rb('accept_kill', 'require "socket"; srv = TCPServer.new("127.0.0.1", 0); th = Thread.new { srv.accept }; sleep 0.3; th.kill; th.join(5); puts "ok #{th.status.inspect}"; puts "end"\n', killed);
  await rb('accept_raise', 'require "socket"; srv = TCPServer.new("127.0.0.1", 0); th = Thread.new { begin; srv.accept; rescue IOError => e; "rescued #{e.message}"; end }; sleep 0.3; th.raise(IOError, "x"); puts th.value\n', 'rescued x\n');
  await rb('pipe_timeout', 'require "timeout"; r, w = IO.pipe; t = Time.now; puts(begin; Timeout.timeout(0.3) { r.gets }; rescue Timeout::Error; "ok timeout"; end); puts (Time.now - t) < 3\n', 'ok timeout\ntrue\n');
  await rb('sock_read_timeout', 'require "timeout"; require "socket"; srv = TCPServer.new("127.0.0.1", 0); s = TCPSocket.new("127.0.0.1", srv.addr[1]); puts(begin; Timeout.timeout(0.3) { s.read(1) }; rescue Timeout::Error; "ok timeout"; end)\n', 'ok timeout\n');
  await rb('main_raise', 'th = Thread.new { sleep 0.3; Thread.main.raise(RuntimeError, "from thread") }; r, w = IO.pipe; begin; r.gets; rescue => e; puts "main got #{e.message}"; end\n', 'main got from thread\n');
  // Woken but not interrupted: a writer thread still delivers the data.
  await rb('wake_then_data', 'r, w = IO.pipe; th = Thread.new { r.gets }; sleep 0.2; w.puts "late"; puts th.value\n', 'late\n');
  // Still fine (condvar waits).
  await rb('sleep_kill', 'th = Thread.new { sleep 10 }; sleep 0.3; th.kill; th.join(5); puts "ok #{th.status.inspect}"; puts "end"\n', killed);
  await rb('queue_pop_kill', 'q = Queue.new; th = Thread.new { q.pop }; sleep 0.3; th.kill; th.join(5); puts "ok #{th.status.inspect}"; puts "end"\n', killed);

  // OpenSSL from 4 threads at once (wasix-openssl 3.5.9-3).
  await rb('openssl_threads', `require "openssl"; require "socket"
key = OpenSSL::PKey::EC.generate("prime256v1")
cert = OpenSSL::X509::Certificate.new
cert.version = 2; cert.serial = 1
cert.subject = cert.issuer = OpenSSL::X509::Name.parse("/CN=localhost")
cert.public_key = key; cert.not_before = Time.now - 60; cert.not_after = Time.now + 3600
cert.sign(key, "SHA256")
sha = OpenSSL::Digest::SHA256.hexdigest("thread probe")
mac = OpenSSL::HMAC.hexdigest("SHA256", "key", "thread probe")
bad = Queue.new
threads = 4.times.map do |t|
  Thread.new do
    300.times do |i|
      bad << :sha if OpenSSL::Digest::SHA256.hexdigest("thread probe") != sha
      bad << :hmac if OpenSSL::HMAC.hexdigest("SHA256", "key", "thread probe") != mac
      c = OpenSSL::Cipher.new("aes-256-gcm").encrypt; k = c.random_key; iv = c.random_iv
      ct = c.update("msg #{t}/#{i}") + c.final; tag = c.auth_tag
      d = OpenSSL::Cipher.new("aes-256-gcm").decrypt; d.key = k; d.iv = iv; d.auth_tag = tag
      bad << :gcm if d.update(ct) + d.final != "msg #{t}/#{i}"
    end
    sctx = OpenSSL::SSL::SSLContext.new; sctx.cert = cert; sctx.key = key
    srv = TCPServer.new("127.0.0.1", 0)
    st = Thread.new { s = OpenSSL::SSL::SSLSocket.new(srv.accept, sctx); s.accept; s.puts s.gets.upcase; s.close }
    cctx = OpenSSL::SSL::SSLContext.new; store = OpenSSL::X509::Store.new; store.add_cert(cert)
    cctx.cert_store = store; cctx.verify_mode = OpenSSL::SSL::VERIFY_PEER
    c = OpenSSL::SSL::SSLSocket.new(TCPSocket.new("127.0.0.1", srv.addr[1]), cctx); c.hostname = "localhost"; c.connect
    c.puts "tls #{t}"; bad << :tls if c.gets != "TLS #{t}\\n"
    c.close; st.join
  end
end
threads.each(&:join)
puts "bad #{bad.size}"
`, 'bad 0\n');
}
