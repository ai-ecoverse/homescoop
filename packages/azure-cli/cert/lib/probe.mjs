// A probe in az's own process, as an az extension (written straight into
// <config dir>/cliextensions, the layout az extension add leaves): az runs
// it with the sys.path bin/az made, so it sees exactly the modules az's
// commands see.
//   az certprobe where           -> {module: its file} for az's native
//                                   modules and some of its own, and sys.path
//   az certprobe seal --public-key <base64> --value <text>
//                                -> appservice's _encrypt_github_actions_secret
//                                   (the PyNaCl sealed box az webapp
//                                   deployment github-actions add sends to
//                                   GitHub), {"encrypted_value": <base64>}
const INIT = `from azure.cli.core import AzCommandsLoader


class CertProbeLoader(AzCommandsLoader):
    def __init__(self, cli_ctx=None):
        from azure.cli.core.commands import CliCommandType
        super().__init__(cli_ctx=cli_ctx, custom_command_type=CliCommandType(operations_tmpl="azext_certprobe#{}"))

    def load_command_table(self, args):
        with self.command_group("certprobe") as g:
            g.custom_command("where", "where")
            g.custom_command("seal", "seal")
        return self.command_table

    def load_arguments(self, command):
        pass


COMMAND_LOADER_CLS = CertProbeLoader

MODULES = ["cryptography", "cryptography.hazmat.bindings._rust", "_cffi_backend", "cffi", "pycparser", "nacl", "nacl._sodium",
           "bcrypt", "OpenSSL", "paramiko", "fabric", "invoke", "scp", "sshtunnel", "yaml", "knack"]


def where():
    import importlib
    import sys
    out = {}
    for name in MODULES:
        try:
            out[name] = importlib.import_module(name).__file__
        except ImportError as e:
            out[name] = f"ImportError: {e}"
    return {"modules": out, "path": sys.path}


def seal(public_key, value):
    from azure.cli.command_modules.appservice.custom import _encrypt_github_actions_secret
    return {"encrypted_value": _encrypt_github_actions_secret(public_key=public_key, secret_value=value)}
`;

export async function installProbe(ctx, configDir) {
  const ext = `${configDir}/cliextensions/certprobe`;
  await ctx.write(`${ext}/azext_certprobe/__init__.py`, INIT);
  await ctx.write(`${ext}/azext_certprobe/azext_metadata.json`, '{"azext.minCliCoreVersion": "2.0.0"}');
  await ctx.write(`${ext}/certprobe-0.1.0.dist-info/METADATA`, 'Metadata-Version: 2.1\nName: certprobe\nVersion: 0.1.0\nSummary: cert probe\n');
  await ctx.write(`${ext}/certprobe-0.1.0.dist-info/top_level.txt`, 'azext_certprobe\n');
}
