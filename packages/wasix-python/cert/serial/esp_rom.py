import fcntl
import struct
import sys
import time

import serial

PORT = sys.argv[1]
TCGETS2 = 0x802C542A
TCSETS2 = 0x402C542B
TIOCMSET = getattr(serial.serialposix, "TIOCMSET", 0x5418)
BOTHER = 0o010000
CBAUD = 0o010017


def slip(body):
    out = bytearray([0xC0])
    for b in body:
        if b == 0xC0:
            out += b"\xdb\xdc"
        elif b == 0xDB:
            out += b"\xdb\xdd"
        else:
            out.append(b)
    out.append(0xC0)
    return bytes(out)


def frames(s, wait):
    end = time.monotonic() + wait
    buf = bytearray()
    while time.monotonic() < end:
        chunk = s.read(s.in_waiting or 1)
        if chunk:
            buf += chunk
        parts = bytes(buf).split(b"\xc0")
        done = [p for p in parts[1:-1] if p]
        if done:
            out = []
            for p in done:
                out.append(p.replace(b"\xdb\xdc", b"\xc0").replace(b"\xdb\xdd", b"\xdb"))
            return out
    return []


def command(s, op, data=b"", wait=2.0):
    s.write(slip(struct.pack("<BBHI", 0, op, len(data), 0) + data))
    for f in frames(s, wait):
        if len(f) >= 8 and f[0] == 1 and f[1] == op:
            return struct.unpack("<I", f[4:8])[0]
    return None


def sync(s):
    for _ in range(5):
        if command(s, 0x08, b"\x07\x07\x12\x20" + b"\x55" * 32, 1.0) is not None:
            time.sleep(0.1)
            s.reset_input_buffer()
            return True
    return False


def classic_reset(s):
    s.dtr = False
    s.rts = True
    time.sleep(0.1)
    s.dtr = True
    s.rts = False
    time.sleep(0.05)
    s.dtr = False


def tight_reset(s):
    def both(dtr, rts):
        bits = (serial.serialposix.TIOCM_DTR if dtr else 0) | (serial.serialposix.TIOCM_RTS if rts else 0)
        fcntl.ioctl(s.fileno(), TIOCMSET, struct.pack("I", bits))

    both(False, False)
    both(True, True)
    both(False, True)
    time.sleep(0.1)
    both(True, False)
    time.sleep(0.05)
    both(False, False)
    s.dtr = False


def normal_reset(s):
    s.dtr = False
    s.rts = True
    time.sleep(0.1)
    s.rts = False
    time.sleep(0.05)


s = serial.Serial(PORT, 115200, timeout=0.2)
classic_reset(s)
print("classic reset sync", sync(s), flush=True)
print("chip magic", hex(command(s, 0x0A, struct.pack("<I", 0x40001000)) or 0), flush=True)
print("change baud", command(s, 0x0F, struct.pack("<II", 460800, 0)), flush=True)
s.baudrate = 460800
time.sleep(0.05)
print("sync at 460800", sync(s), flush=True)

t2 = bytearray(fcntl.ioctl(s.fileno(), TCGETS2, bytes(44)))
cflag = struct.unpack_from("<I", t2, 8)[0]
struct.pack_into("<I", t2, 8, (cflag & ~CBAUD) | BOTHER)
struct.pack_into("<II", t2, 36, 250000, 250000)
fcntl.ioctl(s.fileno(), TCSETS2, bytes(t2))
back = fcntl.ioctl(s.fileno(), TCGETS2, bytes(44))
print("custom speed", struct.unpack_from("<II", back, 36), flush=True)
print("sync at custom speed", sync(s), flush=True)

normal_reset(s)
print("normal reset sync", sync(s), flush=True)
tight_reset(s)
print("tight reset sync", sync(s), flush=True)
print("mac word", hex(command(s, 0x0A, struct.pack("<I", 0x3FF5A004)) or 0), flush=True)
s.close()
print("esptool calls done", flush=True)
