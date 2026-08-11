# RAVEHEADS

Wearable collective-motion interface for interactive audio performance.
Each headset streams live head-orientation (yaw/pitch/roll) over a wireless
mesh to a central hub, which forwards the data to a desktop dashboard for
live monitoring, 3D visualization, and timed recording sessions synced to
audio playback.

## How it works

```
[ Headset 1 ]  ─┐
[ Headset 2 ]  ─┤   ESP-NOW (wireless)   ┌─────────┐   USB Serial   ┌───────────────┐
[ Headset 3 ]  ─┼───────────────────────▶│   Hub   │───────────────▶│  Dashboard    │
[ Headset N ]  ─┘                        │ (ESP32) │                │ (Python/Flask)│
                                          └─────────┘                └───────────────┘
```

- **Headsets** (`Arduino/sender.ino`): M5 Atom + BNO08x IMU. Reads stabilized
  orientation as a quaternion, converts it to yaw/pitch/roll, and unicasts it
  to the hub over ESP-NOW roughly every 20ms.
- **Hub** (`Arduino/hub.ino`): any ESP32. Receives packets from all headsets
  (star topology, auto-registers new peers by MAC address), and forwards each
  packet to a connected PC over USB serial using a simple framed protocol
  (`0xAA 0x55 <len> <payload> <crc8>`).
- **Dashboard** (`dashboard/`): local Python web app. Reads the hub's serial
  stream, and provides:
  - a **Global** page — live status of every connected headset, plus
    aggregated mean/dispersion of orientation across all of them
  - a **per-device** page for each headset — live yaw/pitch/roll readout,
    rolling chart, and a 3D visualization of head orientation (supports a
    custom `.glb` model, falls back to a placeholder shape if none is set)
  - **timed recording sessions**: 30s pre-roll → auto-plays a chosen audio
    track → 30s post-roll, then auto-downloads a combined CSV of everything
    recorded during that window
  - a **simulate mode** for testing/demoing without any hardware connected

## Repo structure

```
Arduino/
  sender.ino       Headset firmware (IMU read + ESP-NOW send)
  hub.ino           Hub firmware (ESP-NOW receive + USB serial forward)
dashboard/
  server/
    app.py          Flask + Flask-SocketIO backend, session timing, CSV export
    serial_link.py  Hub serial protocol framing/CRC/parsing
  static/
    index.html      Dashboard shell
    js/app.js        Frontend logic (charts, 3D view, session control)
    js/vendor/        Bundled Chart.js / Three.js / Socket.IO / GLTFLoader
                       (no internet connection needed to run the dashboard)
    audio/            Place audio_1.wav .. audio_5.wav here for session playback
    models/           Place a custom head.glb here for the 3D view
  requirements.txt
```

## Getting started

### 1. Flash the firmware

- Open `Arduino/sender.ino` in the Arduino IDE, set `NODE_ID` uniquely per
  headset, set `HUB_MAC` to your hub's WiFi MAC address, and flash to each
  M5 Atom headset (needs a BNO08x IMU wired to the configured I2C pins).
- Open `Arduino/hub.ino` and flash to a separate ESP32 acting as the hub.
  Note its MAC address from the Serial Monitor on first boot — that's the
  `HUB_MAC` each sender needs.

### 2. Run the dashboard

```bash
cd dashboard
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cd server
python app.py
```

Open `http://localhost:5000`. Connect to the hub's serial port from the
sidebar (or click **Simulate** to try it with fake data first).

## Data protocol

Wire format from hub to PC (per packet):

```
0xAA 0x55 <len:1 byte> <payload: len bytes> <crc8:1 byte>
```

Payload (`NodePayload`, 17 bytes):

```c
uint8_t  nodeId;
uint32_t timestamp_ms;
float    yaw;
float    pitch;
float    roll;
```

CRC-8, polynomial `0x07`, init `0x00`.

## CSV output

One row per received sample during a recording session, long format:

```
session_id, elapsed_s, node_timestamp_ms, node_id, yaw, pitch, roll, seq
```

`elapsed_s` is seconds since the session's pre-roll started (`t=0`), so the
audio starts at `t≈30`.

## Status / known limitations

- Recording sessions currently assume the person is present at the machine
  to select an audio track and press Start.
- The dashboard's aggregate "dispersion" metric on the Global page is a
  simple yaw standard deviation — IE  a placeholder for whatever ends up being used for analysis.
- 3D visualization is orientation-only (no position tracking).
