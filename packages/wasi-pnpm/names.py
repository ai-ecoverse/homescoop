#!/usr/bin/env python3
"""pnpm.wasm's real function names, renumbered for the instrumented module.

    names.py LINKED.wasm INSTRUMENTED.wasm OUT.wasm OUT.names

LINKED.wasm is what cargo links (built with CARGO_PROFILE_RELEASE_STRIP=debuginfo,
so wasm-ld writes a `name` section with the Rust symbols). INSTRUMENTED.wasm
is what pnpm/wasm/build.mjs makes of it: a wasm2wat / wat2wasm round trip that
puts pnpm_atomic's wait32 and wait64 imports in front of every other import
and, with wat2wasm --debug-names, a `name` section of generated names only
(`f4998`). That shifts every function index by the two new imports.

OUT.wasm is INSTRUMENTED.wasm without its `name` section. OUT.names is the
payload of a `name` section for OUT.wasm: LINKED's function names (and its
global and data segment names) with each function index moved by the
imports build.mjs added, plus names for those imports. SLICC reads it as a
sidecar (`bin/pnpm.wasm.names` in @ai-ecoverse/wasi-pnpm-names) to name a
trap's frames under SLICC_WASM_BACKTRACE=1. It only does so when the module
itself has no `name` section, which is why OUT.wasm drops the generated one.

Before writing, it checks that the two modules agree on everything else that
the names depend on: the instrumented imports are LINKED's imports with the
new function imports in front, the defined function, global and data segment
counts are equal, each named function's type is the same in both modules
once the index is shifted, and the exported C functions (_start, malloc,
free, wasi_thread_start, __wasm_init_tls) carry their own names at their
instrumented indices.
"""
import sys


def leb(data, at):
    value = shift = 0
    while True:
        byte = data[at]
        at += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if byte < 0x80:
            return value, at


def sleb(data, at):
    value = shift = 0
    while True:
        byte = data[at]
        at += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if byte < 0x80:
            if byte & 0x40:
                value -= 1 << shift
            return value, at


def enc(value):
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def name_bytes(text):
    raw = text.encode("utf-8") if isinstance(text, str) else text
    return enc(len(raw)) + raw


def sections(data):
    if data[:8] != b"\0asm\x01\0\0\0":
        raise SystemExit("not a wasm module (version 1)")
    at = 8
    while at < len(data):
        start = at
        sid = data[at]
        size, body = leb(data, at + 1)
        end = body + size
        name = None
        payload = body
        if sid == 0:
            length, s = leb(data, body)
            name = data[s : s + length].decode("utf-8")
            payload = s + length
        yield sid, name, start, payload, end
        at = end


def limits(data, at):
    flags = data[at]
    _, at = leb(data, at + 1)
    if flags & 1:
        _, at = leb(data, at)
    return at


def valtype(data, at):
    # numeric, vector and reference types are one byte; (ref null? ht) two+
    t = data[at]
    if t in (0x63, 0x64):
        _, at = sleb(data, at + 1)
        return at
    return at + 1


def parse(path):
    data = open(path, "rb").read()
    mod = {"data": data, "imports": [], "func_types": [], "globals": 0,
           "datas": 0, "types": [], "name": None, "exports": {}}
    for sid, name, start, payload, end in sections(data):
        if sid == 0 and name == "name":
            mod["name"] = (start, end, data[payload:end])
        elif sid == 1:
            count, at = leb(data, payload)
            for _ in range(count):
                begin = at
                form = data[at]
                if form != 0x60:
                    raise SystemExit(f"{path}: type form {form:#x} not handled")
                n, at = leb(data, at + 1)
                for _ in range(n):
                    at = valtype(data, at)
                n, at = leb(data, at)
                for _ in range(n):
                    at = valtype(data, at)
                mod["types"].append(data[begin:at])
        elif sid == 2:
            count, at = leb(data, payload)
            for _ in range(count):
                begin = at
                n, at = leb(data, at)
                module = data[at : at + n]
                at += n
                n, at = leb(data, at)
                field = data[at : at + n]
                at += n
                kind = data[at]
                at += 1
                if kind == 0:
                    t, at = leb(data, at)
                    mod["imports"].append(("func", module, field, mod["types"][t]))
                    continue
                if kind == 1:
                    at = valtype(data, at)
                    at = limits(data, at)
                elif kind == 2:
                    at = limits(data, at)
                elif kind == 3:
                    at = valtype(data, at) + 1
                elif kind == 4:
                    at = at + 1
                    _, at = leb(data, at)
                else:
                    raise SystemExit(f"{path}: import kind {kind} not handled")
                mod["imports"].append(("other", module, field, data[begin:at]))
        elif sid == 3:
            count, at = leb(data, payload)
            for _ in range(count):
                t, at = leb(data, at)
                mod["func_types"].append(mod["types"][t])
        elif sid == 6:
            mod["globals"], _ = leb(data, payload)
        elif sid == 7:
            count, at = leb(data, payload)
            for _ in range(count):
                n, at = leb(data, at)
                field = data[at : at + n]
                at += n
                kind = data[at]
                index, at = leb(data, at + 1)
                if kind == 0:
                    mod["exports"][field] = index
        elif sid == 11:
            mod["datas"], _ = leb(data, payload)
    return mod


def func_imports(mod):
    return [i for i in mod["imports"] if i[0] == "func"]


def subsections(payload):
    at = 0
    out = []
    while at < len(payload):
        sid = payload[at]
        size, body = leb(payload, at + 1)
        out.append((sid, payload[body : body + size]))
        at = body + size
    return out


def name_map(body):
    count, at = leb(body, 0)
    entries = []
    for _ in range(count):
        index, at = leb(body, at)
        n, at = leb(body, at)
        entries.append((index, body[at : at + n]))
        at += n
    if at != len(body):
        raise SystemExit("name map: trailing bytes")
    return entries


def encode_map(entries):
    out = bytearray(enc(len(entries)))
    for index, text in entries:
        out += enc(index) + name_bytes(text)
    return bytes(out)


def main(argv):
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    linked_path, inst_path, out_wasm, out_names = argv
    linked = parse(linked_path)
    inst = parse(inst_path)
    if linked["name"] is None:
        raise SystemExit(f"{linked_path}: no `name` section (build with CARGO_PROFILE_RELEASE_STRIP=debuginfo)")
    lf, nf = func_imports(linked), func_imports(inst)
    delta = len(nf) - len(lf)
    added = inst["imports"][:delta]
    if delta < 0 or any(i[0] != "func" or i[1] != b"pnpm_atomic" for i in added):
        raise SystemExit(f"{inst_path}: the imports in front aren't pnpm_atomic functions")
    if inst["imports"][delta:] != linked["imports"]:
        raise SystemExit(f"{inst_path}: its other imports aren't {linked_path}'s, in order")
    for what in ("func_types", "globals", "datas"):
        if inst[what] != linked[what]:
            raise SystemExit(f"{inst_path}: its {what} differ from {linked_path}'s")
    linked_sigs = [i[3] for i in lf] + linked["func_types"]
    inst_sigs = [i[3] for i in nf] + inst["func_types"]

    kept = []
    functions = 0
    for sid, body in subsections(linked["name"][2]):
        if sid == 1:
            entries = []
            for index, text in name_map(body):
                if linked_sigs[index] != inst_sigs[index + delta]:
                    raise SystemExit(f"function {index}: its type differs after the shift")
                entries.append((index + delta, text))
            front = [(i, b"pnpm_atomic." + added[i][2]) for i in range(delta)]
            kept.append((1, encode_map(front + entries)))
            functions = len(entries)
        elif sid in (7, 9):  # global and data segment names: no index moved
            kept.append((sid, body))
    if not functions:
        raise SystemExit(f"{linked_path}: no function names")
    # The C functions pnpm.wasm exports are named after themselves: each one
    # must carry its own name at its index in the instrumented module.
    final = dict(name_map(dict(kept)[1]))
    checked = 0
    for export in (b"_start", b"malloc", b"free", b"wasi_thread_start", b"__wasm_init_tls"):
        index = inst["exports"].get(export)
        if index is None:
            continue
        if final.get(index) != export:
            raise SystemExit(f"export {export.decode()} is function {index}, but the names say {final.get(index)!r}")
        checked += 1
    if checked < 3:
        raise SystemExit(f"{inst_path}: only {checked} exported functions to check the names against")
    payload = b"".join(bytes([sid]) + enc(len(body)) + body for sid, body in kept)

    data = inst["data"]
    if inst["name"] is None:
        stripped = data
    else:
        start, end, _ = inst["name"]
        stripped = data[:start] + data[end:]
    with open(out_wasm, "wb") as f:
        f.write(stripped)
    with open(out_names, "wb") as f:
        f.write(payload)
    print(f"{inst_path}: {len(data)} -> {len(stripped)} bytes; {functions} function names "
          f"(+{delta} imports) from {linked_path}, {len(payload)} bytes -> {out_names}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
