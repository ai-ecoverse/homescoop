/**
 * util-linux under users enforce (#687). 2.42.4-2 links the slicc
 * credentials (slicc_cred_js), so the file arguments of rev, hexdump, look
 * and column are opened as the caller. colrm and getopt take no files.
 *
 * Files (root-owned unless noted): sec 0600, wo 0622 (others may write but
 * not read), pub 0644, mine 0600 cone:cone.
 */
export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const setup = await run(['bash', '-c', [
    'rm -rf /tmp/uu && mkdir -p /tmp/uu && cd /tmp/uu',
    'printf "secret\\nsecond\\n" > sec && chmod 600 sec',
    'printf "seal\\nsearch\\n" > wo && chmod 622 wo',
    'printf "sea,1\\nset,2\\n" > pub && chmod 644 pub',
    'printf "seed\\nsell\\n" > mine && chown 1000:1000 mine && chmod 600 mine',
    'chmod 755 /tmp/uu',
  ].join(' && ')], { cwd: '/tmp' });
  assert.equal(setup.status, 0, `setup: ${setup.stderr}`);
  const cmd = (argv, user) => run(argv, { cwd: '/tmp/uu', ...(user && { user }) });

  const want = {
    sec: { rev: 'terces\ndnoces\n', look: 'secret\nsecond\n', column: 'secret\nsecond\n', hex: '73 65 63 72 65 74 0a 73' },
    wo: { rev: 'laes\nhcraes\n', look: 'seal\nsearch\n', column: 'seal\nsearch\n', hex: '73 65 61 6c 0a 73 65 61' },
    pub: { rev: '1,aes\n2,tes\n', look: 'sea,1\nset,2\n', column: 'sea  1\nset  2\n', hex: '73 65 61 2c 31 0a 73 65' },
    mine: { rev: 'dees\nlles\n', look: 'seed\nsell\n', column: 'seed\nsell\n', hex: '73 65 65 64 0a 73 65 6c' },
  };
  const readable = { root: ['sec', 'wo', 'pub', 'mine'], cone: ['pub', 'mine'] };
  for (const user of ['root', 'cone']) {
    const as = user === 'root' ? undefined : user;
    for (const f of Object.keys(want)) {
      const ok = readable[user].includes(f);
      const rev = await cmd(['rev', f], as);
      const hex = await cmd(['hexdump', '-C', f], as);
      const look = await cmd(['look', 'se', f], as);
      const column = await cmd(['column', '-t', '-s,', f], as);
      if (ok) {
        for (const [name, r] of Object.entries({ rev, hex, look, column })) {
          assert.equal(r.status, 0, `${user}: ${name} ${f}: rc=${r.status} stderr=${r.stderr}`);
        }
        assert.equal(rev.stdout, want[f].rev, `${user}: rev ${f}`);
        assert.ok(hex.stdout.startsWith(`00000000  ${want[f].hex}`), `${user}: hexdump -C ${f}: ${hex.stdout}`);
        assert.equal(look.stdout, want[f].look, `${user}: look se ${f}`);
        assert.equal(column.stdout, want[f].column, `${user}: column -t ${f}`);
      } else {
        assert.equal(rev.status, 1, `${user}: rev ${f}: rc=${rev.status}`);
        assert.equal(rev.stderr, `rev: cannot open ${f}: Permission denied\n`, `${user}: rev ${f}`);
        assert.equal(look.status, 1, `${user}: look ${f}: rc=${look.status}`);
        assert.equal(look.stderr, `look: ${f}: Permission denied\n`, `${user}: look ${f}`);
        assert.equal(column.status, 1, `${user}: column ${f}: rc=${column.status}`);
        assert.equal(column.stderr, `column: ${f}: Permission denied\n`, `${user}: column ${f}`);
        // musl's freopen leaves stdin closed-but-numbered, so hexdump adds
        // "<f>: Bad file descriptor" where glibc says "all input file
        // arguments failed"; the first line and rc are the point here.
        assert.equal(hex.status, 1, `${user}: hexdump ${f}: rc=${hex.status}`);
        assert.equal(hex.stderr.split('\n')[0], `hexdump: ${f}: Permission denied`, `${user}: hexdump ${f}: ${hex.stderr}`);
        for (const [name, r] of Object.entries({ rev, hex, look, column })) {
          assert.equal(r.stdout, '', `${user}: ${name} ${f} prints nothing`);
        }
      }
    }
  }
  console.log("users: cone's rev/hexdump/look/column are refused root's 0600 and 0622 files (rc 1, Permission denied), read 0644 and its own 0600; root reads all");
}
