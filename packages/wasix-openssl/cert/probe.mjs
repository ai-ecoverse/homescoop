/** wasix-openssl: the probe in both flavours (static lib/, PIC lib-pic/). */
export default async function (ctx) {
  const { run, assert } = ctx;
  for (const cmd of ['sslprobe', 'sslprobe-pic']) {
    const cwd = `/home/${cmd}`;
    assert.equal((await run(['mkdir', '-p', cwd])).status, 0);
    const r = await run([cmd], { cwd });
    assert.equal(r.status, 0, `${cmd}: rc=${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^OpenSSL 3\.5\.9 /m, cmd);
    // Reproducible build: the build date is SOURCE_DATE_EPOCH (the 3.5.9 release).
    assert.match(r.stdout, /^built on: Tue Sep 29 14:10:08 2026 UTC$/m, `${cmd}: build date not pinned`);
    for (const check of [
      'sha256(abc)',
      'aes-256-gcm encrypt (GCM spec test case 16)',
      'aes-256-gcm rejects a bad tag',
      'ecdsa p-256 verify',
      'ecdsa p-256 rejects a tampered message',
      'rsa-2048 pkcs1 sha256 verify',
      'rsa-2048 rejects a tampered message',
      'RAND_bytes (WASI random_get)',
      'file BIO write',
      'BIO_seek / BIO_tell',
      'read after BIO_seek',
      'BIO_tell after read',
      'BIO_get_mem_data (long)',
      'BIO_ctrl_pending (size_t)',
      'BIO_ctrl (long)',
      'BIO_ctrl EOF after drain',
      'tls handshake over a memory BIO pair',
      'tls 1.3',
      'client verified the self-signed cert (probe.test)',
      'client to server application data',
      'server to client application data',
      'OPENSSL_THREADS defined',
      'CRYPTO_THREAD_lock_new',
      'pthread_create x4',
      '4 threads x 2000: sha256, hmac-sha256, RAND_bytes, per-thread ERR queue',
      'CRYPTO_THREAD_write_lock excludes',
      'CRYPTO_atomic_add',
      'CRYPTO_THREAD_run_once ran once under contention',
    ]) {
      assert.ok(r.stdout.includes(`ok ${check}\n`), `${cmd}: ${check}\n${r.stdout}`);
    }
    assert.match(r.stdout, /^cipher TLS_(AES_256_GCM_SHA384|CHACHA20_POLY1305_SHA256|AES_128_GCM_SHA256)$/m, cmd);
    assert.match(r.stdout, /^sslprobe ok$/m, cmd);
  }
}
