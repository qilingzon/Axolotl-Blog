// 生成美西螈全家族位图变体：从启动器粉色原图按亮度阶梯重上色。
// 色板锚点采样自 Minecraft 1.18 官方贴图（scripts/sample-official.mjs），
// 紫色为站点二创色。重新生成：node scripts/generate-variants.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from './png.mjs';

// 每个变体的亮度锚点（暗→亮），采样自官方贴图主色簇；
// gill 为可选的鳃部色带（源图最暗的彩色带=外鳃），如官方 cyan 变体是蓝身体粉鳃。
// green 为被砍掉的预告片变体（Minecraft Live 2020 展示后未进游戏，wiki Trivia 有载），色板为手调。
const RAMPS = {
  purple: { body: ['#6c4bc4', '#9b7bd4', '#c9b8f0', '#e4dbf8'] }, // 二创紫（站点主题紫螈）
  wild: { body: ['#503f30', '#604c3b', '#8b6543', '#a27a56'] }, // 官方 wild 棕
  cyan: {
    body: ['#6cb2de', '#b0d5fc', '#d3e5fd', '#e2eeff'], // 官方 cyan 青
    gill: ['#c2457f', '#e0709e'], // 官方贴图：青螈的鳃是粉色
  },
  gold: { body: ['#b6710e', '#d69a1f', '#ffd11b', '#ffe27a'] }, // 官方 gold 金
  blue: { body: ['#5b6fe3', '#8690f5', '#a79fff', '#c3c0ff'] }, // 官方 blue 蓝
  green: { body: ['#3d7a2b', '#58a83c', '#8fd45f', '#c7eda0'] }, // 预告片绿色（被砍变体）
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** 亮度 t 在锚点带上插值 */
function rampColor(ramp, t) {
  const segs = ramp.length - 1;
  const seg = Math.min(segs - 1, Math.floor(t * segs));
  const f = t * segs - seg;
  return [0, 1, 2].map((c) =>
    Math.round(ramp[seg][c] + (ramp[seg + 1][c] - ramp[seg][c]) * f)
  );
}

function rgb2hsl(r, g, b) {
  const [rf, gf, bf] = [r / 255, g / 255, b / 255];
  const mx = Math.max(rf, gf, bf), mn = Math.min(rf, gf, bf);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === rf) h = (gf - bf) / d + (gf < bf ? 6 : 0);
  else if (mx === gf) h = (bf - rf) / d + 2;
  else h = (rf - gf) / d + 4;
  return [h / 6, s, l];
}

const { w, h, rgba } = decodePng(readFileSync('public/assets/axolotl-launcher.png'));

// 1) 收集彩色不透明像素的亮度范围
let lMin = 1, lMax = 0;
for (let i = 0; i < w * h; i++) {
  const o = i * 4;
  if (rgba[o + 3] < 16) continue;
  const [, s, l] = rgb2hsl(rgba[o], rgba[o + 1], rgba[o + 2]);
  if (s < 0.15) continue;
  if (l < lMin) lMin = l;
  if (l > lMax) lMax = l;
}

// 2) 逐变体重上色：彩色像素按归一化亮度查锚点插值，中性像素（眼/白）保留；
//    配置了 gill 的变体，最暗的彩色带（外鳃区域）用鳃部色带
const GILL_BAND = 0.16; // 源图归一化亮度低于此值的彩色像素视为鳃
for (const [name, cfg] of Object.entries(RAMPS)) {
  const body = cfg.body.map(hex);
  const gill = cfg.gill ? cfg.gill.map(hex) : null;
  const out = Buffer.from(rgba);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 16) continue;
    const [, s, l] = rgb2hsl(rgba[o], rgba[o + 1], rgba[o + 2]);
    if (s < 0.15) continue; // 眼睛、高光白等中性色不动
    const t = Math.min(1, Math.max(0, (l - lMin) / (lMax - lMin || 1)));
    const rgb = gill && t < GILL_BAND ? rampColor(gill, t / GILL_BAND) : rampColor(body, t);
    for (let c = 0; c < 3; c++) out[o + c] = rgb[c];
  }
  const file = `public/assets/axolotl-${name}.png`;
  writeFileSync(file, encodePng({ w, h, rgba: out }));
  console.log(`ok ${file}`);
}
