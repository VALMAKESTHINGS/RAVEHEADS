"""
serial_link.py
Reads the framed serial protocol emitted by Receiver.ino (hub):

    0xAA 0x55 <len:uint8> <payload: len bytes> <crc8:uint8>

crc8 is polynomial 0x07, init 0x00 (matches crc8() in Receiver.ino).

------------------------------------------------------------------------
IMPORTANT — known firmware mismatch (as of Rev1):
Receiver.ino's onRecv() casts the raw ESP-NOW bytes it gets from the
sender directly into its own `NodePayload` struct:

    nodeId(u8) timestamp_ms(u32) yaw(i16) pitch(i16) roll(i16) seqNum(u8)  -> 12 bytes

...but sender.ino actually transmits a *different* struct:

    nodeId(u8) timestamp_ms(u32) yaw(f32) pitch(f32) roll(f32)            -> 17 bytes

These are not the same layout or size, so right now the int16 yaw/pitch/
roll values coming off the hub's serial port are not meaningful physical
angles (they're reinterpreted float bytes). This is a firmware bug to fix
on the ESP32 side, not something the dashboard can correct after the fact.

This module parses whatever the hub is *currently* sending (the 12-byte
NodePayload framing, since that's what send_framed() on the hub emits),
so the dashboard runs against real hardware today. Once you fix the
firmware (recommended: make the hub re-encode/pass through the true
float yaw/pitch/roll, keeping the same 0xAA 0x55 framing), just flip
PAYLOAD_FORMAT below to 'float32' and everything downstream keeps working.
------------------------------------------------------------------------
"""

import struct
import threading
import time
import serial
import serial.tools.list_ports

SYNC0 = 0xAA
SYNC1 = 0x55

# --- Config: pick the struct layout actually on the wire -------------------
# 'int16'   -> matches Receiver.ino's NodePayload (12 bytes) [current default]
# 'float32' -> matches sender.ino's Packet, if you fix the hub to pass this through (17 bytes)
PAYLOAD_FORMAT = "int16"

FORMATS = {
    # struct format, field names, scale applied to yaw/pitch/roll after unpacking
    "int16": ("<BIhhhB", ["nodeId", "timestamp_ms", "yaw", "pitch", "roll", "seqNum"], 1.0),
    "float32": ("<BIfff", ["nodeId", "timestamp_ms", "yaw", "pitch", "roll"], 1.0),
}


def crc8(data: bytes) -> int:
    crc = 0x00
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ 0x07) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
    return crc


def list_serial_ports():
    return [
        {"device": p.device, "description": p.description}
        for p in serial.tools.list_ports.comports()
    ]


class SerialReader:
    """Background thread that opens a serial port, frames incoming bytes,
    validates CRC, decodes the payload, and calls on_packet(dict) for each
    valid packet."""

    def __init__(self, port, baud=115200, on_packet=None, on_status=None):
        self.port_name = port
        self.baud = baud
        self.on_packet = on_packet or (lambda pkt: None)
        self.on_status = on_status or (lambda msg: None)
        self._ser = None
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        if self._ser and self._ser.is_open:
            self._ser.close()

    def _run(self):
        try:
            self._ser = serial.Serial(self.port_name, self.baud, timeout=0.2)
            self.on_status({"connected": True, "port": self.port_name})
        except Exception as e:
            self.on_status({"connected": False, "error": str(e)})
            return

        buf = bytearray()
        fmt, fields, scale = FORMATS[PAYLOAD_FORMAT]
        payload_len = struct.calcsize(fmt)

        while not self._stop.is_set():
            try:
                chunk = self._ser.read(256)
            except Exception as e:
                self.on_status({"connected": False, "error": str(e)})
                break
            if chunk:
                buf.extend(chunk)

            # Look for sync bytes and try to extract a full frame.
            while True:
                idx = buf.find(bytes([SYNC0, SYNC1]))
                if idx == -1:
                    # keep only a tail in case sync is split across reads
                    if len(buf) > 1:
                        del buf[: len(buf) - 1]
                    break
                if idx > 0:
                    del buf[:idx]

                # Need: 2 sync + 1 len + len bytes + 1 crc
                if len(buf) < 3:
                    break
                declared_len = buf[2]
                total_needed = 3 + declared_len + 1
                if len(buf) < total_needed:
                    break  # wait for more bytes

                payload = bytes(buf[3 : 3 + declared_len])
                received_crc = buf[3 + declared_len]
                consumed = total_needed
                del buf[:consumed]

                if declared_len != payload_len:
                    # Frame length doesn't match the format we expect to decode.
                    continue
                if crc8(payload) != received_crc:
                    continue

                try:
                    values = struct.unpack(fmt, payload)
                except struct.error:
                    continue

                pkt = dict(zip(fields, values))
                pkt["yaw"] = float(pkt["yaw"]) * scale
                pkt["pitch"] = float(pkt["pitch"]) * scale
                pkt["roll"] = float(pkt["roll"]) * scale
                pkt["hub_recv_ms"] = time.time() * 1000.0
                self.on_packet(pkt)

        if self._ser and self._ser.is_open:
            self._ser.close()
