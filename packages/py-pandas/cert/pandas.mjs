import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import io, json, warnings
import numpy as np
import pandas as pd
import pandas.io.clipboard as clip
from pandas.api.interchange import from_dataframe
df = pd.read_csv(io.StringIO("city,month,sales\nA,2026-01,10\nB,2026-01,7\nA,2026-02,5\nB,2026-02,8\nA,2026-03,1\n"))
g = df.groupby("city")["sales"].agg(["sum", "mean", "count"])
prices = pd.DataFrame({"city": ["A", "B"], "price": [2.5, 4.0]})
m = df.merge(prices, on="city")
m["revenue"] = m["sales"] * m["price"]
idx = pd.date_range("2026-03-28 00:00", periods=4, freq="D", tz="Europe/Berlin")
s = pd.Series([1.0, 2.0, np.nan, 4.0], index=idx)
w = pd.Series(range(10), index=pd.date_range("2026-01-01", periods=10, freq="h")).resample("3h").sum()
pv = df.pivot_table(index="month", columns="city", values="sales", aggfunc="sum", fill_value=0)
js = prices.to_json(orient="records")
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    ix = from_dataframe(m[["sales", "price"]].__dataframe__())
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
    "json": js,
    "json_back": bool(pd.read_json(io.StringIO(js), orient="records").equals(prices)),
    "mixed": [str(t) for t in pd.to_datetime(["2026-10-16", "16 Oct 2026 13:45", "2026-10-16T08:30:00"], format="mixed")],
    "rolling": pd.Series([1.0, 2.0, 3.0, 4.0, 5.0]).rolling(3).mean().dropna().tolist(),
    "clipboard": callable(clip.copy) and callable(clip.paste),
    "interchange": ix.to_dict(orient="list") == m[["sales", "price"]].to_dict(orient="list"),
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
  assert.deepEqual(out.dtypes, ['str', 'str', 'int64'], o);
  assert.equal(out.dateutil, '2026-10-16 13:45:00', o);
  assert.equal(out.json, '[{"city":"A","price":2.5},{"city":"B","price":4.0}]', `ultrajson to_json: ${o}`);
  assert.equal(out.json_back, true, `read_json round trip: ${o}`);
  assert.deepEqual(out.mixed, ['2026-10-16 00:00:00', '2026-10-16 13:45:00', '2026-10-16 08:30:00'], o);
  assert.deepEqual(out.rolling, [2, 3, 4], o);
  assert.equal(out.clipboard, true, `pandas.io.clipboard imports (ctypes at import): ${o}`);
  assert.equal(out.interchange, true, `from_dataframe(__dataframe__()) round trip: ${o}`);
  console.log(`pandas on wasix-python ${python}: read_csv, groupby agg, merge, tz-aware date_range across DST, interpolate, resample, pivot_table, to_csv, dateutil parsing, to_json/read_json, to_datetime mixed, rolling, pandas.io.clipboard, interchange from_dataframe`);
}
