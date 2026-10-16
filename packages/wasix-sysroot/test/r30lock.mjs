export const build = { asyncify: true };
export default async function (ctx) {
  const r = await ctx.run(['r30lock'], { cwd: '/tmp' });
  console.log(r.status, r.stdout, r.stderr);
}
