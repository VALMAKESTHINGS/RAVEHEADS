"""
RAVEHEADS dashboard backend.

Run with:  python app.py
Then open: http://localhost:5000
"""

import csv
import io
import math
import os
import random
import threading
import time
import uuid

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_socketio import SocketIO

from serial_link import SerialReader, list_serial_ports

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "..", "static")
GENERATED_DIR = os.path.join(BASE_DIR, "..", "generated")
os.makedirs(GENERATED_DIR, exist_ok=True)

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
state_lock = threading.Lock()
devices = {}  # nodeId -> {last_seen, hz estimate, latest ypr, seq history}
serial_reader = None
simulate_thread = None
simulate_stop = threading.Event()

session = {
    "active": False,
    "id": None,
    "phase": None,       # 'preroll' | 'audio' | 'postroll' | None
    "start_time": None,  # server time.time() at session start
    "audio_duration_s": 120,
    "pre_s": 30,
    "post_s": 30,
    "rows": [],          # recorded samples for this session
    "csv_path": None,
}
session_timer_thread = None


def _device_bucket(node_id):
    d = devices.setdefault(
        node_id,
        {"last_seen": 0, "count": 0, "hz": 0.0, "last_ts_for_hz": 0,
         "yaw": 0.0, "pitch": 0.0, "roll": 0.0, "seq": None},
    )
    return d


def handle_packet(pkt):
    """Called from the serial reader thread (or simulator) for every valid packet."""
    now = time.time()
    with state_lock:
        d = _device_bucket(pkt["nodeId"])
        # simple rolling Hz estimate
        if d["last_seen"]:
            dt = now - d["last_seen"]
            if dt > 0:
                inst_hz = 1.0 / dt
                d["hz"] = d["hz"] * 0.8 + inst_hz * 0.2 if d["hz"] else inst_hz
        d["last_seen"] = now
        d["count"] += 1
        d["yaw"], d["pitch"], d["roll"] = pkt["yaw"], pkt["pitch"], pkt["roll"]
        d["seq"] = pkt.get("seqNum")

        if session["active"]:
            elapsed = now - session["start_time"]
            session["rows"].append(
                {
                    "session_id": session["id"],
                    "elapsed_s": round(elapsed, 3),
                    "node_timestamp_ms": pkt.get("timestamp_ms"),
                    "node_id": pkt["nodeId"],
                    "yaw": pkt["yaw"],
                    "pitch": pkt["pitch"],
                    "roll": pkt["roll"],
                    "seq": pkt.get("seqNum"),
                }
            )

    socketio.emit(
        "node_data",
        {
            "nodeId": pkt["nodeId"],
            "timestamp_ms": pkt.get("timestamp_ms"),
            "yaw": pkt["yaw"],
            "pitch": pkt["pitch"],
            "roll": pkt["roll"],
            "seq": pkt.get("seqNum"),
        },
    )


def handle_status(status):
    socketio.emit("serial_status", status)


# ---------------------------------------------------------------------------
# Serial connection endpoints
# ---------------------------------------------------------------------------
@app.route("/api/ports")
def api_ports():
    return jsonify(list_serial_ports())


@app.route("/api/connect", methods=["POST"])
def api_connect():
    global serial_reader
    port = request.json.get("port")
    baud = int(request.json.get("baud", 115200))
    stop_simulation()
    if serial_reader:
        serial_reader.stop()
    serial_reader = SerialReader(port, baud, on_packet=handle_packet, on_status=handle_status)
    serial_reader.start()
    return jsonify({"ok": True})


@app.route("/api/disconnect", methods=["POST"])
def api_disconnect():
    global serial_reader
    if serial_reader:
        serial_reader.stop()
        serial_reader = None
    handle_status({"connected": False})
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Simulate mode (no hardware needed) — generates plausible multi-node data
# ---------------------------------------------------------------------------
def _simulate_loop(n_nodes):
    t0 = time.time()
    phases = {i: random.uniform(0, 6.28) for i in range(1, n_nodes + 1)}
    seq = {i: 0 for i in range(1, n_nodes + 1)}
    while not simulate_stop.is_set():
        t = time.time() - t0
        for i in range(1, n_nodes + 1):
            wobble = phases[i]
            yaw = 30 * math.sin(t * 0.3 + wobble) + random.uniform(-2, 2)
            pitch = 15 * math.sin(t * 0.5 + wobble * 1.3) + random.uniform(-1, 1)
            roll = 10 * math.sin(t * 0.2 + wobble * 0.7) + random.uniform(-1, 1)
            seq[i] = (seq[i] + 1) % 256
            handle_packet(
                {
                    "nodeId": i,
                    "timestamp_ms": int(t * 1000),
                    "yaw": yaw,
                    "pitch": pitch,
                    "roll": roll,
                    "seqNum": seq[i],
                }
            )
        time.sleep(0.05)  # ~20 Hz per node


def stop_simulation():
    global simulate_thread
    simulate_stop.set()
    if simulate_thread:
        simulate_thread.join(timeout=1)
    simulate_thread = None


@app.route("/api/simulate/start", methods=["POST"])
def api_simulate_start():
    global simulate_thread
    n_nodes = int(request.json.get("nodes", 3)) if request.is_json else 3
    if serial_reader:
        api_disconnect()
    simulate_stop.clear()
    simulate_thread = threading.Thread(target=_simulate_loop, args=(n_nodes,), daemon=True)
    simulate_thread.start()
    handle_status({"connected": True, "port": f"SIMULATED ({n_nodes} nodes)"})
    return jsonify({"ok": True})


@app.route("/api/simulate/stop", methods=["POST"])
def api_simulate_stop():
    stop_simulation()
    handle_status({"connected": False})
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Device / global status
# ---------------------------------------------------------------------------
@app.route("/api/devices")
def api_devices():
    now = time.time()
    with state_lock:
        out = []
        for node_id, d in devices.items():
            out.append(
                {
                    "nodeId": node_id,
                    "online": (now - d["last_seen"]) < 2.0,
                    "hz": round(d["hz"], 1),
                    "yaw": d["yaw"],
                    "pitch": d["pitch"],
                    "roll": d["roll"],
                    "lastSeenAgo": round(now - d["last_seen"], 2) if d["last_seen"] else None,
                }
            )
    return jsonify(out)


# ---------------------------------------------------------------------------
# Session control: 30s pre-roll -> audio (client-reported duration) -> 30s post-roll
# ---------------------------------------------------------------------------
def _run_session_timer():
    pre_s = session["pre_s"]
    audio_s = session["audio_duration_s"]
    post_s = session["post_s"]

    session["phase"] = "preroll"
    socketio.emit("session_state", {"phase": "preroll", "duration": pre_s})
    time.sleep(pre_s)
    if not session["active"]:
        return

    session["phase"] = "audio"
    socketio.emit("session_state", {"phase": "audio", "duration": audio_s, "play_audio": True})
    time.sleep(audio_s)
    if not session["active"]:
        return

    session["phase"] = "postroll"
    socketio.emit("session_state", {"phase": "postroll", "duration": post_s})
    time.sleep(post_s)

    finalize_session()


@app.route("/api/session/start", methods=["POST"])
def api_session_start():
    global session_timer_thread
    if session["active"]:
        return jsonify({"ok": False, "error": "session already active"}), 400

    body = request.json or {}
    with state_lock:
        session.update(
            {
                "active": True,
                "id": uuid.uuid4().hex[:8],
                "phase": "preroll",
                "start_time": time.time(),
                "audio_duration_s": float(body.get("audio_duration_s", 120)),
                "pre_s": float(body.get("pre_s", 30)),
                "post_s": float(body.get("post_s", 30)),
                "rows": [],
                "csv_path": None,
            }
        )
    session_timer_thread = threading.Thread(target=_run_session_timer, daemon=True)
    session_timer_thread.start()
    return jsonify({"ok": True, "session_id": session["id"]})


@app.route("/api/session/stop", methods=["POST"])
def api_session_stop():
    """Manual early stop / abort."""
    if not session["active"]:
        return jsonify({"ok": False, "error": "no active session"}), 400
    finalize_session()
    return jsonify({"ok": True})


def finalize_session():
    with state_lock:
        session["active"] = False
        session["phase"] = None
        rows = list(session["rows"])
        sid = session["id"]

    fname = f"session_{sid}.csv"
    fpath = os.path.join(GENERATED_DIR, fname)
    with open(fpath, "w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "session_id",
                "elapsed_s",
                "node_timestamp_ms",
                "node_id",
                "yaw",
                "pitch",
                "roll",
                "seq",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    session["csv_path"] = fpath
    socketio.emit(
        "session_state",
        {"phase": "complete", "download_url": f"/api/session/download/{fname}", "row_count": len(rows)},
    )


@app.route("/api/session/download/<fname>")
def api_session_download(fname):
    fpath = os.path.join(GENERATED_DIR, fname)
    return send_file(fpath, as_attachment=True, download_name=fname, mimetype="text/csv")


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


if __name__ == "__main__":
    print("RAVEHEADS dashboard running at http://localhost:5000")
    socketio.run(app, host="0.0.0.0", port=5000, allow_unsafe_werkzeug=True)
