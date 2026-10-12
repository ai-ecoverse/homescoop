export const kernelOptions = { users: process.env.R25_USERS || 'enforce' };

export default async function (ctx) {
  const { run, kernel, assert } = ctx;
  await kernel.users.add({ name: 'cone' });
  const s = await run(['r25', 'setup'], { cwd: '/tmp' });
  assert.equal(s.status, 0, `${s.stdout}${s.stderr}`);
  for (const user of ['root', 'cone']) {
    const r = await run(['r25', user], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    console.log(`--- ${user} rc=${r.status}\n${r.stdout}${r.stderr}`);
  }
}
