"""Runs many aws commands in one python, for the cert specs.

  python3 -S aws_many.py <bin/aws> <commands.json> <results.json>

<commands.json> is a list of argv lists (without "aws"). Each one runs
through the AWS CLI's own entry point (what awscli.clidriver.main, which
bin/aws runs, does with sys.argv), after the package's launcher has set up sys.path and the environment
(its setup("aws"), run from <bin/aws> itself), with stdout and stderr
captured. <results.json> gets [{"rc", "stdout", "stderr"}, ...]. One python
start for the lot instead of one per command: the cert's real `aws` runs are
in the specs beside this.
"""
import contextlib
import io
import json
import runpy
import sys

launcher = runpy.run_path(sys.argv[1], run_name='aws_many')
launcher['setup']('aws')
from awscli.clidriver import AWSCLIEntryPoint, start_as_current_context  # noqa: E402


def text():
    return io.TextIOWrapper(io.BytesIO(), encoding='utf-8', write_through=True)


results = []
for argv in json.load(open(sys.argv[2])):
    out, err = text(), text()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            with start_as_current_context():
                rc = AWSCLIEntryPoint().main(argv)
        except SystemExit as e:
            rc = e.code if isinstance(e.code, int) else 1
    results.append({
        'rc': rc,
        'stdout': out.buffer.getvalue().decode('utf-8', 'replace'),
        'stderr': err.buffer.getvalue().decode('utf-8', 'replace'),
    })
with open(sys.argv[3], 'w') as f:
    json.dump(results, f)
