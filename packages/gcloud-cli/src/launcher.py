#!/usr/bin/env python3
"""gcloud and bq for slicc: Google's launcher scripts, in Python (homescoop#2037).

Google's bin/gcloud and bin/bq are POSIX shell scripts that look for a
Python, set CLOUDSDK_* and exec lib/gcloud.py or bin/bootstrapping/bq.py
with it. This script does the same on wasix-python, the interpreter it runs
on, so the commands need no shell. It is installed twice, as bin/gcloud and
bin/bq, and picks the tool by its own file name.

What it keeps from the shell preamble:
  - CLOUDSDK_ROOT_DIR is the SDK tree in this package (lib/google-cloud-sdk).
  - CLOUDSDK_PYTHON (and CLOUDSDK_BQ_PYTHON) default to this interpreter.
  - Without CLOUDSDK_PYTHON_SITEPACKAGES or a VIRTUAL_ENV, gcloud runs as
    `python -S` would: no site-packages on sys.path here, and -S in
    CLOUDSDK_PYTHON_ARGS for the Pythons it starts (bq.py runs platform/bq
    in a second one). The SDK's vendored libraries in lib/third_party then
    win over any py-* package installed beside it.
  - CLOUDSDK_ENCODING / PYTHONIOENCODING default to UTF-8.

What it adds for slicc:
  - The kernel's proxy terminates TLS with its own CA, which it names in
    SSL_CERT_FILE. gcloud's requests transport finds it in CURL_CA_BUNDLE,
    but bq's httplib2 reads only its own bundle, or the core/custom_ca_certs_file
    property that gcloud hands it as --ca_certificates_file. So
    CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE defaults to SSL_CERT_FILE when that
    file exists.
  - PYTHONWARNINGS gains one filter, for the RequestsDependencyWarning that
    bq's vendored requests prints on every run about its own vendored
    urllib3 and charset_normalizer.
"""
import os
import runpy
import sys

PACKAGE = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
ROOT = os.path.join(PACKAGE, "lib", "google-cloud-sdk")
TOOLS = {
    "gcloud": ("lib", "gcloud.py"),
    "bq": ("bin", "bootstrapping", "bq.py"),
}
# bq's RequestsDependencyWarning (see main), from module requests only.
QUIET = "ignore:urllib3 (:Warning:requests"


def main():
    tool = os.path.basename(__file__)
    if tool not in TOOLS:
        sys.exit(f"{tool}: this launcher runs only as gcloud or bq (have {', '.join(TOOLS)})")
    env = os.environ
    env["CLOUDSDK_ROOT_DIR"] = ROOT
    env.setdefault("CLOUDSDK_PYTHON", sys.executable or "python3")
    env.setdefault("CLOUDSDK_BQ_PYTHON", env["CLOUDSDK_PYTHON"])
    if not env.get("CLOUDSDK_PYTHON_SITEPACKAGES") and not env.get("VIRTUAL_ENV"):
        args = env.get("CLOUDSDK_PYTHON_ARGS", "").split()
        if "-S" not in args:
            args.append("-S")
        env["CLOUDSDK_PYTHON_ARGS"] = " ".join(args)
        sys.path[:] = [p for p in sys.path if "site-packages" not in p]
    ca = env.get("SSL_CERT_FILE")
    if ca and os.path.isfile(ca):
        env.setdefault("CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE", ca)
    env.setdefault("CLOUDSDK_ENCODING", env.get("PYTHONIOENCODING") or "UTF-8")
    env["PYTHONIOENCODING"] = env["CLOUDSDK_ENCODING"]
    # bq's vendored requests warns on every run that its vendored urllib3 and
    # charset_normalizer aren't versions it lists (RequestsDependencyWarning;
    # upstream prints it too). Ignore exactly that warning, from module
    # requests, in the Pythons gcloud starts. It goes after a user's own
    # PYTHONWARNINGS, so it wins only for that one warning.
    if QUIET not in env.get("PYTHONWARNINGS", "").split(","):
        env["PYTHONWARNINGS"] = ",".join(filter(None, [env.get("PYTHONWARNINGS"), QUIET]))

    script = os.path.join(ROOT, *TOOLS[tool])
    sys.argv[0] = script
    sys.path.insert(0, os.path.dirname(script))
    runpy.run_path(script, run_name="__main__")


if __name__ == "__main__":
    main()
