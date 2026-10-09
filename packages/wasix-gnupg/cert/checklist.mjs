/**
 * wasix-gnupg checklist: the gpg smoke for 2.4.9-3 (first build in CI,
 * #152, on wasix-sysroot 2025.9.30-15). Key generation spawns gpg-agent;
 * public-key and symmetric encryption round trips; clearsign, detached
 * signatures checked with gpgv, a tampered file is a BAD signature; the
 * homedir passes GnuPG's ownership check (st_uid == getuid(), the reason
 * for sysroot -15).
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const G = '/home/gnupg-cert';
  const sh = (script, home = G) => run(['bash', '-c', `export GNUPGHOME=${home}; ${script}`], { cwd: '/home' });
  const ok = async (script, home) => {
    const r = await sh(script, home);
    assert.equal(r.status, 0, `${script}: rc=${r.status} stderr=${r.stderr}`);
    return r;
  };
  const P = 'gpg --batch --pinentry-mode loopback --passphrase ""';

  const ver = await ok('gpg --version');
  assert.match(ver.stdout, /^gpg \(GnuPG\) 2\.4\.9$/m);
  assert.match(ver.stdout, /^libgcrypt 1\.12\.4$/m);
  assert.match(ver.stdout, /^Pubkey: .*EDDSA/m);

  // Fresh homedir: no ownership complaint (sysroot -15 slicc_stat_owner).
  await ok(`mkdir -p ${G} && chmod 700 ${G}`);
  const first = await ok('gpg --batch --list-keys');
  assert.doesNotMatch(first.stderr, /unsafe/i, `fresh homedir: ${first.stderr}`);
  assert.match(first.stderr, /keybox '.*\/pubring\.kbx' created/);

  // Key generation (spawns gpg-agent): ed25519 + a cv25519 encryption subkey.
  await ok(`${P} --quick-gen-key "Cert <cert@example.org>" default default never`);
  const cols = (await ok('gpg --list-keys --with-colons')).stdout.split('\n').map((l) => l.split(':'));
  const pub = cols.find((c) => c[0] === 'pub');
  const sub = cols.find((c) => c[0] === 'sub');
  const uid = cols.find((c) => c[0] === 'uid');
  assert.equal(pub?.[16], 'ed25519', `pub ${pub}`);
  assert.equal(sub?.[16], 'cv25519', `sub ${sub}`);
  assert.equal(uid?.[9], 'Cert <cert@example.org>');

  // Public-key encryption round trip (OpenPGP packet tag 0x84: PKESK).
  await ok('printf "secret text\\n" > /home/gm.txt');
  await ok('gpg --batch --yes --trust-model always -r cert@example.org -o /home/gm.gpg -e /home/gm.txt');
  assert.equal((await ok('od -An -tx1 -N1 /home/gm.gpg')).stdout.trim(), '84');
  assert.equal((await ok(`${P} -o - -d /home/gm.gpg 2>/dev/null`)).stdout, 'secret text\n');

  // Symmetric: right and wrong passphrase.
  await ok('gpg --batch --pinentry-mode loopback --passphrase pw --yes -o /home/gs.gpg -c /home/gm.txt');
  assert.equal((await ok('gpg --batch --pinentry-mode loopback --passphrase pw -o - -d /home/gs.gpg 2>/dev/null')).stdout, 'secret text\n');
  const wrong = await sh('gpg --batch --pinentry-mode loopback --passphrase nope -o - -d /home/gs.gpg');
  assert.equal(wrong.status, 2, `wrong passphrase rc=${wrong.status}`);
  assert.match(wrong.stderr, /decryption failed: Bad session key/);

  // Clearsign + verify.
  await ok(`${P} --yes -o /home/gm.asc --clearsign /home/gm.txt`);
  const cv = await ok('gpg --batch --verify /home/gm.asc');
  assert.match(cv.stderr, /Good signature from "Cert <cert@example\.org>"/);

  // Detached signature checked with gpgv against an exported keyring;
  // a tampered file is a BAD signature, rc 1.
  await ok(`${P} --yes -o /home/gm.sig --detach-sign /home/gm.txt && gpg --export > /home/gpub.gpg`);
  const gv = await ok('gpgv --keyring /home/gpub.gpg /home/gm.sig /home/gm.txt');
  assert.match(gv.stderr, /gpgv: Good signature from "Cert <cert@example\.org>"/);
  const bad = await sh('printf "tamper\\n" >> /home/gm.txt; gpgv --keyring /home/gpub.gpg /home/gm.sig /home/gm.txt');
  assert.equal(bad.status, 1, `tampered rc=${bad.status}`);
  assert.match(bad.stderr, /gpgv: BAD signature from "Cert <cert@example\.org>"/);

  // Armored export; gpgconf lists components and stops the agent.
  assert.match((await ok('gpg --armor --export cert@example.org')).stdout, /^-----BEGIN PGP PUBLIC KEY BLOCK-----$/m);
  const comps = await ok('gpgconf --list-components');
  assert.match(comps.stdout, /^gpg-agent:Private Keys:/m);
  await ok('gpgconf --kill gpg-agent');

}
