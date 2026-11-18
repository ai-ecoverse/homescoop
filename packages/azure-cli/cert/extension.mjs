import { fresh, json, ok, sh } from './lib/az.mjs';

// A pure-Python extension wheel (made here: no network in the cert kernel)
// installs with az extension add --source: az runs wasix-python's pip
// (sys.executable -m pip install --target ~/.azure/cliextensions/<name>), and
// the extension's command runs. az extension remove takes it out again.
const MAKE_WHEEL = `
import zipfile, hashlib, base64, sys
files = {
 "azext_certext/__init__.py": '''from azure.cli.core import AzCommandsLoader
class CertExtLoader(AzCommandsLoader):
    def __init__(self, cli_ctx=None):
        from azure.cli.core.commands import CliCommandType
        super().__init__(cli_ctx=cli_ctx, custom_command_type=CliCommandType(operations_tmpl="azext_certext#{}"))
    def load_command_table(self, args):
        with self.command_group("certext") as g:
            g.custom_command("hello", "hello")
        return self.command_table
    def load_arguments(self, command):
        pass
COMMAND_LOADER_CLS = CertExtLoader
def hello():
    return {"hello": "slicc"}
''',
 "azext_certext/azext_metadata.json": '{"azext.minCliCoreVersion": "2.0.0"}',
 "certext-0.1.0.dist-info/METADATA": "Metadata-Version: 2.1\\nName: certext\\nVersion: 0.1.0\\nSummary: cert\\n",
 "certext-0.1.0.dist-info/WHEEL": "Wheel-Version: 1.0\\nGenerator: cert\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n",
 "certext-0.1.0.dist-info/top_level.txt": "azext_certext\\n",
}
rec = []
with zipfile.ZipFile(sys.argv[1], "w") as z:
    for n, t in files.items():
        b = t.encode(); z.writestr(n, b)
        rec.append(f"{n},sha256={base64.urlsafe_b64encode(hashlib.sha256(b).digest()).rstrip(b'=').decode()},{len(b)}")
    rec.append("certext-0.1.0.dist-info/RECORD,,")
    z.writestr("certext-0.1.0.dist-info/RECORD", "\\n".join(rec) + "\\n")
`;

export default async function (ctx) {
  const { assert } = ctx;
  const cfg = fresh('extension');
  await ctx.write('/root/make-certext.py', MAKE_WHEEL);
  await ok(ctx, 'python3 -I /root/make-certext.py /root/certext-0.1.0-py3-none-any.whl');
  const add = await ok(ctx, `${cfg} az extension add --source /root/certext-0.1.0-py3-none-any.whl --yes`);
  assert.doesNotMatch(add.stderr, /Traceback|ERROR/, add.stderr);
  const list = await json(ctx, `${cfg} az extension list`);
  assert.deepEqual(list.map((e) => [e.name, e.version, e.extensionType, e.path]), [['certext', '0.1.0', 'whl', '/root/.azure-cert-extension/cliextensions/certext']], JSON.stringify(list));
  await ok(ctx, 'test -f /root/.azure-cert-extension/cliextensions/certext/azext_certext/__init__.py');
  assert.deepEqual(await json(ctx, `${cfg} az certext hello`), { hello: 'slicc' });
  assert.deepEqual((await json(ctx, `${cfg} az version`)).extensions, { certext: '0.1.0' });
  await ok(ctx, `${cfg} az extension remove --name certext`);
  const gone = await sh(ctx, `${cfg} az certext hello`);
  assert.equal(gone.status, 2, gone.stderr);
  assert.deepEqual(await json(ctx, `${cfg} az extension list`), []);
  console.log('az extension add --source <wheel>: installed with wasix-python\'s pip into ~/.azure/cliextensions, az certext hello runs, az version lists it; az extension remove');
}
