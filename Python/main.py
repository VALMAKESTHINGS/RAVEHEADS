import serial
from pythonosc.udp_client import SimpleUDPClient

SERIAL_PORT = "COM4"   # adapt
BAUD = 115200

MAX_IP = "127.0.0.1"
MAX_PORT = 8000

ser = serial.Serial(SERIAL_PORT, BAUD, timeout=1)
osc = SimpleUDPClient(MAX_IP, MAX_PORT)

print("Bridge running...")

while True:
    line = ser.readline().decode(errors="ignore").strip()
    if not line:
        continue

    print("RAW:", line)   # debug incoming serial

    try:
        nodeId, yaw, pitch, roll, ts = line.split(",")

        nodeId = int(nodeId)
        yaw = float(yaw)
        pitch = float(pitch)
        roll = float(roll)
        ts = int(ts)

        msg = [nodeId, yaw, pitch, roll, ts]

        osc.send_message("/imu", msg)

        print("OSC → /imu", msg)

    except Exception as e:
        print("PARSE ERROR:", e, "LINE:", line)
