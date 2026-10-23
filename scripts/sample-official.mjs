// 采样官方美西螈贴图色板：按亮度分档输出身体/鳃/肚皮色锚点
import { readFileSync } from 'node:fs';
import { decodePng } from './png.mjs';

const variants = ['lucy', 'wild', 'cyan', 'gold', 'blue'];

function rgb2hsl(r, g, b) {
  const [rf, gf, bf] = [r / 255, g / 255, b / 255];
  const mx = Math.max(rf, gf, bf), mn = Math.min(rf, gf, bf);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
    else if (mx === gf) h = ((bf - rf) / d + 2) / 6;
    else h = ((rf - gf) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

for (const v of variants) {
  const { w, h, rgba } = decodePng(readFileSync(`design-assets/official-${v}.png`));
  // 贴图含身体/鳃/肚皮，收集不透明彩色像素
  const colorful = [];
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 200) continue;
    const [hs, ss, ls] = rgb2hsl(rgba[o], rgba[o + 1], rgba[o + 2]);
    if (ss < 0.15) continue;
    colorful.push({ r: rgba[o], g: rgba[o + 1], b: rgba[o + 2], h: hs, s: ss, l: ls });
  }
  colorful.sort((a, b) => a.l - b.l);
  // 只保留中位色相 ±40° 的主色簇，排除贴图里的小杂色区域（如口腔/眼周）
  const hues = colorful.map((c) => c.h).sort((a, b) => a - b);
  const medianHue = hues[Math.floor(hues.length / 2)];
  const main = colorful.filter((c) => {
    const d = Math.abs(c.h - medianHue);
    return Math.min(d, 360 - d) <= 40;
  });
  const pct = (p) => main[Math.floor(main.length * p)];
  const anchors = [0.1, 0.35, 0.6, 0.85].map((p) => {
    const c = pct(p);
    return `#${[c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
  });
  console.log(
    `${v.padEnd(5)} px=${w}x${h} main=${main.length}/${colorful.length} hue=${Math.round(medianHue)}° anchors(dark→light)=`,
    anchors.join(' ')
  );
}
