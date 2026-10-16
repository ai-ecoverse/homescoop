import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import io, json
import numpy as np
import pandas as pd
df = pd.read_csv(io.StringIO("city,month,sales\nA,2026-01,10\nB,2026-01,7\nA,2026-02,5\nB,2026-02,8\nA,2026-03,1\n"))
g = df.groupby("city")["sales"].agg(["sum", "mean", "count"])
prices = pd.DataFrame({"city": ["A", "B"], "price": [2.5, 4.0]})
m = df.merge(prices, on="city")
m["revenue"] = m["sales"] * m["price"]
idx = pd.date_range("2026-03-28 00:00", periods=4, freq="D", tz="Europe/Berlin")
s = pd.Series([1.0, 2.0, np.nan, 4.0], index=idx)
w = pd.Series(range(10), index=pd.date_range("2026-01-01", periods=10, freq="h")).resample("3h").sum()
pv = df.pivot_table(index="month", columns="city", values="sales", aggfunc="sum", fill_value=0)
out = {
    "groupby": {k: [int(v["sum"]), round(float(v["mean"]), 6), int(v["count"])] for k, v in g.iterrows()},
    "revenue": float(m["revenue"].sum()),
    "offsets": [str(t.utcoffset()) for t in idx],
    "utc": str(idx.tz_convert("UTC")[2]),
    "fill": s.interpolate().tolist(),
    "resample": w.tolist(),
    "pivot": pv.to_dict(orient="list"),
    "csv": m.sort_values(["city", "month"]).head(2).to_csv(index=False),
    "dtypes": [str(t) for t in df.dtypes],
    "dateutil": str(pd.Timestamp("16 Oct 2026 13:45")),
}
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/pandas_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/pandas_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.groupby, { A: [16, 5.333333, 3], B: [15, 7.5, 2] }, o);
  assert.equal(out.revenue, 100, o);
  assert.deepEqual(out.offsets, ['1:00:00', '1:00:00', '2:00:00', '2:00:00'], `Europe/Berlin moves to CEST on 2026-03-29: ${o}`);
  assert.equal(out.utc, '2026-03-29 22:00:00+00:00', o);
  assert.deepEqual(out.fill, [1, 2, 3, 4], o);
  assert.deepEqual(out.resample, [3, 12, 21, 9], o);
  assert.deepEqual(out.pivot, { A: [10, 5, 1], B: [7, 8, 0] }, o);
  assert.equal(out.csv, 'city,month,sales,price,revenue\nA,2026-01,10,2.5,25.0\nA,2026-02,5,2.5,12.5\n', o);
  assert.deepEqual(out.dtypes, ['object', 'object', 'int64'], o);
  assert.equal(out.dateutil, '2026-10-16 13:45:00', o);
  console.log(`pandas on wasix-python ${python}: read_csv, groupby agg, merge, tz-aware date_range across DST, interpolate, resample, pivot_table, to_csv, dateutil parsing`);
}
