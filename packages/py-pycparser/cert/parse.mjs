const SCRIPT = String.raw`
import json
from pycparser import c_ast, c_generator, c_parser
src = """
typedef unsigned int u32;
struct point { int x; int y; };
int add(int a, int b) { return a + b; }
u32 hash(const char *s, unsigned long n);
static const double scale[3] = {1.0, 2.5, -4.0};
int (*callback)(void *ctx, int code);
"""
ast = c_parser.CParser().parse(src, filename="<cert>")
kinds = [type(e).__name__ for e in ast.ext]
class Funcs(c_ast.NodeVisitor):
    def __init__(self):
        self.defs, self.calls = [], []
    def visit_FuncDef(self, node):
        self.defs.append([node.decl.name, [p.name for p in node.decl.type.args.params]])
        self.generic_visit(node)
v = Funcs(); v.visit(ast)
out = {
    "kinds": kinds,
    "defs": v.defs,
    "typedef": ast.ext[0].name,
    "struct": [d.name for d in ast.ext[1].type.decls],
    "hash_args": [type(p.type).__name__ for p in ast.ext[3].type.args.params],
    "fnptr": type(ast.ext[5].type).__name__,
    "regen": c_generator.CGenerator().visit(ast.ext[2]).split(),
}
try:
    c_parser.CParser().parse("int f( {", filename="<bad>")
    out["error"] = None
except Exception as e:
    out["error"] = type(e).__name__ + ": " + str(e)
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/pycparser_parse.py', SCRIPT);
  const r = await run(['python3', '/tmp/pycparser_parse.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.kinds, ['Typedef', 'Decl', 'FuncDef', 'Decl', 'Decl', 'Decl'], o);
  assert.deepEqual(out.defs, [['add', ['a', 'b']]], o);
  assert.equal(out.typedef, 'u32', o);
  assert.deepEqual(out.struct, ['x', 'y'], o);
  assert.deepEqual(out.hash_args, ['PtrDecl', 'TypeDecl'], o);
  assert.equal(out.fnptr, 'PtrDecl', o);
  assert.deepEqual(out.regen, ['int', 'add(int', 'a,', 'int', 'b)', '{', 'return', 'a', '+', 'b;', '}'], o);
  assert.match(out.error ?? '', /^ParseError: <bad>:1:/, o);
  console.log('pycparser: parses a typedef, a struct, a function definition, a prototype, an initialised array and a function pointer; NodeVisitor and CGenerator round-trip add(); a syntax error is a ParseError with its location');
}
