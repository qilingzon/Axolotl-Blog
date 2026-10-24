// 美西螈 CMS 本地开发服务器：静态 dist/ + 挂载边缘函数（Node 24 原生 Web API）
// 用法：npm run build && node scripts/cms-dev.mjs（环境变量从 .env.local 读取）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8090);

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
    let file = join(DIST, decodeURIComponent(url.pathname));
    let st = existsSync(file) ? statSync(file) : null;
    if (st && st.isDirectory()) file = join(file, 'index.html');
    else if (!st) {
      const pretty = join(DIST, url.pathname.replace(/\/$/, ''), 'index.html');
      file = existsSync(pretty) ? pretty : join(DIST, '404.html');
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
