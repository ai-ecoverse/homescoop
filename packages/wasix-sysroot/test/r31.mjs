export default async function (ctx) { const r = await ctx.run(["r31"], { cwd: "/tmp" }); console.log(r.status, r.stdout, r.stderr); }
