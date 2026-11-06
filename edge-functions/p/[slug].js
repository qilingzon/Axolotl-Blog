// 美西螈 CMS · /p/<slug> 公开文章路由
// 两个职责（约定与 edge-functions/api/[[default]].js 的文章 KV 层一致，两处同步改）：
//   1) ?fmt=json → {at, title, html}：文章页探针的热替换数据源（no-store 保新鲜）
//   2) 无 fmt    → 自包含预览 HTML：攒批中（未入库）文章/草稿的预览页
// 安全：slug 先过 SLUG_RE 白名单再拼 key，只读 KV、不出站；KV 未绑 → 503 中文提示。
// KV key = 'p_' + slug 的十六进制（KV key 仅允许字母数字下划线，见 API 文件 kvPostKey）。

const SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;

function keyOf(slug) {
  const bytes = new TextEncoder().encode(slug);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return 'p_' + hex;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function kvBinding(context) {
  if (context.env && context.env.CMS_KV) return context.env.CMS_KV;
  if (typeof globalThis.CMS_KV !== 'undefined') return globalThis.CMS_KV;
  return null;
}

function textResponse(body, status, extraHeaders) {
  return new Response(body, {
    status,
    headers: Object.assign(
      { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      extraHeaders || {}
    ),
  });
}

/** 攒批预览页：自包含 HTML（内联基础样式），正式样式以入库构建后的 /blog/ 或 /preview/ 页为准 */
function previewPage(v) {
  const meta = v.meta || {};
  const title = String(meta.title || v.slug || '未命名');
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const date = meta.pubDate ? String(meta.pubDate).slice(0, 10) : '';
  const bodyHtml = String(v.html || '')
    ? String(v.html)
    : '<p style="color:#888">（这篇还没生成渲染快照）</p>';
  return (
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<title>' + esc(title) + ' · 攒批预览</title>' +
    '<style>' +
    'body{margin:0;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#faf7f8;color:#3a3335;line-height:1.75}' +
    'main{max-width:720px;margin:0 auto;padding:28px 18px 60px}' +
    '.pv-tip{font-size:13px;color:#b05a7c;background:#fdf0f4;border:1px dashed #e8b4c4;border-radius:8px;padding:8px 12px}' +
    'h1{font-size:1.7em;margin:22px 0 6px;line-height:1.3}' +
    '.pv-meta{font-size:13px;color:#8a8085;margin:0 0 20px}' +
    '.pv-tag{display:inline-block;font-size:12px;background:#f3e3ea;border-radius:99px;padding:2px 10px;margin-right:6px}' +
    'article img{max-width:100%;height:auto}article pre{overflow:auto;background:#f5eef1;padding:12px;border-radius:8px}' +
    'article code{background:#f5eef1;border-radius:4px;padding:1px 5px}article blockquote{border-left:3px solid #e8b4c4;margin:0;padding:2px 14px;color:#7a6f74}' +
    'table{border-collapse:collapse}td,th{border:1px solid #e0d4d9;padding:6px 10px}' +
    '.pv-foot{margin-top:34px;font-size:13px}a{color:#c2527f}' +
    '</style></head><body><main>' +
    '<p class="pv-tip">攒批预览：这是保存在 KV 里的最新版，还没入库构建；正式页面在入库后生成。</p>' +
    '<h1>' + esc(title) + '</h1>' +
    '<p class="pv-meta">' + (date ? esc(date) + ' · ' : '') +
    tags.map(function (t) { return '<span class="pv-tag">' + esc(t) + '</span>'; }).join('') +
    '</p><article>' + bodyHtml + '</article>' +
    '<p class="pv-foot"><a href="/admin/">回后台</a></p>' +
    '</main></body></html>'
  );
}

export async function onRequestGet(context) {
  const raw = (context.params && context.params.slug) || '';
  let slug = '';
  try {
    slug = decodeURIComponent(raw);
  } catch {
    return textResponse('文章地址不合法', 404);
  }
  if (!SLUG_RE.test(slug)) {
    return textResponse('文章地址不合法', 404);
  }
  const kv = kvBinding(context);
  if (!kv) {
    return textResponse('KV 存储未绑定：请在 EdgeOne 控制台为项目绑定 KV 命名空间，变量名填 CMS_KV（见后台 /admin/setup.html）', 503);
  }
  let rawVal;
  try {
    rawVal = await kv.get(keyOf(slug));
  } catch {
    return textResponse('文章读取失败，请稍后重试', 502);
  }
  if (!rawVal) {
    return textResponse('这篇文章没有未入库的最新版（可能已经入库，正式页面请直接访问 /blog/）', 404);
  }
  let v;
  try {
    v = JSON.parse(rawVal);
  } catch {
    return textResponse('快照损坏，请回后台重新保存一次', 502);
  }
  const meta = v.meta || {};
  const url = new URL(context.request.url);
  if (url.searchParams.get('fmt') === 'json') {
    return new Response(
      JSON.stringify({
        at: v.at || 0,
        title: String(meta.title || slug),
        html: String(v.html || ''),
        draft: meta.draft === true, // 草稿标志：公开文章页探针见到必须跳过，不能把草稿推给访客
      }),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  }
  return new Response(previewPage(v), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
