/**
 * wasix-ruby 3.4.11-8: single-fd waits and irb.
 * - IO#wait_readable / IO#wait(READABLE) on a pipe: up to -7 they raised
 *   Errno::ENOSYS (the select() path put readable waits into exceptfds,
 *   which WASIX's select rejects; POLLPRI == POLLIN). -8 waits with poll().
 * - TCPSocket.new (blocking connect) and Net::HTTP GET against a TCPServer
 *   in the same process on the kernel's loopback.
 * - A blocking OpenSSL::SSL::SSLSocket connect/accept over loopback.
 * - irb reads a script from stdin (needs io/console, built since -8).
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const rb = async (code) => {
    const r = await run(['ruby', '-e', code], { cwd: '/home' });
    assert.equal(r.status, 0, `ruby -e ${code}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    return r.stdout;
  };

  // Pipes: data pending, no data with a timeout, IO#wait.
  assert.equal(await rb(`r, w = IO.pipe; w.write "x"
    puts r.wait_readable(1).equal?(r), !!r.wait(IO::READABLE, 1), r.read_nonblock(1)
    t = Time.now; puts r.wait_readable(0.3).inspect, (Time.now - t) >= 0.25
    puts w.wait_writable(1).equal?(w)`), 'true\ntrue\nx\nnil\ntrue\ntrue\n');
  // A blocking read woken by a writer thread.
  assert.equal(await rb('r, w = IO.pipe; Thread.new { sleep 0.2; w.puts "late" }; puts r.wait_readable(5).equal?(r), r.gets'), 'true\nlate\n');

  // TCPSocket.new and Net::HTTP against an in-process server on loopback.
  assert.equal(await rb(`require "socket"; require "net/http"
    srv = TCPServer.new("127.0.0.1", 0); port = srv.addr[1]
    th = Thread.new do
      2.times do
        c = srv.accept
        req = +""; req << c.readpartial(4096) until req.include?("\\r\\n\\r\\n")
        body = "hello " + req.lines.first.split[1]
        c.write "HTTP/1.1 200 OK\\r\\nContent-Length: #{body.bytesize}\\r\\nConnection: close\\r\\n\\r\\n#{body}"
        c.close
      end
    end
    s = TCPSocket.new("127.0.0.1", port); s.write "GET /raw HTTP/1.0\\r\\n\\r\\n"; puts s.read.split("\\r\\n\\r\\n", 2)[1]; s.close
    res = Net::HTTP.get_response(URI("http://127.0.0.1:#{port}/net-http"))
    puts res.code, res.body
    th.join`), 'hello /raw\n200\nhello /net-http\n');

  // Blocking TLS 1.3 handshake both ways over loopback (self-signed EC cert).
  assert.equal(await rb(`require "socket"; require "openssl"
    key = OpenSSL::PKey::EC.generate("prime256v1")
    cert = OpenSSL::X509::Certificate.new
    cert.version = 2; cert.serial = 1
    cert.subject = cert.issuer = OpenSSL::X509::Name.parse("/CN=localhost")
    cert.public_key = key; cert.not_before = Time.now - 60; cert.not_after = Time.now + 3600
    cert.sign(key, "SHA256")
    sctx = OpenSSL::SSL::SSLContext.new; sctx.cert = cert; sctx.key = key
    srv = TCPServer.new("127.0.0.1", 0); port = srv.addr[1]
    th = Thread.new do
      ssl = OpenSSL::SSL::SSLSocket.new(srv.accept, sctx); ssl.accept
      ssl.puts "server:" + ssl.gets.chomp; ssl.close
    end
    cctx = OpenSSL::SSL::SSLContext.new; cctx.verify_mode = OpenSSL::SSL::VERIFY_PEER
    store = OpenSSL::X509::Store.new; store.add_cert(cert); cctx.cert_store = store
    c = OpenSSL::SSL::SSLSocket.new(TCPSocket.new("127.0.0.1", port), cctx)
    c.hostname = "localhost"; c.connect
    c.puts "ping"; puts c.gets, c.ssl_version, c.peer_cert.subject.to_s
    c.close; th.join`), 'server:ping\nTLSv1.3\n/CN=localhost\n');

  // irb, non-interactive, from stdin.
  const irb = await run(['bash', '-c', "printf 'x = 6 * 7\\nputs \"irb:#{x}\"\\nrequire \"io/console\"\\nputs IO.respond_to?(:console)\\n' | irb -f --noprompt"], { cwd: '/home' });
  assert.equal(irb.status, 0, `irb: ${irb.stdout}\n${irb.stderr}`);
  assert.match(irb.stdout, /^irb:42$/m, irb.stdout);
  assert.match(irb.stdout, /^true$/m, irb.stdout);
  assert.doesNotMatch(irb.stderr, /cannot load such file/, irb.stderr);
}
