#!/usr/bin/env python3
"""Tiny SSH server that accepts authentication method 'none'.

Host-only cert harness helper. OpenSSH's sshd cannot grant a real account via
'none' without hacks; this process speaks enough of the protocol for the
wasix-openssh client cert (paramiko).

Usage:
  python3 none-auth-server.py --host 127.0.0.1 --port 0 --host-key /tmp/host_rsa
  # prints the bound port on stdout as: PORT=<n>
"""
from __future__ import annotations

import argparse
import socket
import sys
import threading

import paramiko


class NoneAuthServer(paramiko.ServerInterface):
    def check_auth_none(self, username: str) -> int:
        return paramiko.AUTH_SUCCESSFUL

    def get_allowed_auths(self, username: str) -> str:
        return "none"

    def check_channel_request(self, kind: str, chanid: int) -> int:
        if kind == "session":
            return paramiko.OPEN_SUCCEEDED
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_exec_request(self, channel: paramiko.Channel, command: str) -> bool:
        # Echo a fixed marker; cert compares stdout.
        channel.sendall(b"none-ok\n")
        channel.send_exit_status(0)
        channel.close()
        return True

    def check_channel_shell_request(self, channel: paramiko.Channel) -> bool:
        channel.sendall(b"none-shell\n")
        channel.send_exit_status(0)
        channel.close()
        return True


def handle(client: socket.socket, host_key: paramiko.PKey) -> None:
    try:
        transport = paramiko.Transport(client)
        transport.add_server_key(host_key)
        transport.start_server(server=NoneAuthServer())
        channel = transport.accept(20)
        if channel is not None:
            channel.recv_exit_status()
        transport.close()
    except Exception as exc:  # noqa: BLE001 — cert helper; log and drop
        print(f"none-auth-server: {exc}", file=sys.stderr)
    finally:
        try:
            client.close()
        except OSError:
            pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--host-key", required=True, help="path to write/load RSA host key")
    args = ap.parse_args()

    try:
        host_key = paramiko.RSAKey(filename=args.host_key)
    except (OSError, paramiko.SSHException):
        host_key = paramiko.RSAKey.generate(2048)
        host_key.write_private_key_file(args.host_key)

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((args.host, args.port))
    sock.listen(8)
    port = sock.getsockname()[1]
    print(f"PORT={port}", flush=True)

    while True:
        client, _addr = sock.accept()
        threading.Thread(target=handle, args=(client, host_key), daemon=True).start()


if __name__ == "__main__":
    raise SystemExit(main())
