// 美西螈 CMS · 边缘函数 API（EdgeOne Pages）
// 单文件全能路由：/api/login、/api/session、/api/posts[/{slug}]、/api/media
// 鉴权：环境变量账号密码 → HMAC 签名 token；GitHub 读写仅发生在服务端。
// 出站请求安全约定：全部经 ghFetch()，基址为常量 api.github.com 且带白名单守卫，
// 路径逐段 encodeURIComponent，绝不拼接用户提供的完整 URL。

const GH_API = 'https://api.github.com';

const CFG = {
  user: () => envGetter('CMS_USERNAME'),
  pass: () => envGetter('CMS_PASSWORD'),
  secret: () => envGetter('CMS_SESSION_SECRET'),
  token: () => envGetter('CMS_GITHUB_TOKEN'),
  repo: () => envGetter('CMS_REPO') || 'qilingzon/Axolotl-Blog',
  branch: () => envGetter('CMS_BRANCH') || 'master',
};

// EdgeOne 环境变量经 context.env 注入；本地开发兜底读全局 env 对象
let CTX_ENV = {};
function envGetter(name) {
  return CTX_ENV[name] || (typeof globalThis.env === 'object' ? globalThis.env[name] : undefined);
}

const POSTS_DIR = 'src/content/blog';
const MEDIA_DIR = 'public/assets/uploads';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
/** slug 白名单：ASCII 字母数字开头，仅含字母数字._-，防路径注入 */
const SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;

// ---------- 通用工具 ----------

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64uEncode(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64uDecode(str) {
  const b64 = str.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(b64) {
  // GitHub contents API 的 base64 每 60 字符夹一个换行，部分边缘运行时的 atob 不容忍空白
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSign(data) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(CFG.secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

/** 常数时间字符串比较（防时序侧信道） */
function safeEqual(a, b) {
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

// ---------- 登录限速（模块级全局计数：个人站单账号场景够用，且不采集任何来源信息） ----------

const loginFails = { count: 0, until: 0 };

function tooManyFails() {
  return loginFails.count >= 5 && Date.now() < loginFails.until;
}

function recordFail() {
  loginFails.count += 1;
  loginFails.until = Date.now() + 15 * 60 * 1000;
}

function clearFails() {
  loginFails.count = 0;
  loginFails.until = 0;
}

// ---------- 会话 token ----------

async function issueToken(user) {
  const payload = b64uEncode(enc.encode(JSON.stringify({ u: user, e: Date.now() + TOKEN_TTL_MS })));
  const sig = b64uEncode(await hmacSign(payload));
  return payload + '.' + sig;
}

async function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expect = b64uEncode(await hmacSign(payload));
  if (!safeEqual(sig, expect)) return null;
  try {
    const data = JSON.parse(dec.decode(b64uDecode(payload)));
    if (!data.e || Date.now() > data.e) return null;
    return data;
  } catch {
    return null;
  }
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** 需要登录的接口统一校验：通过返回会话数据，否则 null */
async function requireAuth(request) {
  const data = await verifyToken(bearer(request));
  return data || null;
}

// ---------- GitHub API 层（全站唯一出站请求出口） ----------

/** 出站白名单：仅 https + api.github.com */
function assertOutboundAllowed(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.github.com') {
    throw new Error('出站请求目标不在白名单内，已拦截');
  }
}

/**
 * 安全出站请求：URL 由常量基址 + 逐段编码的路径段拼成，query 为固定键值。
 * segments: string[]（每段 encodeURIComponent）；query: Record<string,string>
 */
async function ghFetch(segments, { method = 'GET', body, query = {} } = {}) {
  // 段内允许斜杠（repo 名、目录路径），先拆分再逐段编码
  const path = segments
    .flatMap((s) => String(s).split('/'))
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/');
  const qs = new URLSearchParams({ ref: CFG.branch(), ...(query || {}) });
  const url = `${GH_API}/${path}?${qs.toString()}`;
  assertOutboundAllowed(url);
  const headers = {
    Authorization: `Bearer ${CFG.token()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'axolotl-cms',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = data && data.message ? data.message : `GitHub API ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

function repoSegments(...rest) {
  return ['repos', CFG.repo(), ...rest];
}

/**
 * GraphQL 查询（端点同为 api.github.com，白名单不变）：一次请求取回目录下全部
 * 文件名与正文。REST 目录列表不带 content，逐篇 GET 是 1+N 次请求。
 * 仅用于固定拼装的只读查询，变量经参数化传入。
 */
async function ghGraphQL(query, variables) {
  const url = `${GH_API}/graphql`;
  assertOutboundAllowed(url);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CFG.token()}`,
      'Content-Type': 'application/json',
      'User-Agent': 'axolotl-cms',
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.errors) {
    const msg =
      data && data.errors && data.errors[0] ? data.errors[0].message : `GitHub GraphQL ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data.data;
}

// ---------- 路由入口 ----------

export async function onRequest(context) {
  CTX_ENV = context.env || {};
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  try {
    if (path === '/api/login' && method === 'POST') return await handleLogin(request);
    if (!envConfigured()) {
      return fail(
        'CMS 尚未配置：请在 EdgeOne 项目环境变量里设置 CMS_USERNAME / CMS_PASSWORD / CMS_SESSION_SECRET / CMS_GITHUB_TOKEN（打开 /admin/setup.html 部署助手，点几下就能生成这 4 个值）',
        503
      );
    }
    const auth = await requireAuth(request);
    if (!auth) return fail('未登录或登录已过期，请重新登录', 401);

    if (path === '/api/session' && method === 'GET') {
      return json({ user: auth.u, expiresAt: auth.e });
    }
    if (path === '/api/posts' && method === 'GET') return await handleListPosts();
    if (path.startsWith('/api/posts/')) {
      return await handlePostItem(method, path.slice('/api/posts/'.length), request);
    }
    if (path === '/api/media' && method === 'GET') return await handleListMedia();
    if (path === '/api/media' && method === 'POST') return await handleUploadMedia(request);
    if (path === '/api/media' && method === 'DELETE') return await handleDeleteMedia(url);
    return fail('接口不存在', 404);
  } catch (err) {
    const status = err && err.status ? (err.status === 404 ? 500 : 502) : 500;
    return fail('服务器开小差了：' + (err && err.message ? err.message : String(err)), status);
  }
}

function envConfigured() {
  return CFG.user() && CFG.pass() && CFG.secret() && CFG.token();
}

async function handleLogin(request) {
  if (tooManyFails()) return fail('失败次数太多，请 15 分钟后再试', 429);
  if (!envConfigured()) {
    return fail(
      'CMS 尚未配置：请在 EdgeOne 项目环境变量里设置 CMS_USERNAME / CMS_PASSWORD / CMS_SESSION_SECRET / CMS_GITHUB_TOKEN（打开 /admin/setup.html 部署助手，点几下就能生成这 4 个值）',
      503
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求格式错误');
  }
  const { username, password } = body || {};
  if (!username || !password) return fail('请输入用户名和密码');
  if (
    safeEqual(String(username), String(CFG.user())) &&
    safeEqual(String(password), String(CFG.pass()))
  ) {
    clearFails();
    return json({ token: await issueToken(String(username)), expiresAt: Date.now() + TOKEN_TTL_MS });
  }
  recordFail();
  // 第 5 次失败即触发锁定窗口，直接告知锁定；其余次数预告剩余额度
  if (tooManyFails()) return fail('失败次数太多，请 15 分钟后再试', 429);
  return fail(`用户名或密码不正确，还可尝试 ${5 - loginFails.count} 次`, 401);
}

// ---------- frontmatter 解析/序列化（仅覆盖本站扁平 schema） ----------

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((x) => stripQuotes(x.trim())).filter(Boolean);
  }
  return stripQuotes(s);
}

function stripQuotes(s) {
  if (
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2) ||
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2)
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function quoteYaml(s) {
  return "'" + String(s).replaceAll("'", "''") + "'";
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1]] = parseScalar(kv[2]);
  }
  return { meta, body: m[2].replace(/^\r?\n/, '') };
}

function serializeFrontmatter(meta, body) {
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const lines = [
    '---',
    `title: ${quoteYaml(meta.title || '未命名')}`,
    `description: ${quoteYaml(meta.description || '')}`,
    `pubDate: ${meta.pubDate || new Date().toISOString()}`,
    `tags: [${tags.map((t) => quoteYaml(t)).join(', ')}]`,
    `accent: ${meta.accent || 'pink'}`,
    `draft: ${meta.draft === true ? 'true' : 'false'}`,
    '---',
    '',
    body || '',
  ];
  return lines.join('\n');
}

const ACCENTS = ['pink', 'purple', 'wild', 'cyan', 'gold', 'blue', 'green'];

function normalizeMeta(raw) {
  return {
    title: String(raw.title || '').slice(0, 120),
    description: String(raw.description || '').slice(0, 300),
    pubDate: raw.pubDate || new Date().toISOString(),
    tags: (Array.isArray(raw.tags) ? raw.tags : [])
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, 8),
    accent: ACCENTS.includes(raw.accent) ? raw.accent : 'pink',
    draft: raw.draft === true,
  };
}

// ---------- 文章接口 ----------

const LIST_POSTS_QUERY = `query($owner:String!,$name:String!,$expr:String!){
  repository(owner:$owner,name:$name){
    object(expression:$expr){
      ... on Tree { entries { name object { ... on Blob { oid text } } } }
    }
  }
}`;

function postFromText(name, sha, text) {
  const { meta, body } = parseFrontmatter(text || '');
  return { slug: name.replace(/\.md$/, ''), sha, ...normalizeMeta(meta), body };
}

async function handleListPosts() {
  let posts = null;
  try {
    const [owner, name] = String(CFG.repo()).split('/');
    const data = await ghGraphQL(LIST_POSTS_QUERY, {
      owner,
      name,
      expr: `${CFG.branch()}:${POSTS_DIR}`,
    });
    const entries = (data.repository.object && data.repository.object.entries) || [];
    posts = entries
      .filter((e) => e.object && e.name.endsWith('.md'))
      .map((e) => postFromText(e.name, e.object.oid, e.object.text));
  } catch {
    // 回退：REST 目录 + 逐篇 GET（GraphQL 不可用时后台照常工作）
    const files = await ghFetch(repoSegments('contents', POSTS_DIR));
    const mdFiles = files.filter((f) => f.type === 'file' && f.name.endsWith('.md'));
    posts = await Promise.all(
      mdFiles.map(async (f) => {
        const item = await ghFetch(repoSegments('contents', f.path));
        return postFromText(f.name, item.sha, dec.decode(b64ToBytes(item.content || '')));
      })
    );
  }
  posts.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));
  return json({ posts });
}

async function handlePostItem(method, slug, request) {
  if (!SLUG_RE.test(slug)) return fail('文件名只能包含字母、数字、点、下划线和短横线');
  const filePath = `${POSTS_DIR}/${slug}.md`;

  if (method === 'GET') {
    const item = await ghFetch(repoSegments('contents', filePath)).catch((e) => {
      if (e.status === 404) {
        e.message = '文章不存在';
      }
      throw e;
    });
    const text = dec.decode(b64ToBytes(item.content || ''));
    const { meta, body } = parseFrontmatter(text);
    return json({ slug, sha: item.sha, ...normalizeMeta(meta), body });
  }

  if (method === 'PUT') {
    const input = await request.json();
    const meta = normalizeMeta(input.post || input);
    const body = String(input.body || '');
    const content = bytesToB64(enc.encode(serializeFrontmatter(meta, body)));

    // 已存在则取 sha（更新），不存在则新建
    const existing = await ghFetch(repoSegments('contents', filePath)).catch((e) => {
      if (e.status === 404) return null;
      throw e;
    });
    const isNew = !existing;
    await ghFetch(repoSegments('contents', filePath), {
      method: 'PUT',
      body: {
        message: `CMS: ${isNew ? '新增' : '更新'}《${meta.title}》${meta.draft ? '（草稿）' : ''}`,
        content,
        branch: CFG.branch(),
        ...(existing ? { sha: existing.sha } : {}),
      },
    });

    // slug 变更时删除旧文件
    const oldSlug = String(input.oldSlug || '');
    if (oldSlug && oldSlug !== slug && SLUG_RE.test(oldSlug)) {
      const oldPath = `${POSTS_DIR}/${oldSlug}.md`;
      const old = await ghFetch(repoSegments('contents', oldPath)).catch(() => null);
      if (old) {
        await ghFetch(repoSegments('contents', oldPath), {
          method: 'DELETE',
          body: {
            message: `CMS: 《${meta.title}》改名为 ${slug}`,
            sha: old.sha,
            branch: CFG.branch(),
          },
        });
      }
    }
    return json({ ok: true, slug, created: isNew });
  }

  if (method === 'DELETE') {
    const item = await ghFetch(repoSegments('contents', filePath)).catch((e) => {
      if (e.status === 404) {
        e.message = '文章不存在';
      }
      throw e;
    });
    const { meta } = parseFrontmatter(dec.decode(b64ToBytes(item.content || '')));
    await ghFetch(repoSegments('contents', filePath), {
      method: 'DELETE',
      body: {
        message: `CMS: 删除《${meta.title || slug}》`,
        sha: item.sha,
        branch: CFG.branch(),
      },
    });
    return json({ ok: true });
  }

  return fail('不支持的请求方法', 405);
}

// ---------- 媒体接口 ----------

const IMG_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.(png|jpe?g|webp|gif|avif)$/i;

async function handleListMedia() {
  const files = await ghFetch(repoSegments('contents', MEDIA_DIR)).catch((e) => {
    if (e.status === 404) return []; // 目录还没创建过 = 空库
    throw e;
  });
  const images = files
    .filter((f) => f.type === 'file' && IMG_NAME_RE.test(f.name))
    .map((f) => ({
      name: f.name,
      sha: f.sha,
      size: f.size,
      url: `/assets/uploads/${f.name}`,
    }));
  return json({ images });
}

async function handleUploadMedia(request) {
  const input = await request.json();
  const name = String(input.name || '');
  if (!IMG_NAME_RE.test(name)) return fail('文件名不合法（仅支持 png/jpg/webp/gif/avif）');
  const data = String(input.data || '');
  if (!data) return fail('缺少图片数据');
  const filePath = `${MEDIA_DIR}/${name}`;
  const existing = await ghFetch(repoSegments('contents', filePath)).catch((e) => {
    if (e.status === 404) return null;
    throw e;
  });
  await ghFetch(repoSegments('contents', filePath), {
    method: 'PUT',
    body: {
      message: `CMS: 上传图片 ${name}${existing ? '（覆盖）' : ''}`,
      content: data,
      branch: CFG.branch(),
      ...(existing ? { sha: existing.sha } : {}),
    },
  });
  return json({ ok: true, name, url: `/assets/uploads/${name}`, overwritten: !!existing });
}

async function handleDeleteMedia(url) {
  const name = url.searchParams.get('name') || '';
  if (!IMG_NAME_RE.test(name)) return fail('文件名不合法');
  const filePath = `${MEDIA_DIR}/${name}`;
  const item = await ghFetch(repoSegments('contents', filePath)).catch((e) => {
    if (e.status === 404) {
      e.message = '图片不存在';
    }
    throw e;
  });
  await ghFetch(repoSegments('contents', filePath), {
    method: 'DELETE',
    body: { message: `CMS: 删除图片 ${name}`, sha: item.sha, branch: CFG.branch() },
  });
  return json({ ok: true });
}
