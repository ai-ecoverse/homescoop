// homescoop#589: scipy._lib._uarray's Function getters and the _pickle
// methods are called by CPython with two arguments (getter closure, the
// METH_NOARGS NULL); 0010-uarray-call-signatures.patch gives them the second
// parameter. Up to 1.18.0-12 each of these trapped (function signature mismatch).
import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json, pickle
import numpy as np
import scipy.fft
from scipy._lib._uarray import _uarray
f = scipy.fft.fft
fn = getattr(f, "__wrapped__", None)
out = {}
# The _Function behind scipy.fft.fft: its four getters.
uf = [v for v in vars(scipy.fft._basic).values() if isinstance(v, _uarray._Function)]
out["functions"] = len(uf) > 0
g = uf[0]
out["domain"] = g.domain
out["getters"] = [callable(g.arg_extractor), callable(g.arg_replacer), g.default is None or callable(g.default)]
ctx = scipy.fft.set_backend("scipy")
# The contexts' METH_NOARGS _pickle (scipy registers no copyreg for them; the
# call itself is what trapped).
out["ctx_pickle"] = [type(ctx._pickle()).__name__, len(ctx._pickle())]
with ctx:
    out["fft"] = [round(abs(c), 9) for c in scipy.fft.fft([1.0, 0.0, -1.0, 0.0]).tolist()]
skip = scipy.fft.skip_backend("scipy")
out["skip_pickle"] = type(skip._pickle()).__name__
# _BackendState._pickle (copyreg's reducer calls it; the reconstructor is
# named after the C type's module "uarray", which isn't importable here or in
# scipy's own wheels, so the round trip stops there).
st = _uarray.get_state()
out["state"] = [type(st).__name__, type(st._pickle()).__name__]
# A _Function pickles by reference.
out["function"] = pickle.loads(pickle.dumps(scipy.fft.fft)) is scipy.fft.fft
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await pythonUnderTest(ctx);
  await write('/tmp/scipy_uarray.py', SCRIPT);
  const r = await run(['python3', '/tmp/scipy_uarray.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.functions, true, o);
  assert.equal(out.domain, 'numpy.scipy.fft', o);
  assert.deepEqual(out.getters, [true, true, true], o);
  assert.deepEqual(out.ctx_pickle, ['tuple', 3], o);
  assert.deepEqual(out.fft, [0, 2, 0, 2], o);
  assert.equal(out.skip_pickle, 'tuple', o);
  assert.deepEqual(out.state, ['_BackendState', 'tuple'], o);
  assert.equal(out.function, true, o);
  console.log(`uarray (#589): _Function getters domain/arg_extractor/arg_replacer/default; set_backend/skip_backend _pickle, get_state()._pickle, and a scipy.fft.fft pickle round trip: ${o}`);
}
