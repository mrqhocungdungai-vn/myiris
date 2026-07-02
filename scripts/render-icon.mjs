// Rasterize build/icon.svg -> build/icon.png (1024x1024, transparent corners)
// using the bundled Electron/Chromium. Run: node_modules/.bin/electron scripts/render-icon.mjs
import electron from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { app, BrowserWindow } = electron;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const svgPath = path.join(root, "build", "icon.svg");
const outPath = path.join(root, "build", "icon.png");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 1200 });
  await win.loadURL("about:blank");
  const svg = fs.readFileSync(svgPath, "utf8");

  const dataUrl = await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 1024;
        canvas.getContext("2d").drawImage(img, 0, 0, 1024, 1024);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("SVG failed to load"));
      img.src = "data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}";
    })
  `);

  fs.writeFileSync(outPath, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote", outPath);

  // macOS menu-bar template icon (black + alpha only): a minimal orb glyph —
  // tick ring, open scan arc, and core dot. Rendered at 1x and 2x.
  const trayScript = (size) => `
    (() => {
      const s = ${size};
      const canvas = document.createElement("canvas");
      canvas.width = s; canvas.height = s;
      const c = canvas.getContext("2d");
      const cx = s / 2, cy = s / 2, u = s / 22;
      c.strokeStyle = "#000"; c.fillStyle = "#000"; c.lineCap = "round";

      // Tick ring
      c.lineWidth = Math.max(1, u * 0.9);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r1 = u * 9.4, r2 = u * 8.2;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        c.stroke();
      }

      // Scan arc
      c.lineWidth = Math.max(1, u * 1.3);
      c.beginPath();
      c.arc(cx, cy, u * 6.1, -0.6 * Math.PI, 0.55 * Math.PI);
      c.stroke();

      // Core
      c.beginPath();
      c.arc(cx, cy, u * 2.6, 0, Math.PI * 2);
      c.fill();

      return canvas.toDataURL("image/png");
    })()
  `;

  for (const [file, size] of [["trayTemplate.png", 22], ["trayTemplate@2x.png", 44]]) {
    const trayUrl = await win.webContents.executeJavaScript(trayScript(size));
    fs.writeFileSync(path.join(root, "build", file), Buffer.from(trayUrl.split(",")[1], "base64"));
    console.log("wrote", path.join(root, "build", file));
  }

  app.quit();
});
