// 美西螈 CMS · /m/<图片名> 公开出图路由
// 从 KV 命名空间（绑定变量名 CMS_KV）取图片字节，供文章正文和访客直接引用：
// 上传走 KV 零构建路径后，图片不会出现在站点构建产物里，就靠这个路由实时出图。
// 约定与 edge-functions/api/[[default]].js 的媒体部分一致（两处同步改）：
//   文件名白名单 IMG_NAME_RE；KV key = 'u_' + 名字的十六进制（KV key 仅允许字母数字下划线）。
// 安全：名字先过白名单再拼 key，只能读到上传目录里的图；无鉴权但也不出站（只读 KV）。
// 缓存：文件名带时间戳、内容与名字一一对应，响应可长缓存——访客命中缓存不再回源。

const IMG_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.(png|jpe?g|webp|gif|avif)$/i;

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

function keyOf(name) {
  const bytes = new TextEncoder().encode(name);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return 'u_' + hex;
}

function kvBinding() {
  if (typeof globalThis.CMS_KV !== 'undefined') return globalThis.CMS_KV;
  return null;
}

export async function onRequestGet(context) {
  const raw = (context.params && context.params.name) || '';
  let name = '';
  try {
    name = decodeURIComponent(raw);
  } catch {
    return new Response('图片地址不合法', { status: 404 });
  }
  if (!IMG_NAME_RE.test(name)) {
    return new Response('图片地址不合法', { status: 404 });
  }
  const kv = (context.env && context.env.CMS_KV) || kvBinding();
  if (!kv) {
    return new Response(
      'KV 存储未绑定：请在 EdgeOne 控制台为项目绑定 KV 命名空间，变量名填 CMS_KV（见后台 /admin/setup.html）',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
  let bytes;
  try {
    bytes = await kv.get(keyOf(name), { type: 'arrayBuffer' });
  } catch {
    return new Response('图片读取失败，请稍后重试', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  if (!bytes) {
    return new Response('图片不存在或已被删除', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const m = name.match(/\.([a-z0-9]+)$/i);
  const ext = m && m[1] ? m[1].toLowerCase() : '';
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
