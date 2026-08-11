# RAVEHEADS Dashboard

Local web dashboard for the RAVEHEADS collective-motion headsets: live per-device
monitoring, a global aggregated view, and a timed record session (30s pre-roll →
2-min audio → 30s post-roll) that auto-downloads a CSV when it finishes.

## ⚠️ Firmware issue found while building this

`sender.ino` transmits a `Packet` struct = `{nodeId(u8), timestamp_ms(u32), yaw/pitch/roll(f32 each)}`
(17 bytes). But `Receiver.ino`'s `onRecv()` casts the raw bytes it gets over
ESP-NOW straight into its own `NodePayload` struct = `{nodeId(u8), timestamp_ms(u32),
yaw/pitch/roll(i16 each), seqNum(u8)}` (12 bytes). These structs don't match in
either field layout or size, so the int16 angles currently coming off the hub's
serial port are reinterpreted float bytes, not real angles.

This dashboard parses the **12-byte int16 framing that the hub currently emits**
(`0xAA 0x55 <len> <payload> <crc8>`) so it works against your hardware today —
but the values will be meaningless until the firmware mismatch is fixed. Two ways
to fix it:
1. Make `Receiver.ino` decode the incoming ESP-NOW packet as the real 17-byte
   float `Packet` struct, then re-encode/forward that (recommended, keeps full
   float precision), or
2. Make `sender.ino` pack yaw/pitch/roll as `int16_t` (e.g. degrees × 100) to
   match `NodePayload` exactly before sending.

Once fixed, open `server/serial_link.py` and set `PAYLOAD_FORMAT = "float32"`
(if you went with option 1) — everything else keeps working unchanged.

Until then, use **Simulate mode** in the sidebar to test/demo the full dashboard
with fake multi-device data.

## Setup

```bash
cd raveheads-dashboard
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
cd server
python app.py
```

Open **http://localhost:5000** in Chrome/Edge/Firefox.

## Using it

1. **Connect hardware**: pick the hub's COM/tty port in the sidebar → Connect.
   Or click **Simulate** to generate fake data for N nodes without hardware.
2. **Load your audio**: on the Global page, choose your 2-minute audio file.
   Its real duration is read automatically and used for timing (doesn't have
   to be exactly 2:00).
3. **Start Session**: runs 30s pre-roll → auto-plays the audio → 30s post-roll
   (total ≈ 3:00). All device data received during that whole window is
   recorded. When it ends, a combined CSV auto-downloads.
4. **Global page**: device status table, live mean/dispersion of yaw across
   all connected devices, and a combined per-device yaw chart.
5. **Per-device pages** (sidebar, auto-populated as devices are seen): live
   yaw/pitch/roll numbers, a rolling chart, and a 3D placeholder head (box +
   cone "nose" + marker on top) that rotates live with yaw/pitch/roll —
   swap in a real head model later by replacing the geometry in
   `initThreeHead()` in `static/js/app.js`.

## CSV format

One row per received sample, long format:

```
session_id, elapsed_s, node_timestamp_ms, node_id, yaw, pitch, roll, seq
```

`elapsed_s` is seconds since the session started (server clock), so t=0 is the
very start of the pre-roll and t≈30 is when the audio starts.

## Project layout

```
server/
  app.py          Flask + Flask-SocketIO backend, session timing, CSV export
  serial_link.py  Hub serial protocol framing/CRC/parsing (+ format note above)
static/
  index.html      Dashboard shell (Global page + device page template)
  css/style.css
  js/app.js       Socket.IO client, Chart.js graphs, Three.js head, session UI
generated/        CSVs land here before being served for download
```

## Notes / things you may want to extend

- The 3D object is a deliberate placeholder (box + cone + marker) so
  yaw/pitch/roll are visually legible without needing a real head asset yet.
- Rotation order used is `YXZ` (yaw around Y, pitch around X, roll around Z),
  a common convention for head orientation — flip if your sensor's convention
  differs once real data comes through.
- "Online" status = a packet seen from that node in the last 2 seconds.
- Aggregate dispersion on the Global page is just yaw std-dev across devices
  right now — cheap to extend to circular statistics / your synchrony index
  if you want that instead of a linear std-dev.
