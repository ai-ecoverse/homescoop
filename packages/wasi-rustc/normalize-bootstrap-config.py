#!/usr/bin/env python3
"""Normalize the generated LLVM config for the Rust 1.83 bootstrap schema."""

import argparse
import re
import tomllib
from pathlib import Path


def normalize(source: str, keep_names: bool) -> str:
    lines = source.splitlines(keepends=True)
    result: list[str] = []
    table = ""
    found_rust = False

    for line in lines:
        header = re.match(r"^\[([^]]+)\]\s*$", line)
        if header:
            table = header.group(1)
            result.append(line)
            if table == "rust":
                found_rust = True
                if keep_names:
                    result.extend(["strip = false\n", "debuginfo-level = 0\n"])
            continue

        key = re.match(r"^\s*([\w-]+)\s*=", line)
        if key:
            name = key.group(1)
            if table.startswith("target.") and name in {"strip", "rustflags"}:
                continue
            if table == "rust" and keep_names and name in {"strip", "debuginfo-level"}:
                continue
        result.append(line)

    if not found_rust and keep_names:
        result.extend(["\n[rust]\n", "strip = false\n", "debuginfo-level = 0\n"])

    normalized = "".join(result)
    config = tomllib.loads(normalized)
    if keep_names:
        assert config["rust"]["strip"] is False
    for target in config.get("target", {}).values():
        assert "strip" not in target and "rustflags" not in target
    return normalized


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--keep-names", action="store_true")
    args = parser.parse_args()
    args.config.write_text(normalize(args.config.read_text(), args.keep_names))
