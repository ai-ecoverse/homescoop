const SCRIPT = String.raw`
import json, os
import pandas as pd
home = os.path.expanduser("~")
df = pd.DataFrame({"city": ["A", "B"], "sales": [10, 7], "when": pd.to_datetime(["2026-03-28", "2026-03-29"]).tz_localize("Europe/Berlin")})
paths = {k: os.path.join(home, "d." + k) for k in ("csv", "json", "pkl")}
df.to_csv(paths["csv"], index=False)
df.to_json(paths["json"], orient="records", date_format="iso")
df.to_pickle(paths["pkl"])
c = pd.read_csv(paths["csv"])
j = pd.read_json(paths["json"], orient="records")
p = pd.read_pickle(paths["pkl"])
out = {
    "uid": os.getuid(),
    "home": home,
    "csv": c[["city", "sales"]].to_dict(orient="list"),
    "json": j[["city", "sales"]].to_dict(orient="list"),
    "pickle": bool(p.equals(df)),
    "tz": str(p["when"].dt.tz),
    "owned": sorted(k for k, v in paths.items() if os.stat(v).st_uid == os.getuid()),
}
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  assert.equal(typeof ctx.addUser, 'function', 'the harness has addUser (users enforce)');
  await write('/tmp/pandas_users.py', SCRIPT);
  const u = await ctx.addUser({ name: 'pd' });
  const name = u?.name ?? 'pd';
  const r = await run(['python3', '/tmp/pandas_users.py'], { user: name, cwd: `/home/${name}` });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.notEqual(out.uid, 0, `runs as the added user, not root: ${o}`);
  assert.equal(out.home, `/home/${name}`, o);
  assert.deepEqual(out.csv, { city: ['A', 'B'], sales: [10, 7] }, o);
  assert.deepEqual(out.json, { city: ['A', 'B'], sales: [10, 7] }, o);
  assert.equal(out.pickle, true, o);
  assert.equal(out.tz, 'Europe/Berlin', o);
  assert.deepEqual(out.owned, ['csv', 'json', 'pkl'], `the files in ~ belong to the user: ${o}`);
  console.log(`pandas as uid ${out.uid}: CSV, JSON and pickle written under ${out.home} and read back (tz ${out.tz})`);
}
