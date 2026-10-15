#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tools="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/wasix-openssh-cert-tools"
mkdir -p "$tools"
if ! command -v sshd >/dev/null 2>&1 && [[ ! -x /usr/sbin/sshd ]]; then
  if [[ ! -x "$tools/root/usr/sbin/sshd" ]]; then
    (cd "$tools" && apt-get download openssh-server libwrap0 >&2)
    for deb in "$tools"/*.deb; do dpkg -x "$deb" "$tools/root"; done
  fi
  export PATH="$tools/root/usr/sbin:$PATH"
  export LD_LIBRARY_PATH="$tools/root/usr/lib/x86_64-linux-gnu:$tools/root/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
echo "wasix-openssh cert: sshd $(command -v sshd || echo /usr/sbin/sshd)" >&2
if ! python3 -c 'import paramiko' >/dev/null 2>&1; then
  if [[ ! -x "$tools/venv/bin/python3" ]] && ! python3 -m venv "$tools/venv" >&2; then
    rm -rf "$tools/venv"
  fi
  if [[ -x "$tools/venv/bin/python3" ]]; then
    "$tools/venv/bin/python3" -m pip install --quiet paramiko >&2
    export PATH="$tools/venv/bin:$PATH"
  else
    python3 -m pip install --quiet --user --break-system-packages paramiko >&2
  fi
fi
python3 -c 'import paramiko; print("wasix-openssh cert: paramiko", paramiko.__version__)' >&2
exec node "$here/run.mjs" "$@"
