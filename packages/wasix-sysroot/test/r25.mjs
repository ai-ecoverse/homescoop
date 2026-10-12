export const kernelOptions = { users: process.env.R25_USERS || 'enforce' };

const lines = (s) => s.trim().split('\n').map((l) => l.split(': ')).map(([k, v]) => [k, v]);
const open = (over = {}) => {
  const base = {
    'ro R': '0', 'ro W': '0', 'ro X': '0', 'rw W': '0', 'x X': '0', 'priv R': '0', 'priv F': '0', 'closed/f F': '0',
    'link nofollow R': '0', 'link follow R': '0', 'dirfd priv R': '0', 'eaccess priv R': '0',
    'bad flag': 'EINVAL', 'bad mode': 'EINVAL', missing: 'ENOENT', 'linkat flag 0x1': 'EINVAL', 'linkat flag 0x400': 'EINVAL',
    'open ro RDONLY': '0', 'open rw WRONLY': '0', 'open rw RDWR': '0', 'open priv RDONLY': '0', opendir: '0',
  };
  return { ...base, ...over };
};
const rootTail = (eff) => ({ 'seteuid 1000': '0', 'real priv R': '0', 'effective priv R': eff, 'effective at priv R': eff });

const want = {
  enforce: {
    root: { ...open({ 'ro X': 'EACCES' }), ...rootTail('EACCES') },
    cone: open({
      'ro W': 'EACCES', 'ro X': 'EACCES', 'rw W': 'EACCES', 'priv R': 'EACCES', 'closed/f F': 'EACCES',
      'link follow R': 'EACCES', 'dirfd priv R': 'EACCES', 'eaccess priv R': 'EACCES',
      'open rw WRONLY': 'EACCES', 'open rw RDWR': 'EACCES', 'open priv RDONLY': 'EACCES',
    }),
  },
  permissive: { root: { ...open(), ...rootTail('0') }, cone: open() },
};

export default async function (ctx) {
  const { run, kernel, assert } = ctx;
  await kernel.users.add({ name: 'cone' });
  const s = await run(['r25', 'setup'], { cwd: '/tmp' });
  assert.equal(s.status, 0, `${s.stdout}${s.stderr}`);
  const mode = kernel.users.mode === 'enforce' && ctx.requireNative ? 'enforce' : 'permissive';
  for (const user of ['root', 'cone']) {
    const r = await run(['r25', user], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    assert.equal(r.status, 0, `${user}: ${r.stdout}${r.stderr}`);
    const got = Object.fromEntries(lines(r.stdout).filter(([k]) => k !== 'r25 done'));
    assert.deepEqual(got, want[mode][user], `${mode} ${user}:\n${r.stdout}`);
  }
  console.log(`r25: access/faccessat/eaccess and open rights as root and cone, ${mode} (users ${kernel.users.mode})`);
}
