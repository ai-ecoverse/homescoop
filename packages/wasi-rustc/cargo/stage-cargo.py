#!/usr/bin/env python3
"""Stage the Cargo wasm artifact into its SLICC package without archive links."""
import argparse
from pathlib import Path, PurePosixPath
import shutil
import tarfile

PACKAGE = Path(__file__).resolve().parent / "package"


def stage(artifact: Path) -> None:
    with tarfile.open(artifact, "r:gz") as archive:
        files = []
        for member in archive.getmembers():
            path = PurePosixPath(member.name.removeprefix("./"))
            if path.is_absolute() or ".." in path.parts:
                raise ValueError(f"invalid artifact path: {member.name}")
            if not (member.isfile() or member.isdir()):
                raise ValueError(f"artifact contains a link or special entry: {member.name}")
            if member.isfile():
                files.append((path, member))
        cargo = [member for path, member in files if path == PurePosixPath("bin/cargo.wasm")]
        if len(cargo) != 1:
            raise ValueError("artifact must contain exactly one bin/cargo.wasm")
        source = archive.extractfile(cargo[0])
        if source is None:
            raise ValueError("cannot read cargo.wasm")
        target = PACKAGE / "bin/cargo.wasm"
        target.parent.mkdir(parents=True, exist_ok=True)
        with source, target.open("wb") as output:
            shutil.copyfileobj(source, output)
    with target.open("rb") as wasm_file:
        magic = wasm_file.read(4)
    if magic != b"\0asm":
        target.unlink(missing_ok=True)
        raise ValueError("cargo.wasm has no wasm magic")
    target.chmod(0o755)
    print(f"staged {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    stage(parser.parse_args().artifact)
