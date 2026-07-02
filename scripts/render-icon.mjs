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
  app.quit();
});
