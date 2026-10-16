const SCRIPT = String.raw`
import json, six
from six.moves import urllib, configparser, range as srange
class Meta(type):
    pass
@six.add_metaclass(Meta)
class A(object):
    pass
out = {
    "py3": six.PY3,
    "types": [six.string_types == (str,), six.integer_types == (int,), six.text_type is str, six.binary_type is bytes],
    "b_u": [six.b("ab"), six.u("ab")],
    "moves": [urllib.parse.quote("a b"), configparser.__name__, list(srange(3))],
    "meta": type(A).__name__,
    "iter": sorted(six.iteritems({"a": 1, "b": 2})),
    "with_meta": type(type("B", (six.with_metaclass(Meta, object),), {})).__name__,
    "ensure": [six.ensure_str(b"x"), six.ensure_binary("y").decode()],
}
try:
    six.reraise(ValueError, ValueError("boom"))
except ValueError as e:
    out["reraise"] = str(e)
out["b_u"][0] = out["b_u"][0].decode()
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/six_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/six_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out, {
    py3: true,
    types: [true, true, true, true],
    b_u: ['ab', 'ab'],
    moves: ['a%20b', 'configparser', [0, 1, 2]],
    meta: 'Meta',
    iter: [['a', 1], ['b', 2]],
    with_meta: 'Meta',
    ensure: ['x', 'y'],
    reraise: 'boom',
  });
  console.log('six: PY3, string/integer/text/binary types, b/u, six.moves (urllib.parse, configparser, range), add_metaclass/with_metaclass, iteritems, ensure_str/ensure_binary, reraise');
}
