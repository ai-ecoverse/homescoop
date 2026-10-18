const SCRIPT = String.raw`
import json, kiwisolver as kiwi
from kiwisolver import Solver, Variable, strength
out = {"version": kiwi.__version__, "strengths": [strength.weak, strength.medium, strength.strong, strength.required]}
left, width, right, mid = Variable("left"), Variable("width"), Variable("right"), Variable("mid")
s = Solver()
c_right = right == left + width
for c in [left >= 0, c_right, mid == (left + right) / 2, (width >= 100) | "strong", (width == 300) | "weak", right <= 500]:
    s.addConstraint(c)
s.addEditVariable(left, "strong")
s.suggestValue(left, 150)
s.updateVariables()
out["solved"] = [v.value() for v in (left, width, right, mid)]
out["has"] = [s.hasConstraint(c_right), s.hasEditVariable(left)]
e = c_right.expression()
out["constraint"] = [c_right.op(), c_right.strength(), c_right.violated(), e.constant() + 0.0, round(e.value(), 6) + 0.0]
out["terms"] = sorted([t.variable().name(), t.coefficient(), t.value()] for t in e.terms())
t = 2 * width
out["term"] = [t.variable().name(), t.coefficient(), t.value()]
x = Variable("x")
x.setContext({"k": 1})
out["variable"] = [x.name(), x.context(), x.value(), (x + 1).value()]
out["dumps"] = "Edit Variables" in s.dumps()
s.reset()
out["reset"] = s.hasConstraint(c_right)
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/kiwi_solver.py', SCRIPT);
  const r = await run(['python3', '/tmp/kiwi_solver.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.version, '1.5.1', o);
  assert.deepEqual(out.strengths, [1, 1000, 1000000, 1001001000], o);
  assert.deepEqual(out.solved, [150, 300, 450, 300], `left 150 (edit), width 300 (weak), right 450, mid 300: ${o}`);
  assert.deepEqual(out.has, [true, true], o);
  assert.deepEqual(out.constraint, ['==', 1001001000, false, 0, 0], o);
  assert.deepEqual(out.terms, [['left', -1, -150], ['right', 1, 450], ['width', -1, -300]], o);
  assert.deepEqual(out.term, ['width', 2, 600], o);
  assert.deepEqual(out.variable, ['x', { k: 1 }, 0, 1], o);
  assert.equal(out.dumps, true, o);
  assert.equal(out.reset, false, o);
  console.log('kiwisolver: Solver with strong/weak/required constraints and an edit variable gives left 150 width 300 right 450 mid 300; every METH_NOARGS method (value, name, context, updateVariables, reset, dumps, expression, op, strength, violated, terms, constant, variable, coefficient) and the strength getters answer');
}
