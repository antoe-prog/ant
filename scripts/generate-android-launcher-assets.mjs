import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const SOURCE_ICON = "public/icons/final-judo-icon-512.png";
const MODE = process.argv.includes("--check") ? "check" : "write";
const CAP_ROOT = "mobile/android-cap/app/src/main/res";
const TWA_ROOT = "mobile/android/twa/app/src/main/res";
const TWA_STORE_ICON = "mobile/android/twa/store_icon.png";
const DENSITIES = [
  { name: "mdpi", launcher: 48, foreground: 108, twaMaskable: 82 },
  { name: "hdpi", launcher: 72, foreground: 162, twaMaskable: 123 },
  { name: "xhdpi", launcher: 96, foreground: 216, twaMaskable: 164 },
  { name: "xxhdpi", launcher: 144, foreground: 324, twaMaskable: 246 },
  { name: "xxxhdpi", launcher: 192, foreground: 432, twaMaskable: 328 },
];

const CAP_SPLASHES = [
  ["drawable/splash.png", 480, 320],
  ["drawable-land-mdpi/splash.png", 480, 320],
  ["drawable-land-hdpi/splash.png", 800, 480],
  ["drawable-land-xhdpi/splash.png", 1280, 720],
  ["drawable-land-xxhdpi/splash.png", 1600, 960],
  ["drawable-land-xxxhdpi/splash.png", 1920, 1280],
  ["drawable-port-mdpi/splash.png", 320, 480],
  ["drawable-port-hdpi/splash.png", 480, 800],
  ["drawable-port-xhdpi/splash.png", 720, 1280],
  ["drawable-port-xxhdpi/splash.png", 960, 1600],
  ["drawable-port-xxxhdpi/splash.png", 1280, 1920],
];

const TWA_SPLASHES = [
  ["drawable-mdpi/splash.png", 300, 300],
  ["drawable-hdpi/splash.png", 450, 450],
  ["drawable-xhdpi/splash.png", 600, 600],
  ["drawable-xxhdpi/splash.png", 900, 900],
  ["drawable-xxxhdpi/splash.png", 1200, 1200],
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function renderIcon(sourceIcon, size) {
  return sharp(sourceIcon)
    .resize(size, size, { fit: "contain", background: "#FFFFFF" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function renderSplash(sourceIcon, width, height) {
  const iconSize = Math.round(Math.min(width, height) * 0.28);
  const icon = await renderIcon(sourceIcon, iconSize);

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#FFFFFF",
    },
  })
    .composite([{ input: icon, left: Math.round((width - iconSize) / 2), top: Math.round((height - iconSize) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writeOrCheck(filePath, buffer) {
  if (MODE === "write") {
    await writeFile(filePath, buffer);
    return { path: filePath, sha256: sha256(buffer), updated: true };
  }

  const actual = await readFile(filePath);
  assert.equal(sha256(actual), sha256(buffer), `${filePath} is not generated from ${SOURCE_ICON}`);
  return { path: filePath, sha256: sha256(buffer), updated: false };
}

async function main() {
  const sourceIcon = await readFile(SOURCE_ICON);
  const generated = [];

  generated.push(await writeOrCheck(TWA_STORE_ICON, sourceIcon));

  for (const density of DENSITIES) {
    const capLauncher = await renderIcon(sourceIcon, density.launcher);
    const capForeground = await renderIcon(sourceIcon, density.foreground);
    const twaMaskable = await renderIcon(sourceIcon, density.twaMaskable);

    generated.push(await writeOrCheck(path.join(CAP_ROOT, `mipmap-${density.name}/ic_launcher.png`), capLauncher));
    generated.push(await writeOrCheck(path.join(CAP_ROOT, `mipmap-${density.name}/ic_launcher_round.png`), capLauncher));
    generated.push(await writeOrCheck(path.join(CAP_ROOT, `mipmap-${density.name}/ic_launcher_foreground.png`), capForeground));

    generated.push(await writeOrCheck(path.join(TWA_ROOT, `mipmap-${density.name}/ic_launcher.png`), capLauncher));
    generated.push(await writeOrCheck(path.join(TWA_ROOT, `mipmap-${density.name}/ic_maskable.png`), twaMaskable));
  }

  for (const [relativePath, width, height] of CAP_SPLASHES) {
    generated.push(await writeOrCheck(path.join(CAP_ROOT, relativePath), await renderSplash(sourceIcon, width, height)));
  }

  for (const [relativePath, width, height] of TWA_SPLASHES) {
    generated.push(await writeOrCheck(path.join(TWA_ROOT, relativePath), await renderSplash(sourceIcon, width, height)));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: MODE,
        sourceIcon: SOURCE_ICON,
        generatedCount: generated.length,
        checked: generated.map((asset) => asset.path),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
