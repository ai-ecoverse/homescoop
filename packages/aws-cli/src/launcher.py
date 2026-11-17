#!/usr/bin/env -S python3 -S
"""aws and aws_completer for slicc: the AWS CLI v2 on wasix-python (homescoop#2115).

AWS's launchers are bin/aws and bin/aws_completer of its source tree, which
import awscli from the interpreter's path. This script runs them on
wasix-python, the interpreter it runs on, from lib/aws-cli/bin. It is
installed twice, as bin/aws and bin/aws_completer, and picks the tool by its
own file name.

  - The AWS CLI and its pure-Python dependencies are in lib/aws-cli, which
    goes first on sys.path. The shebang runs python3 -S, so wasix-python's
    site-packages (and any .pth file there) are never read; run another way
    (python3 bin/aws), site-packages are dropped from sys.path here. A py-*
    package installed beside this one can't shadow the CLI's own copies.
  - The kernel's proxy terminates TLS with its own CA, which it names in
    SSL_CERT_FILE. botocore trusts only its own bundle (botocore/cacert.pem)
    unless told otherwise, so AWS_CA_BUNDLE defaults to SSL_CERT_FILE when
    that file exists. A value of your own wins.
  - No pager by default: upstream pipes output on a terminal to `less`,
    which slicc doesn't have unless you install it. AWS_PAGER, cli_pager in
    ~/.aws/config and PAGER still choose one, as upstream.
"""
import os
import runpy
import sys

PACKAGE = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
LIB = os.path.join(PACKAGE, "lib", "aws-cli")
TOOLS = ("aws", "aws_completer")


def main():
    tool = os.path.basename(__file__)
    if tool not in TOOLS:
        sys.exit(f"{tool}: this launcher runs only as {' or '.join(TOOLS)}")
    if not sys.flags.no_site:
        sys.path[:] = [p for p in sys.path if "site-packages" not in p]
    sys.path.insert(0, LIB)
    ca = os.environ.get("SSL_CERT_FILE")
    if ca and os.path.isfile(ca):
        os.environ.setdefault("AWS_CA_BUNDLE", ca)
    if tool == "aws":
        import awscli.clidriver

        # The end of the pager chain (AWS_PAGER, cli_pager, PAGER, then
        # this): no pager, rather than `less`.
        awscli.clidriver.default_pager = ""
    script = os.path.join(LIB, "bin", tool)
    sys.argv[0] = script
    runpy.run_path(script, run_name="__main__")


if __name__ == "__main__":
    main()
