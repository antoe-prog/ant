import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const outputDirectory = path.join(root, "mobile/android/play-store");
const iconSource = path.join(root, "mobile/android/twa/store_icon.png");
const markSource = path.join(root, "public/brand/final-mark.png");
const iconOutput = path.join(outputDirectory, "app-icon-512.png");
const graphicOutput = path.join(outputDirectory, "feature-graphic-1024x500.png");

await mkdir(outputDirectory, { recursive: true });
await copyFile(iconSource, iconOutput);

const blackMark = await sharp(markSource)
  .resize({ width: 76, height: 76, fit: "contain" })
  .png()
  .toBuffer();
const whiteMark = await sharp(markSource)
  .resize({ width: 224, height: 224, fit: "contain" })
  .negate({ alpha: false })
  .png()
  .toBuffer();

const background = Buffer.from(`
  <svg width="1024" height="500" viewBox="0 0 1024 500" xmlns="http://www.w3.org/2000/svg">
    <rect width="1024" height="500" fill="#F7FAF9"/>
    <rect x="690" width="334" height="500" fill="#101214"/>
    <rect x="680" width="10" height="500" fill="#00897B"/>

    <text x="152" y="113" fill="#101214" font-family="Arial Black, Impact, Arial, sans-serif" font-size="68" font-weight="900" font-style="italic" letter-spacing="0">FINAL</text>
    <text x="64" y="168" fill="#00796B" font-family="Apple SD Gothic Neo, Noto Sans CJK KR, sans-serif" font-size="22" font-weight="700">회원 · 학부모 수련 정보</text>
    <text x="64" y="238" fill="#111315" font-family="Apple SD Gothic Neo, Noto Sans CJK KR, sans-serif" font-size="46" font-weight="700">수업부터 성장까지,</text>
    <text x="64" y="307" fill="#111315" font-family="Apple SD Gothic Neo, Noto Sans CJK KR, sans-serif" font-size="62" font-weight="800">한눈에</text>

    <line x1="64" y1="355" x2="610" y2="355" stroke="#CBD5D2" stroke-width="2"/>
    <text x="64" y="401" fill="#46504D" font-family="Apple SD Gothic Neo, Noto Sans CJK KR, sans-serif" font-size="23" font-weight="600">수업 · 출석 · 회비 · 승급 · 공지</text>

    <text x="857" y="404" text-anchor="middle" fill="#9FE3D9" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="2">FINAL JUDO</text>
  </svg>
`);

await sharp(background)
  .composite([
    { input: blackMark, left: 64, top: 48 },
    { input: whiteMark, left: 745, top: 126 },
  ])
  .flatten({ background: "#F7FAF9" })
  .removeAlpha()
  .png({ compressionLevel: 9, palette: false })
  .toFile(graphicOutput);

console.log(JSON.stringify({
  icon: path.relative(root, iconOutput),
  featureGraphic: path.relative(root, graphicOutput),
}, null, 2));
