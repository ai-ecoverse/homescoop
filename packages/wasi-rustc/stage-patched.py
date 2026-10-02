#!/usr/bin/env python3
"""Stage a rustc CI artifact as the wasi-rustc npm package."""

import argparse
import json
import shutil
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PACKAGE = ROOT / "package"
TARGET_PREFIX = "lib/rustlib/wasm32-wasip1/"


def stage(artifact: Path, expected_version: str) -> None:
    metadata = json.loads((PACKAGE / "package.json").read_text())
    if metadata["version"] != expected_version:
        raise ValueError(f"package metadata version is not {expected_version}")

    with tarfile.open(artifact, "r:gz") as archive:
        members = archive.getmembers()
        names = [member.name.removeprefix("./") for member in members]
        for member, name in zip(members, names, strict=True):
            if Path(name).is_absolute() or ".." in Path(name).parts:
                raise ValueError(f"invalid artifact path: {name}")
            if not member.isdir() and not member.isfile():
                raise ValueError(f"artifact contains a link or special entry: {name}")
        if "bin/rustc.wasm" not in names or not any(
            name.startswith(TARGET_PREFIX) and member.isfile()
            for member, name in zip(members, names, strict=True)
        ):
            raise ValueError("artifact lacks rustc.wasm or wasm32-wasip1 rustlib")

        rustlib = PACKAGE / "lib" / "rustlib"
        if rustlib.exists():
            shutil.rmtree(rustlib)
        rustlib.mkdir(parents=True)
        (PACKAGE / "bin").mkdir(parents=True, exist_ok=True)

        for member, name in zip(members, names, strict=True):
            if name == "bin/rustc.wasm":
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError("missing compiler bytes")
                with source, (PACKAGE / "bin" / "rustc.wasm").open("wb") as target:
                    shutil.copyfileobj(source, target)
            elif name.startswith(TARGET_PREFIX):
                relative = Path(name.removeprefix(TARGET_PREFIX))
                destination = rustlib / "wasm32-wasip1" / relative
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    source = archive.extractfile(member)
                    if source is None:
                        raise ValueError(f"missing rustlib bytes: {name}")
                    with source, destination.open("wb") as target:
                        shutil.copyfileobj(source, target)
    driver = PACKAGE / "bin" / "rustc"
    shutil.copyfile(ROOT / "rustc-driver.sh", driver)
    driver.chmod(0o755)
    print(f"staged {metadata['name']}@{metadata['version']} from {artifact}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--expected-version", required=True)
    args = parser.parse_args()
    stage(args.artifact, args.expected_version)
