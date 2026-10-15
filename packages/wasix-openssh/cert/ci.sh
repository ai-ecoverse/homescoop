#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tools="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/wasix-openssh-cert-tools"
mkdir -p "$tools"
have_sshd() { command -v sshd >/dev/null 2>&1 || [[ -x /usr/sbin/sshd ]]; }
have_paramiko() { python3 -c 'import paramiko' >/dev/null 2>&1; }
if ! have_sshd || ! have_paramiko; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)
      mm="$tools/micromamba"
      if [[ ! -x "$mm" ]]; then
        curl -fsSL --retry 5 --retry-all-errors -o "$mm.part" https://github.com/mamba-org/micromamba-releases/releases/download/2.9.0-0/micromamba-linux-64
        echo "366cd9cd8be14df1ab8ed50352a82111082a36686b2d389fdb79a92c3fafb3e3  $mm.part" | sha256sum -c - >&2
        chmod +x "$mm.part" && mv "$mm.part" "$mm"
      fi
      if [[ ! -x "$tools/env/bin/sshd" ]]; then
        MAMBA_ROOT_PREFIX="$tools/mamba" "$mm" create --yes --quiet --prefix "$tools/env" -c conda-forge --override-channels openssh=10.5p1 paramiko=5.0.0 python=3.12 >&2
      fi
      export PATH="$tools/env/bin:$PATH"
      ;;
    *)
      if ! have_paramiko; then
        [[ -x "$tools/venv/bin/python3" ]] || python3 -m venv "$tools/venv" >&2
        "$tools/venv/bin/python3" -m pip install --quiet paramiko >&2
        export PATH="$tools/venv/bin:$PATH"
      fi
      ;;
  esac
fi
echo "wasix-openssh cert: sshd $(command -v sshd || echo /usr/sbin/sshd)" >&2
python3 -c 'import paramiko; print("wasix-openssh cert: paramiko", paramiko.__version__)' >&2
exec node "$here/run.mjs" "$@"
