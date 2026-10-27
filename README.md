# Webcam & Mic QC Tester

A **portable, offline** desktop app for laptop QC: tests the **camera** and **microphone** together, with microphone monitoring (*listen to this device*) and a live level meter.

Built with [Neutralinojs](https://neutralino.js.org), so the build output is a **single `.exe` (~2.4 MB)** that needs no installation and no internet connection.

Derived from [BlazeInferno64/Webcam-test](https://github.com/BlazeInferno64/Webcam-test) (GPL-3.0).

---

## Features

| Feature | Description |
|---|---|
| Camera preview | `object-fit: contain` — full frame, not cropped like the original |
| Camera info | actual resolution + **measured fps** (`requestVideoFrameCallback`) |
| Mic level meter | RMS dBFS (-60 … 0) with green/yellow/red zones + peak hold |
| Mic monitoring | live mic audio to speakers/headphones, adjustable volume |
| Device pickers | camera & microphone dropdowns (supports dual cameras / mic arrays) |
| Separate status | `KAMERA OK` / `MIC OK` / `… GAGAL` per device — no `alert()` popups |
| Auto-start | camera and mic are requested as soon as the app opens |
| Fully offline | no CDN, no external fonts, CSP `default-src 'self'` |

### Why AGC/NS/EC are disabled

```js
audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
```

If automatic processing stays enabled, a weak or noisy microphone gets "improved" by the algorithm, so **defects become invisible during QC**. All filters are disabled so the audio quality is reported as-is.

---

## Usage (QC)

1. Run `WebcamQC-win_x64.exe` from a USB stick or any folder.
2. Camera and microphone start automatically.
3. Check:
   - the camera image appears, resolution and fps look normal (e.g. `1280x720`, `30 fps`);
   - speak → the level meter moves and the dB value is sensible (normal speech ≈ -30 … -12 dB);
   - the audio is audible through headphones/speakers (monitoring enabled).
4. `Reset` → all devices are stopped, ready for the next unit.
5. If something fails, use the **Izin kamera / Izin mikrofon** (camera / microphone permission) buttons at the bottom right to open the relevant Windows settings page.

> **Feedback warning**: monitoring the mic through internal speakers can howl. Use headphones, or lower the volume / turn off the **Dengar langsung** (*listen to this device*) toggle.

### Error messages

The app UI is in Indonesian; the status chip labels are quoted as displayed.

| Chip label | Meaning | Action |
|---|---|---|
| `IZIN DITOLAK` | Windows blocks desktop app access | Settings → Privacy & security → Camera/Microphone → enable *Let desktop apps access* |
| `TIDAK ADA` | hardware not detected | check camera/mic cable and connector |
| `SIBUK` | device is held by another app | close that app, press **Mulai ulang** (Restart) |
| `TIDAK DIDUKUNG` | resolution/format not supported | pick another camera |

---

## Build from source

Requirements: Node.js (npm included). No compiler needed.

```powershell
npm install
npx neu update    # downloads the Neutralino binaries + client library (not committed)
npm run dist
```

`npm run dist` runs `neu build --embed-resources` and then embeds the app icon plus version info into the executable.

Output: `dist\WebcamQC\WebcamQC-win_x64.exe` — a single file with all resources embedded.

### Development mode

```powershell
npx neu run
```

### Project structure

```
resources/
  index.html          # single-screen, two-column UI
  css/styles.css
  js/app.js           # camera + audio logic
  js/neutralino.js    # client library (from `neu update`)
  icons/appIcon.png
neutralino.config.json
scripts/embed-icon.js # icon + version metadata injector
```

---

## Deployment notes

- **Runtime requirement**: WebView2 Runtime. It ships with Windows 11 and with any Windows 10 that has Microsoft Edge. On Windows 10 LTSC or stripped-down images, WebView2 must be installed once (requires internet, or the ~150 MB offline installer).
- WebView2 keeps a small profile in `%LOCALAPPDATA%` (a few MB). At runtime, Neutralino also creates a `.tmp` folder next to the executable to store the window position and size. Beyond that, the app writes nothing to the system and does not touch the registry.
- The executable is **unsigned**, so Windows SmartScreen may warn about an unknown publisher on first launch. Choose **More info → Run anyway**, or sign it with a code-signing certificate.
- Measured fps is the rate the camera actually delivers. In low light, many laptop cameras drop well below their nominal rate, so both values are displayed (nominal in the camera info, measured at the right).

---

## License

GPL-3.0 — see [LICENSE](LICENSE).
Original code: Copyright (c) BlazeInferno64.
