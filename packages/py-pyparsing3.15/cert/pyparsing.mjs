import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json, operator
import pyparsing as pp
num = pp.pyparsing_common.number
ops = [(pp.one_of("* /"), 2, pp.OpAssoc.LEFT), (pp.one_of("+ -"), 2, pp.OpAssoc.LEFT)]
expr = pp.infix_notation(num, ops)
fn = {"+": operator.add, "-": operator.sub, "*": operator.mul, "/": operator.truediv}
def ev(t):
    if not isinstance(t, pp.ParseResults):
        return t
    v = ev(t[0])
    for i in range(1, len(t), 2):
        v = fn[t[i]](v, ev(t[i + 1]))
    return v
kv = pp.Dict(pp.Group(pp.Word(pp.alphas) + pp.Suppress("=") + pp.Word(pp.alphanums))[1, ...])
bad = None
try:
    pp.Word(pp.nums).parse_string("abc", parse_all=True)
except pp.ParseException as e:
    bad = [e.loc, e.lineno, e.col]
print(json.dumps({"calc": ev(expr.parse_string("2 + 3 * (4 - 1) / 2", parse_all=True)[0]), "kv": kv.parse_string("a=1 b=x2 c=3").as_dict(), "bad": bad}))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/pyparsing_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/pyparsing_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.calc, 6.5, o);
  assert.deepEqual(out.kv, { a: '1', b: 'x2', c: '3' }, o);
  assert.deepEqual(out.bad, [0, 1, 1], o);
  console.log(`pyparsing on wasix-python ${python}: infix_notation arithmetic, Dict of Groups, ParseException location`);
}
