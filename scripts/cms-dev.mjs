// 美西螈 CMS 本地开发服务器：静态 dist/ + 挂载边缘函数（Node 24 原生 Web API）
// 用法：npm run build && node scripts/cms-dev.mjs（环境变量从 .env.local 读取）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// 博客仓构建后用 dist/；独立仓（Axolotl-CMS）没有构建步骤，直接服务 public/——同一份脚本两仓通用
const DIST = existsSync(join(ROOT, 'dist')) ? join(ROOT, 'dist') : join(ROOT, 'public');
// 默认 8792：8090 常被本机反代等工具占用（127.0.0.1:8090 抢答导致请求时通时不通），换冷门端口
const PORT = Number(process.env.PORT || 8792);

// 本机若装有 Watt Toolkit(SteamTools)/安全软件等 HTTPS 加速层，GitHub 证书会被换成其私有 CA，
// Node 自带 CA 集不认（fetch failed: UNABLE_TO_VERIFY_LEAF_SIGNATURE），而 gh/浏览器走系统证书库正常。
// 这里带上系统证书库重启自身（仅本地开发服务器；线上 EdgeOne 运行时不受影响）。
if (!process.env.NODE_USE_SYSTEM_CA) {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, NODE_USE_SYSTEM_CA: '1' },
    stdio: 'inherit',
  });
  child.on('exit', (c) => process.exit(c ?? 0));
  await new Promise(() => {}); // 父进程驻守等待子进程，绝不能再往下跑出第二个服务器
}

// 读取 .env.local（KEY=VALUE 每行一条）
const env = { ...process.env };
const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2];
  }
}

const mod = await import(pathToFileURL(join(ROOT, 'edge-functions/api/[[default]].js')).href);
if (typeof mod.onRequest !== 'function') {
  console.error('未找到 onRequest 导出');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // API：交给边缘函数处理器
    if (url.pathname.startsWith('/api/')) {
      const body = ['GET', 'HEAD'].includes(req.method)
        ? undefined
        : await new Promise((ok) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => ok(Buffer.concat(chunks)));
          });
      const webReq = new Request(url.href, {
        method: req.method,
        headers: req.headers,
        body,
      });
      const ctx = {
        request: webReq,
        env,
        params: {},
        waitUntil: () => {},
      };
      const webRes = await mod.onRequest(ctx);
      res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
      res.end(Buffer.from(await webRes.arrayBuffer()));
      return;
    }
    // 静态文件：目录 → index.html；不存在 → 404.html 兜底
    if (url.pathname === '/' && !existsSync(join(DIST, 'index.html'))) {
      // 根目录没有首页（独立仓形态）：直接送到后台
      res.writeHead(302, { Location: '/admin/' });
      res.end();
      return;
    }
    let file = join(DIST, decodeURIComponent(url.pathname));
    let st = existsSync(file) ? statSync(file) : null;
    if (st && st.isDirectory()) file = join(file, 'index.html');
    else if (!st) {
      const pretty = join(DIST, url.pathname.replace(/\/$/, ''), 'index.html');
      file = existsSync(pretty) ? pretty : join(DIST, '404.html');
    }
    if (!existsSync(file)) {
      // 404 页也不存在（独立仓 public/ 没带）：纯文本兜底，别让服务器 500
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404：这个地址不存在。后台在 /admin/');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('本地服务器错误：' + (err && err.message));
  }
}).listen(PORT, () => {
  console.log(`美西螈 CMS 本地环境: http://localhost:${PORT}/admin/（API 同源挂载）`);
});
