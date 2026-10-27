/*
  Webcam & Mic QC Tester -- app.js
  Turunan dari Webcam-test (c) BlazeInferno64 (https://github.com/BlazeInferno64/Webcam-test)
  Lisensi: GPL-3.0

  Tujuan: menguji kamera + mikrofon laptop untuk QC.
  - Kamera: preview langsung + resolusi + fps terukur.
  - Mikrofon: level meter (RMS) + monitor "listen to this device".
  - Semua proses lokal, tanpa jaringan.
*/

const el = {
  video: document.getElementById("video"),
  noSignal: document.getElementById("noSignal"),
  camInfo: document.getElementById("camInfo"),
  camFps: document.getElementById("camFps"),
  chipCam: document.getElementById("chipCam"),
  chipMic: document.getElementById("chipMic"),
  camSelect: document.getElementById("camSelect"),
  micSelect: document.getElementById("micSelect"),
  meterShade: document.getElementById("meterShade"),
  meterPeak: document.getElementById("meterPeak"),
  dbValue: document.getElementById("dbValue"),
  monitorToggle: document.getElementById("monitorToggle"),
  monitorVol: document.getElementById("monitorVol"),
  volValue: document.getElementById("volValue"),
  feedbackWarn: document.getElementById("feedbackWarn"),
  status: document.getElementById("status"),
  btnStart: document.getElementById("btnStart"),
  btnReset: document.getElementById("btnReset"),
  version: document.getElementById("version"),
};

const state = {
  stream: null,
  starting: false,
  monitoring: true,
  volume: 0.6,
  volumePercent: 60,
  audio: { ctx: null, source: null, analyser: null, gain: null, buffer: null },
  meterRAF: 0,
  peakDb: -140,
  peakAt: 0,
  slowPromptTimer: 0,
};

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */

function setChip(node, kind, text) {
  node.className = `chip ${kind}`;
  node.innerHTML = "<i></i>";
  node.appendChild(document.createTextNode(text));
}

function setStatus(text, kind = "") {
  el.status.textContent = text;
  el.status.className = `status ${kind}`.trim();
}

function idleChips() {
  setChip(el.chipCam, "idle", "KAMERA —");
  setChip(el.chipMic, "idle", "MIC —");
}

function resetMeter() {
  el.dbValue.textContent = "—";
  el.meterShade.style.width = "100%";
  el.meterPeak.style.opacity = "0";
  el.meterPeak.style.left = "0%";
  state.peakDb = -140;
  state.peakAt = 0;
}

function describeError(err) {
  const name = (err && err.name) || "Error";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        kind: "err",
        short: "IZIN DITOLAK",
        text:
          'Izin kamera/mikrofon diblokir Windows. Buka Settings -> Privacy & security -> Camera / Microphone, ' +
          'lalu aktifkan "Let desktop apps access your camera/microphone".',
      };
    case "NotFoundError":
      return {
        kind: "err",
        short: "TIDAK ADA",
        text: "Perangkat tidak terdeteksi. Cek koneksi/kabel kamera atau mikrofon.",
      };
    case "NotReadableError":
      return {
        kind: "err",
        short: "SIBUK",
        text: "Perangkat sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu tekan Mulai ulang.",
      };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return {
        kind: "warn",
        short: "TIDAK DIDUKUNG",
        text: "Kamera tidak mendukung resolusi/format yang diminta. Coba pilih perangkat lain.",
      };
    case "AbortError":
      return {
        kind: "err",
        short: "DIBATALKAN",
        text: "Akses perangkat dibatalkan oleh sistem.",
      };
    default:
      return {
        kind: "err",
        short: "GAGAL",
        text: `Gagal membuka perangkat (${name}).`,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Perangkat                                                           */
/* ------------------------------------------------------------------ */

function videoConstraints(deviceId) {
  const c = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
}

function audioConstraints(deviceId) {
  // Kualitas apa adanya: semua pemrosesan dimatikan agar cacat mic terlihat.
  const c = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
}

/**
 * Ambil kamera + mic sekaligus (satu prompt izin).
 * Jika salah satu gagal, perangkat lain tetap dicoba supaya status QC
 * bisa menyebut mana yang bermasalah.
 */
async function acquire(camId, micId) {
  const video = videoConstraints(camId);
  const audio = audioConstraints(micId);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    return { stream, camErr: null, micErr: null };
  } catch (err) {
    const tracks = [];
    let camErr = null;
    let micErr = null;

    try {
      const vs = await navigator.mediaDevices.getUserMedia({ video });
      tracks.push(...vs.getVideoTracks());
    } catch (e) {
      camErr = e;
    }

    try {
      const as = await navigator.mediaDevices.getUserMedia({ audio });
      tracks.push(...as.getAudioTracks());
    } catch (e) {
      micErr = e;
    }

    if (!tracks.length) throw err; // dua-duanya gagal: laporkan error asli
    return { stream: new MediaStream(tracks), camErr, micErr };
  }
}

function fillSelect(select, devices, prefix) {
  const current = select.value;
  while (select.firstChild) select.removeChild(select.firstChild);

  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Default sistem";
  select.appendChild(def);

  devices.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `${prefix} ${i + 1}`;
    select.appendChild(opt);
  });

  select.disabled = devices.length === 0;
  if (current && devices.some((d) => d.deviceId === current)) {
    select.value = current;
  }
}

async function refreshDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    fillSelect(
      el.camSelect,
      devices.filter((d) => d.kind === "videoinput"),
      "Kamera"
    );
    fillSelect(
      el.micSelect,
      devices.filter((d) => d.kind === "audioinput"),
      "Mikrofon"
    );
  } catch (e) {
    /* diabaikan: enumerasi hanya untuk daftar perangkat */
  }
}

/* ------------------------------------------------------------------ */
/* Kamera                                                              */
/* ------------------------------------------------------------------ */

function attachVideo(stream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;

  el.video.srcObject = new MediaStream([track]);
  el.noSignal.classList.add("hidden");
  const p = el.video.play();
  if (p && p.catch) p.catch(() => {});

  const s = track.getSettings ? track.getSettings() : {};
  const nominalFps = s.frameRate ? Math.round(s.frameRate) : null;
  el.camInfo.textContent =
    s.width && s.height
      ? `${s.width}x${s.height}${nominalFps ? " · " + nominalFps + " fps" : ""}`
      : "Resolusi —";

  measureFps(el.video);
}

function measureFps(video) {
  if (typeof video.requestVideoFrameCallback !== "function") {
    el.camFps.textContent = "— fps";
    return;
  }
  let frames = 0;
  let since = performance.now();

  const onFrame = () => {
    if (el.video.srcObject !== video.srcObject) return; // stream sudah diganti
    frames += 1;
    const now = performance.now();
    if (now - since >= 1000) {
      el.camFps.textContent = `${Math.round((frames * 1000) / (now - since))} fps`;
      frames = 0;
      since = now;
    }
    video.requestVideoFrameCallback(onFrame);
  };

  el.camFps.textContent = "— fps";
  video.requestVideoFrameCallback(onFrame);
}

/* ------------------------------------------------------------------ */
/* Mikrofon                                                            */
/* ------------------------------------------------------------------ */

function setupAudio(stream) {
  const tracks = stream.getAudioTracks();
  if (!tracks.length) return;

  const ctx = state.audio.ctx || new AudioContext();
  state.audio.ctx = ctx;

  const source = ctx.createMediaStreamSource(new MediaStream(tracks));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.35;

  const gain = ctx.createGain();
  gain.gain.value = state.monitoring ? state.volume : 0;

  source.connect(analyser);
  source.connect(gain);
  gain.connect(ctx.destination);

  state.audio.source = source;
  state.audio.analyser = analyser;
  state.audio.gain = gain;
  state.audio.buffer = new Float32Array(analyser.fftSize);

  if (ctx.state === "suspended") {
    // Chromium butuh gestur pengguna sebelum audio boleh berbunyi.
    ctx.resume().catch(() => {});
  }

  startMeter();
}

function startMeter() {
  cancelAnimationFrame(state.meterRAF);
  const a = state.audio;
  if (!a.analyser || !a.buffer) return;

  let lastText = 0;

  const tick = () => {
    state.meterRAF = requestAnimationFrame(tick);
    const analyser = state.audio.analyser;
    if (!analyser) return;

    analyser.getFloatTimeDomainData(a.buffer);

    let sum = 0;
    for (let i = 0; i < a.buffer.length; i++) {
      const v = a.buffer[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / a.buffer.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-7)); // -140 .. 0 dBFS

    const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    el.meterShade.style.width = `${(100 - pct).toFixed(2)}%`;

    const now = performance.now();
    if (db > state.peakDb || now - state.peakAt > 900) {
      state.peakDb = db;
      state.peakAt = now;
    }
    const peakPct = Math.max(
      0,
      Math.min(100, ((state.peakDb + 60) / 60) * 100)
    );
    el.meterPeak.style.left = `${peakPct.toFixed(2)}%`;
    el.meterPeak.style.opacity = state.peakDb > -60 ? "0.9" : "0";

    if (now - lastText > 100) {
      el.dbValue.textContent = db <= -59.5 ? "—" : db.toFixed(0);
      lastText = now;
    }
  };

  tick();
}

function applyMonitor() {
  const gain = state.audio.gain;
  if (gain) {
    gain.gain.value = state.monitoring ? state.volume : 0;
  }
  el.feedbackWarn.classList.toggle("hidden", !state.monitoring);
}

/* ------------------------------------------------------------------ */
/* Siklus hidup                                                        */
/* ------------------------------------------------------------------ */

function stopStream() {
  cancelAnimationFrame(state.meterRAF);
  state.meterRAF = 0;

  const a = state.audio;
  try {
    if (a.source) a.source.disconnect();
    if (a.analyser) a.analyser.disconnect();
    if (a.gain) a.gain.disconnect();
  } catch (e) {
    /* node mungkin sudah terputus */
  }
  a.source = null;
  a.analyser = null;
  a.gain = null;
  a.buffer = null;

  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }

  el.video.srcObject = null;
  el.noSignal.classList.remove("hidden");
  el.camInfo.textContent = "Resolusi —";
  el.camFps.textContent = "— fps";
  resetMeter();
}

async function start() {
  if (state.starting) return;
  state.starting = true;
  el.btnStart.disabled = true;
  el.btnStart.textContent = "Memulai…";

  stopStream();
  idleChips();
  resetMeter();
  el.feedbackWarn.classList.toggle("hidden", !state.monitoring);
  setStatus("Meminta akses kamera & mikrofon…");

  clearTimeout(state.slowPromptTimer);
  state.slowPromptTimer = setTimeout(() => {
    if (state.starting) {
      setStatus(
        "Menunggu izin… Jika tidak ada notifikasi, buka Settings -> Privacy & security -> Camera/Microphone.",
        "error"
      );
    }
  }, 8000);

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("MediaDevices tidak tersedia di webview ini");
    }

    const res = await acquire(el.camSelect.value, el.micSelect.value);
    state.stream = res.stream;

    let camOk = false;
    let micOk = false;
    let firstProblem = null;

    if (res.camErr) {
      setChip(el.chipCam, "err", "KAMERA GAGAL");
      firstProblem = firstProblem || res.camErr;
    } else if (res.stream.getVideoTracks().length) {
      attachVideo(res.stream);
      camOk = true;
      setChip(el.chipCam, "ok", "KAMERA OK");
    }

    if (res.micErr) {
      setChip(el.chipMic, "err", "MIC GAGAL");
      firstProblem = firstProblem || res.micErr;
    } else if (res.stream.getAudioTracks().length) {
      setupAudio(res.stream);
      micOk = true;
      setChip(el.chipMic, "ok", "MIC OK");
    }

    await refreshDevices();

    if (camOk && micOk) {
      setStatus("Kamera & mikrofon aktif. Bicara untuk menguji mikrofon.", "ok");
    } else if (camOk || micOk) {
      const d = describeError(firstProblem);
      setStatus(
        `${camOk ? "Kamera OK" : "Kamera gagal"} · ${micOk ? "Mic OK" : "Mic gagal"} — ${d.text}`,
        d.kind === "err" ? "error" : ""
      );
    } else {
      const d = describeError(firstProblem);
      setStatus(d.text, d.kind === "err" ? "error" : "");
      if (firstProblem && firstProblem.name === "NotAllowedError") {
        setChip(el.chipCam, "err", "IZIN DITOLAK");
        setChip(el.chipMic, "err", "IZIN DITOLAK");
      }
    }
  } catch (err) {
    const d = describeError(err);
    setChip(el.chipCam, "err", d.short);
    setChip(el.chipMic, "err", d.short);
    setStatus(d.text, d.kind === "err" ? "error" : "");
  } finally {
    clearTimeout(state.slowPromptTimer);
    state.starting = false;
    el.btnStart.disabled = false;
    el.btnStart.textContent = state.stream ? "Mulai ulang" : "Mulai";
  }
}

function reset() {
  stopStream();
  idleChips();
  setStatus("Siap untuk unit berikutnya. Tekan Mulai.");
  el.btnStart.textContent = "Mulai";
}

/* ------------------------------------------------------------------ */
/* Neutralino (opsional, untuk membuka Settings Windows)               */
/* ------------------------------------------------------------------ */

async function initNeutralino() {
  try {
    if (typeof Neutralino === "undefined") return;
    Neutralino.init();
    const cfg = await Neutralino.app.getConfig();
    if (cfg && cfg.version) el.version.textContent = `v${cfg.version}`;
  } catch (e) {
    /* dijalankan di browser biasa: abaikan */
  }
}

async function openWindowsSettings(page) {
  const target = `ms-settings:${page}`;
  try {
    if (typeof Neutralino !== "undefined" && Neutralino.os && Neutralino.os.open) {
      await Neutralino.os.open(target);
      return;
    }
  } catch (e) {
    /* jatuh ke petunjuk manual */
  }
  const label = page === "privacy-webcam" ? "Camera" : "Microphone";
  setStatus(
    `Buka manual: Settings -> Privacy & security -> ${label} -> aktifkan akses aplikasi desktop.`
  );
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function wire() {
  el.btnStart.addEventListener("click", () => start());
  el.btnReset.addEventListener("click", () => reset());

  el.camSelect.addEventListener("change", () => start());
  el.micSelect.addEventListener("change", () => start());

  el.monitorToggle.addEventListener("change", () => {
    state.monitoring = el.monitorToggle.checked;
    applyMonitor();
  });

  let sliderDragging = false;
  el.monitorVol.addEventListener("input", () => {
    // Hanya terima perubahan dari drag/klik operator. Perubahan "liar"
    // (scroll, keyboard, atau state webview) dikembalikan ke nilai terakhir.
    if (!sliderDragging) {
      el.monitorVol.value = String(state.volumePercent);
      return;
    }
    const pct = Number(el.monitorVol.value);
    state.volumePercent = pct;
    state.volume = (pct / 100) * 0.9;
    el.volValue.textContent = `${pct}%`;
    applyMonitor();
  });

  el.monitorVol.addEventListener("pointerdown", () => {
    sliderDragging = true;
  });
  const endDrag = () => {
    sliderDragging = false;
  };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  // Cegah volume berubah tak sengaja saat operator scroll di atas slider.
  el.monitorVol.addEventListener(
    "wheel",
    (e) => e.preventDefault(),
    { passive: false }
  );

  // Chromium: AudioContext baru boleh berbunyi setelah ada interaksi.
  const resume = () => {
    const ctx = state.audio.ctx;
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  };
  document.addEventListener("pointerdown", resume, true);
  document.addEventListener("keydown", resume, true);

  document.querySelectorAll("[data-settings]").forEach((btn) => {
    btn.addEventListener("click", () => openWindowsSettings(btn.dataset.settings));
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      setTimeout(() => refreshDevices(), 400);
    });
  }

  window.addEventListener("beforeunload", () => stopStream());
}

function init() {
  // Nilai default eksplisit: jangan bergantung pada atribut HTML / state webview.
  const defaultPercent = 60;
  state.volumePercent = defaultPercent;
  state.volume = (defaultPercent / 100) * 0.9;
  el.monitorVol.value = String(defaultPercent);
  el.volValue.textContent = `${defaultPercent}%`;

  wire();
  initNeutralino();
  start();
}

init();
