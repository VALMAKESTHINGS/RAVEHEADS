const socket = io();

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
const HISTORY_LEN = 200; // samples kept per chart
const devicePages = {};  // nodeId -> { el, chart, three: {...}, latest }
let currentPage = "global";
let audioDuration = 120;

const aggHistory = { t: [], yaw: [], pitchStd: [], yawStd: [] };
let aggChart, globalYawChart;
let sessionStartClientTime = null;
let sessionTotalS = 180;
let sessionPhase = "idle";

// ---------------------------------------------------------------------
// Sidebar navigation
// ---------------------------------------------------------------------
function showPage(pageId) {
  currentPage = pageId;
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  if (pageId === "global") {
    document.getElementById("page-global").classList.add("active");
    document.querySelector('.nav-btn[data-page="global"]').classList.add("active");
  } else {
    devicePages[pageId].el.classList.add("active");
    document.querySelector(`.nav-btn[data-page="${pageId}"]`).classList.add("active");
  }
}
document.querySelector('.nav-btn[data-page="global"]').addEventListener("click", () => showPage("global"));

// ---------------------------------------------------------------------
// Device page creation (cloned from template) incl. its own Three.js scene + chart
// ---------------------------------------------------------------------
function ensureDevicePage(nodeId) {
  if (devicePages[nodeId]) return devicePages[nodeId];

  // Register the entry FIRST, before anything that could throw (e.g. a
  // missing library). This guarantees ensureDevicePage can never build the
  // same node's page/nav-button twice, even if chart/3D setup below fails.
  const record = {
    el: null, chart: null, three: null,
    history: { t: [], yaw: [], pitch: [], roll: [] },
    latest: { yaw: 0, pitch: 0, roll: 0 },
  };
  devicePages[nodeId] = record;

  const template = document.getElementById("device-page-template");
  const el = template.cloneNode(true);
  el.id = `page-device-${nodeId}`;
  el.style.display = "";
  el.querySelector(".dev-title-id").textContent = `#${nodeId}`;
  document.getElementById("content").appendChild(el);
  record.el = el;

  // nav button
  const navBtn = document.createElement("button");
  navBtn.className = "nav-btn";
  navBtn.dataset.page = nodeId;
  navBtn.textContent = `Node ${nodeId}`;
  navBtn.addEventListener("click", () => showPage(nodeId));
  document.getElementById("device-nav").appendChild(navBtn);

  try {
    // per-device line chart
    const canvas = el.querySelector(".ypr-chart");
    record.chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Yaw", data: [], borderColor: "#7c5cff", borderWidth: 2, pointRadius: 0 },
          { label: "Pitch", data: [], borderColor: "#00d1a4", borderWidth: 2, pointRadius: 0 },
          { label: "Roll", data: [], borderColor: "#ffb454", borderWidth: 2, pointRadius: 0 },
        ],
      },
      options: chartOptions(-180, 180),
    });
  } catch (err) {
    console.error(`Chart.js failed to initialize for node ${nodeId}:`, err);
    showLibraryWarning();
  }

  try {
    record.three = initThreeHead(el.querySelector(".three-container"));
  } catch (err) {
    console.error(`Three.js failed to initialize for node ${nodeId}:`, err);
    showLibraryWarning();
  }

  return record;
}

let libraryWarningShown = false;
function showLibraryWarning() {
  if (libraryWarningShown) return;
  libraryWarningShown = true;
  const banner = document.createElement("div");
  banner.style.cssText =
    "background:#ff5c7a;color:#241900;padding:10px 16px;border-radius:8px;margin-bottom:16px;font-weight:600";
  banner.textContent =
    "A required script (Chart.js or Three.js) failed to load from static/js/vendor/. " +
    "Charts/3D view won't render. Check that the vendor/ folder exists next to app.js and that the server is running (not opened as a local file).";
  document.getElementById("content").prepend(banner);
}

function chartOptions(min, max) {
  return {
    animation: false,
    responsive: true,
    scales: {
      x: { display: false },
      y: { min, max, grid: { color: "#2a2f3a" }, ticks: { color: "#8b90a0" } },
    },
    plugins: { legend: { labels: { color: "#e6e8ee" } } },
  };
}

// ---------------------------------------------------------------------
// Three.js head model
// ---------------------------------------------------------------------
// Drop a .glb or .gltf file at static/models/head.glb and it will load
// automatically in place of the placeholder box below. Export it facing
// +Z ("forward") and roughly 1-2 units tall — it gets auto-centered and
// auto-scaled to fit either way. If no file is found, the placeholder
// (box + nose cone + top marker) is used instead, so the dashboard always
// works even with no custom model.
const CUSTOM_MODEL_PATH = "/models/head.glb";

function initThreeHead(container) {
  const width = container.clientWidth || 400;
  const height = container.clientHeight || 280;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 1.2, 4.2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 5, 4);
  scene.add(dir);

  const headGroup = new THREE.Group();
  scene.add(headGroup);

  function addPlaceholder() {
    const headGeo = new THREE.BoxGeometry(1.4, 1.7, 1.4);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x7c5cff, roughness: 0.5 });
    headGroup.add(new THREE.Mesh(headGeo, headMat));

    const noseGeo = new THREE.ConeGeometry(0.22, 0.6, 16);
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x00d1a4 });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.1, 0.95);
    headGroup.add(nose);

    const upGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const upMat = new THREE.MeshStandardMaterial({ color: 0xffb454 });
    const upMarker = new THREE.Mesh(upGeo, upMat);
    upMarker.position.set(0, 0.95, 0);
    headGroup.add(upMarker);

    render();
  }

  function loadCustomModel() {
    if (typeof THREE.GLTFLoader === "undefined") {
      addPlaceholder();
      return;
    }
    const loader = new THREE.GLTFLoader();
    loader.load(
      CUSTOM_MODEL_PATH,
      (gltf) => {
        const model = gltf.scene;

        // auto-center and auto-scale so any model roughly matches the
        // placeholder's on-screen size, regardless of its original units
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.sub(center); // center at origin
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 10 / maxDim; // ~resize
        model.scale.setScalar(scale);

        headGroup.add(model);
        render();
      },
      undefined,
      () => {
        // No model file found (or failed to parse) — fall back silently.
        addPlaceholder();
      }
    );
  }

  loadCustomModel();

  const grid = new THREE.GridHelper(6, 12, 0x2a2f3a, 0x1e222b);
  grid.position.y = -1.2;
  scene.add(grid);

  function render() {
    renderer.render(scene, camera);
  }
  render();

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    render();
  }
  window.addEventListener("resize", resize);

  return {
    setOrientation(yawDeg, pitchDeg, rollDeg) {
      // Order: yaw (Y), pitch (X), roll (Z) — typical head-orientation convention
      headGroup.rotation.order = "YXZ";
      headGroup.rotation.y = THREE.MathUtils.degToRad(yawDeg);
      headGroup.rotation.x = THREE.MathUtils.degToRad(pitchDeg);
      headGroup.rotation.z = THREE.MathUtils.degToRad(rollDeg);
      render();
    },
    resize,
  };
}

// ---------------------------------------------------------------------
// Global page: aggregate chart
// ---------------------------------------------------------------------
function initGlobalCharts() {
  aggChart = new Chart(document.getElementById("aggregate-chart"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "Mean Yaw", data: [], borderColor: "#7c5cff", borderWidth: 2, pointRadius: 0 },
        { label: "Yaw dispersion (std)", data: [], borderColor: "#ff5c7a", borderWidth: 2, pointRadius: 0, borderDash: [4, 3] },
      ],
    },
    options: chartOptions(-180, 180),
  });

  globalYawChart = new Chart(document.getElementById("global-yaw-chart"), {
    type: "line",
    data: { labels: [], datasets: [] }, // datasets added dynamically per node
    options: chartOptions(-180, 180),
  });
}

function ensureGlobalDataset(nodeId) {
  const existing = globalYawChart.data.datasets.find((d) => d.nodeId === nodeId);
  if (existing) return existing;
  const palette = ["#7c5cff", "#00d1a4", "#ffb454", "#ff5c7a", "#4dabf7", "#e599f7"];
  const ds = {
    nodeId,
    label: `Node ${nodeId}`,
    data: [],
    borderColor: palette[(nodeId - 1) % palette.length],
    borderWidth: 1.5,
    pointRadius: 0,
  };
  globalYawChart.data.datasets.push(ds);
  return ds;
}

// ---------------------------------------------------------------------
// Device table (global page)
// ---------------------------------------------------------------------
function refreshDeviceTable() {
  fetch("/api/devices")
    .then((r) => r.json())
    .then((list) => {
      const tbody = document.querySelector("#device-table tbody");
      tbody.innerHTML = "";
      list.forEach((d) => {
        ensureDevicePage(d.nodeId);
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>#${d.nodeId}</td>
          <td>${d.online ? '<span style="color:#00d1a4">● online</span>' : '<span style="color:#ff5c7a">● offline</span>'}</td>
          <td>${d.hz}</td>
          <td>${d.yaw.toFixed(1)}</td>
          <td>${d.pitch.toFixed(1)}</td>
          <td>${d.roll.toFixed(1)}</td>`;
        tbody.appendChild(tr);

        const dp = devicePages[d.nodeId];
        if (dp && dp.el) {
          dp.el.querySelector(".meta-status").textContent = d.online ? "online" : "offline";
          dp.el.querySelector(".meta-hz").textContent = d.hz;
        }
      });

      // aggregate stats
      if (list.length && aggChart) {
        const yaws = list.map((d) => d.yaw);
        const mean = yaws.reduce((a, b) => a + b, 0) / yaws.length;
        const variance = yaws.reduce((a, b) => a + (b - mean) ** 2, 0) / yaws.length;
        const std = Math.sqrt(variance);
        const label = new Date().toLocaleTimeString();
        pushHistory(aggChart, label, [mean, std]);
      }
    });
}
setInterval(refreshDeviceTable, 500);

function pushHistory(chart, label, values) {
  chart.data.labels.push(label);
  values.forEach((v, i) => chart.data.datasets[i].data.push(v));
  if (chart.data.labels.length > HISTORY_LEN) {
    chart.data.labels.shift();
    chart.data.datasets.forEach((d) => d.data.shift());
  }
  chart.update("none");
}

// ---------------------------------------------------------------------
// Live node_data stream
// ---------------------------------------------------------------------
socket.on("node_data", (pkt) => {
  const dp = ensureDevicePage(pkt.nodeId);
  dp.latest = pkt;

  // per-device readout + 3D (guarded: chart/three may be null if a vendor
  // script failed to load — the rest of the app keeps working regardless)
  if (dp.el) {
    dp.el.querySelector(".yaw-val").textContent = pkt.yaw.toFixed(1);
    dp.el.querySelector(".pitch-val").textContent = pkt.pitch.toFixed(1);
    dp.el.querySelector(".roll-val").textContent = pkt.roll.toFixed(1);
  }
  if (dp.three) dp.three.setOrientation(pkt.yaw, pkt.pitch, pkt.roll);
  if (dp.chart) pushHistory(dp.chart, "", [pkt.yaw, pkt.pitch, pkt.roll]);

  // global multi-node yaw chart
  if (globalYawChart) {
    const ds = ensureGlobalDataset(pkt.nodeId);
    if (globalYawChart.data.labels.length === 0 || globalYawChart.data.labels.length < HISTORY_LEN) {
      globalYawChart.data.labels.push("");
    }
    ds.data.push(pkt.yaw);
    if (ds.data.length > HISTORY_LEN) ds.data.shift();
    if (globalYawChart.data.labels.length > HISTORY_LEN) globalYawChart.data.labels.shift();
    globalYawChart.update("none");
  }
});

// ---------------------------------------------------------------------
// Serial connection UI
// ---------------------------------------------------------------------
const connStatus = document.getElementById("conn-status");
const connText = document.getElementById("conn-text");
const portSelect = document.getElementById("port-select");

function refreshPorts() {
  fetch("/api/ports")
    .then((r) => r.json())
    .then((ports) => {
      portSelect.innerHTML = "";
      ports.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.device;
        opt.textContent = `${p.device} — ${p.description}`;
        portSelect.appendChild(opt);
      });
    });
}
document.getElementById("refresh-ports").addEventListener("click", refreshPorts);
refreshPorts();

document.getElementById("connect-btn").addEventListener("click", () => {
  fetch("/api/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ port: portSelect.value, baud: 115200 }),
  });
});

document.getElementById("simulate-btn").addEventListener("click", () => {
  const n = parseInt(document.getElementById("sim-count").value || "3", 10);
  fetch("/api/simulate/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes: n }),
  }).then(() => {
    document.getElementById("simulate-btn").disabled = true;
    document.getElementById("simulate-stop-btn").disabled = false;
  });
});

document.getElementById("simulate-stop-btn").addEventListener("click", () => {
  fetch("/api/simulate/stop", { method: "POST" }).then(() => {
    document.getElementById("simulate-btn").disabled = false;
    document.getElementById("simulate-stop-btn").disabled = true;
  });
});

socket.on("serial_status", (status) => {
  const simBtn = document.getElementById("simulate-btn");
  const simStopBtn = document.getElementById("simulate-stop-btn");
  if (status.connected) {
    connStatus.classList.add("online");
    connText.textContent = status.port || "Connected";
    document.getElementById("start-session-btn").disabled = !audioLoaded;
    const isSimulated = (status.port || "").includes("SIMULATED");
    simBtn.disabled = isSimulated;
    simStopBtn.disabled = !isSimulated;
  } else {
    connStatus.classList.remove("online");
    connText.textContent = status.error ? `Error: ${status.error}` : "Disconnected";
    document.getElementById("start-session-btn").disabled = true;
    simBtn.disabled = false;
    simStopBtn.disabled = true;
  }
});

// ---------------------------------------------------------------------
// Audio + session control
// ---------------------------------------------------------------------
let audioLoaded = false;
const audioPlayer = document.getElementById("audio-player");
const startBtn = document.getElementById("start-session-btn");
const stopBtn = document.getElementById("stop-session-btn");
const phaseBadge = document.getElementById("session-phase-badge");
const progressInner = document.getElementById("session-progress-inner");
const timeLabel = document.getElementById("session-time-label");

document.getElementById("audio-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  audioPlayer.src = url;
  audioPlayer.addEventListener(
    "loadedmetadata",
    () => {
      audioDuration = audioPlayer.duration;
      document.getElementById("audio-duration-label").textContent =
        `${file.name} (${audioDuration.toFixed(0)}s)`;
      sessionTotalS = 30 + audioDuration + 30;
      startBtn.textContent = `▶ Start Session (${formatTime(sessionTotalS)} total)`;
      audioLoaded = true;
      startBtn.disabled = connStatus.classList.contains("online") ? false : false; // allow even before connect (simulate not yet started)
      startBtn.disabled = false;
    },
    { once: true }
  );
});

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

startBtn.addEventListener("click", () => {
  fetch("/api/session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio_duration_s: audioDuration, pre_s: 30, post_s: 30 }),
  }).then((r) => r.json()).then((res) => {
    if (!res.ok) { alert(res.error || "Could not start session"); return; }
    sessionStartClientTime = Date.now();
    startBtn.disabled = true;
    stopBtn.disabled = false;
  });
});

stopBtn.addEventListener("click", () => {
  fetch("/api/session/stop", { method: "POST" });
});

socket.on("session_state", (msg) => {
  sessionPhase = msg.phase;
  phaseBadge.className = `phase-badge ${msg.phase}`;
  phaseBadge.textContent = msg.phase;

  if (msg.phase === "audio" && msg.play_audio) {
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => {});
  }
  if (msg.phase === "complete") {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    progressInner.style.width = "100%";
    timeLabel.textContent = "done";
    audioPlayer.pause();
    if (msg.download_url) triggerDownload(msg.download_url);
  }
});

function triggerDownload(url) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// client-side progress bar ticker (server drives actual phase transitions)
setInterval(() => {
  if (!sessionStartClientTime || sessionPhase === "complete" || sessionPhase === null) return;
  const elapsed = (Date.now() - sessionStartClientTime) / 1000;
  const pct = Math.min(100, (elapsed / sessionTotalS) * 100);
  progressInner.style.width = `${pct}%`;
  timeLabel.textContent = `${formatTime(elapsed)} / ${formatTime(sessionTotalS)}`;
}, 200);

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
try {
  initGlobalCharts();
} catch (err) {
  console.error("Failed to initialize global charts:", err);
  showLibraryWarning();
}
