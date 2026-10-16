import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json
from cycler import cycler
c = cycler(color=["r", "g"]) * cycler(lw=[1, 2])
s = cycler(color=["r", "g", "b"]) + cycler(ls=["-", "--", ":"])
print(json.dumps({"product": list(c), "len": len(c), "sum": s.by_key(), "keys": sorted(c.keys), "concat": [d["color"] for d in cycler(color=["r"]).concat(cycler(color=["k"]))]}))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/cycler_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/cycler_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out.product, [{ color: 'r', lw: 1 }, { color: 'r', lw: 2 }, { color: 'g', lw: 1 }, { color: 'g', lw: 2 }]);
  assert.equal(out.len, 4);
  assert.deepEqual(out.sum, { color: ['r', 'g', 'b'], ls: ['-', '--', ':'] });
  assert.deepEqual(out.keys, ['color', 'lw']);
  assert.deepEqual(out.concat, ['r', 'k']);
  console.log(`cycler on wasix-python ${python}: product, sum, by_key, concat`);
}
