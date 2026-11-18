import select
import sys
import time

import serial

PORT = sys.argv[1]
s = serial.Serial(PORT, 115200, timeout=2)
print("open", s.is_open, s.name, s.baudrate, flush=True)
s.write(b"hello")
s.flush()
print("read", s.read(5), flush=True)
s.dtr = False
s.rts = True
print("lines", s.cts, s.dsr, s.cd, s.ri, flush=True)
s.write(b"xyz")
s.flush()
deadline = time.monotonic() + 2
while s.in_waiting < 3 and time.monotonic() < deadline:
    time.sleep(0.01)
print("in_waiting", s.in_waiting, "out_waiting", s.out_waiting, flush=True)
r, _, _ = select.select([s.fileno()], [], [], 1)
print("select readable", bool(r), flush=True)
s.reset_input_buffer()
print("after reset_input_buffer", s.in_waiting, flush=True)
s.reset_output_buffer()
s.send_break(0.1)
s.break_condition = True
s.break_condition = False
s.baudrate = 460800
s.bytesize = serial.SEVENBITS
s.parity = serial.PARITY_EVEN
s.stopbits = serial.STOPBITS_TWO
s.dtr = True
s.write(b"again")
print("read again", s.read(5), flush=True)
s.close()
print("pyserial done", flush=True)
