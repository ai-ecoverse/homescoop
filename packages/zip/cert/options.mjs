export default async function options(ctx) {
  const { assert } = ctx;
  const zip = await ctx.run(['zip', '-v'], { cwd: '/home' });
  assert.equal(zip.status, 0, `zip -v: rc ${zip.status}\n${zip.stderr}`);
  assert.match(zip.stdout, /This is Zip 3\.0 \(July 5th 2008\)/);
  for (const opt of ['USE_EF_UT_TIME', 'SYMLINK_SUPPORT', 'LARGE_FILE_SUPPORT', 'ZIP64_SUPPORT', 'STORE_UNIX_UIDs_GIDs', 'UIDGID_NOT_16BIT']) {
    assert.match(zip.stdout, new RegExp(`^\\s+${opt}\\b`, 'm'), `zip -v lists ${opt}`);
  }
  assert.match(zip.stdout, /\[encryption, version 2\.91/);
  const unzip = await ctx.run(['unzip', '-v'], { cwd: '/home' });
  assert.equal(unzip.status, 0, `unzip -v: rc ${unzip.status}\n${unzip.stderr}`);
  assert.match(unzip.stdout, /^UnZip 6\.00 of 20 April 2009/m);
  for (const opt of ['SET_DIR_ATTRIB', 'SYMLINKS', 'TIMESTAMP', 'UNIXBACKUP', 'USE_EF_UT_TIME', 'USE_UNSHRINK', 'USE_DEFLATE64', 'LARGE_FILE_SUPPORT', 'ZIP64_SUPPORT']) {
    assert.match(unzip.stdout, new RegExp(`^\\s+${opt}\\b`, 'm'), `unzip -v lists ${opt}`);
  }
}
