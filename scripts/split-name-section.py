#!/usr/bin/env python3
"""Move a wasm module's `name` custom section into a sidecar file.

    split-name-section.py IN.wasm OUT.wasm OUT.names [--strip-debug]

OUT.wasm is IN.wasm without its `name` section (and, with --strip-debug,
without its `.debug_*` sections); every other section stays, in its order.
OUT.names is the `name` section's payload: the bytes after the section's
own name, as SLICC reads a sidecar to name a trap's frames under
SLICC_WASM_BACKTRACE=1 (`<module>.names` beside the module, or at the same
path in an optional `<package>-names` package).

The split is checked before anything is written: putting the payload back as
a `name` section where it was (into IN.wasm less that section) must give
IN.wasm again, byte for byte. It fails when IN.wasm has no `name` section.
"""
import sys


def leb(data: bytes, at: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = data[at]
        at += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if byte < 0x80:
            return value, at


def enc_leb(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def sections(data: bytes):
    """(id, custom name or None, start, payload start, end) of each section."""
    if data[:8] != b"\0asm\x01\0\0\0":
        raise SystemExit("not a wasm module (version 1)")
    at = 8
    while at < len(data):
        start = at
        sid = data[at]
        size, body = leb(data, at + 1)
        end = body + size
        name = payload = None
        if sid == 0:
            length, s = leb(data, body)
            name = data[s : s + length].decode("utf-8")
            payload = s + length
        yield sid, name, start, payload if payload is not None else body, end
        at = end


def custom_section(name: str, payload: bytes) -> bytes:
    encoded = name.encode("utf-8")
    body = enc_leb(len(encoded)) + encoded + payload
    return b"\0" + enc_leb(len(body)) + body


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    strip_debug = "--strip-debug" in argv
    if len(args) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    src, out_wasm, out_names = args
    data = open(src, "rb").read()
    without_names = bytearray(data[:8])  # every section but `name`: the round-trip check
    out = bytearray(data[:8])  # what is written: also without .debug_* under --strip-debug
    names = None
    names_at = None  # where the name section was, in `without_names`
    dropped_debug = 0
    for sid, name, start, payload, end in sections(data):
        if sid == 0 and name == "name":
            if names is not None:
                raise SystemExit(f"{src}: two `name` sections")
            names = data[payload:end]
            names_at = len(without_names)
            continue
        without_names += data[start:end]
        if strip_debug and sid == 0 and name.startswith(".debug_"):
            dropped_debug += end - start
            continue
        out += data[start:end]
    if names is None:
        raise SystemExit(f"{src}: no `name` section to split")
    rebuilt = (
        bytes(without_names[:names_at])
        + custom_section("name", names)
        + bytes(without_names[names_at:])
    )
    if rebuilt != data:
        raise SystemExit(f"{src}: the split does not round-trip")
    with open(out_wasm, "wb") as f:
        f.write(out)
    with open(out_names, "wb") as f:
        f.write(names)
    print(
        f"{src}: {len(data)} -> {len(out)} bytes; names {len(names)} bytes -> {out_names}"
        + (f"; dropped {dropped_debug} bytes of .debug_*" if strip_debug else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
