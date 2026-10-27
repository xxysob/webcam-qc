/*
  Tempelkan ikon + metadata ke exe hasil `neu build`.
  Neutralino memakai ikon default pada binernya; script ini menggantinya
  dengan resources/icons/appIcon.png agar exe terlihat seperti aplikasi kita.
*/
const fs = require("fs");
const path = require("path");
const ResEdit = require("resedit");
const png2icons = require("png2icons");

const root = path.resolve(__dirname, "..");
const pngPath = path.join(root, "resources", "icons", "appIcon.png");

const exeCandidates = [
  path.join(root, "dist", "WebcamQC", "WebcamQC-win_x64.exe"),
];
const exePath = exeCandidates.find((p) => fs.existsSync(p));

if (!exePath) {
  console.error("Exe tidak ditemukan. Jalankan `npm run build` lebih dulu.");
  process.exit(1);
}

// 1. PNG -> ICO (format khusus Windows executable)
const png = fs.readFileSync(pngPath);
const ico = png2icons.createICO(png, png2icons.BICUBIC, 0, true, true);
if (!ico) {
  console.error("Gagal membuat ICO dari PNG.");
  process.exit(1);
}
const icoPath = path.join(root, "build", "appIcon.ico");
fs.mkdirSync(path.dirname(icoPath), { recursive: true });
fs.writeFileSync(icoPath, ico);

// 2. Sisipkan ikon + version info ke exe
const exeBuffer = fs.readFileSync(exePath);
const exe = ResEdit.NtExecutable.from(exeBuffer, { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);

const iconFile = ResEdit.Data.IconFile.from(ico);
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  res.entries,
  1,
  1033,
  iconFile.icons.map((i) => i.data)
);

try {
  const versionEntries = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (versionEntries.length) {
    const vi = versionEntries[0];
    const strings = {
      FileDescription: "Webcam & Mic QC Tester",
      ProductName: "Webcam & Mic QC Tester",
      LegalCopyright: "GPL-3.0 | based on BlazeInferno64/Webcam-test",
      OriginalFilename: "WebcamQC-win_x64.exe",
    };
    vi.setStringValues({ lang: 1033, codepage: 1200 }, strings);
    vi.setFileVersion(1, 0, 0, 0, 1033);
    vi.setProductVersion(1, 0, 0, 0, 1033);
    vi.outputToResourceEntries(res.entries);
  }
} catch (e) {
  console.warn("Lewati version info:", e.message);
}

res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));

// 3. Bersihkan binary platform lain (kita hanya distribusi Windows x64)
const distDir = path.dirname(exePath);
for (const f of fs.readdirSync(distDir)) {
  const full = path.join(distDir, f);
  if (f === path.basename(exePath)) continue;
  if (/^WebcamQC-(linux|mac)/.test(f) || f === "resources.neu" || f === ".tmp") {
    fs.rmSync(full, { recursive: true, force: true });
  }
}

const size = (fs.statSync(exePath).size / (1024 * 1024)).toFixed(2);
console.log(`OK: ikon & metadata ditanam -> ${path.relative(root, exePath)} (${size} MB)`);
