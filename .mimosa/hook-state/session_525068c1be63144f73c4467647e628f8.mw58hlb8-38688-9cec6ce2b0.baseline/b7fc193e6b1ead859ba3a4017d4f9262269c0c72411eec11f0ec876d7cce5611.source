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
/** 会话时效：默认 12 小时，可用环境变量 CMS_TTL_HOURS 覆盖（>0 才生效） */
function tokenTtlMs() {
  const h = Number(envGetter('CMS_TTL_HOURS'));
  return (h > 0 ? h : 12) * 60 * 60 * 1000;
}
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
  if (Date.now() >= loginFails.until) loginFails.count = 0;
  loginFails.count += 1;
  loginFails.until = Date.now() + 15 * 60 * 1000;
}

function clearFails() {
  loginFails.count = 0;
  loginFails.until = 0;
}

// ---------- 会话 token ----------

async function issueToken(user) {
  const payload = b64uEncode(enc.encode(JSON.stringify({ u: user, e: Date.now() + tokenTtlMs() })));
  const sig = b64uEncode(await hmacSign(payload));
  return payload + '.' + sig;
}

async function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null; // 严格两段：尾随垃圾不放过
  const [payload, sig] = parts;
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
      // 滑续期：活跃用户的令牌剩不到一半时效时换发新令牌，避免写作到一半被踢下线
      const ttl = tokenTtlMs();
      const remaining = auth.e - Date.now();
      if (remaining < ttl / 2) {
        return json({
          user: auth.u,
          expiresAt: Date.now() + ttl,
          token: await issueToken(auth.u),
          renewed: true,
          kv: !!kvStore(),
        });
      }
      return json({ user: auth.u, expiresAt: auth.e, kv: !!kvStore() });
    }
    if (path === '/api/posts' && method === 'GET') return await handleListPosts();
    if (path === '/api/posts-flush' && method === 'POST') return await handlePostsFlush();
    if (path.startsWith('/api/posts/')) {
      return await handlePostItem(method, path.slice('/api/posts/'.length), request);
    }
    if (path.startsWith('/api/history/') && method === 'GET') {
      return await handleHistory(path.slice('/api/history/'.length));
    }
    if (path.startsWith('/api/version/') && method === 'GET') {
      return await handleVersionGet(path.slice('/api/version/'.length), url);
    }
    if (path.startsWith('/api/version/') && method === 'PUT') {
      return await handleVersionRestore(path.slice('/api/version/'.length), request);
    }
    if (path === '/api/activity' && method === 'GET') {
      return await handleActivity();
    }
    if (path === '/api/media' && method === 'GET') return await handleListMedia();
    if (path === '/api/media' && method === 'POST') return await handleUploadMedia(request);
    if (path === '/api/media' && method === 'DELETE') return await handleDeleteMedia(url);
    if (path === '/api/media' && method === 'PATCH') return await handleRenameMedia(request, url);
    return fail('接口不存在', 404);
  } catch (err) {
    // 上游 404 原样透传（各 handler 已改写为中文文案）；其余上游错误按网关错误处理。
    // 401/403 特意不透传——那是 GitHub 令牌问题，不是访客登录态问题，透传会误触发前端登出
    const status = !err || !err.status ? 500 : err.status === 404 ? 404 : 502;
    const msg = (err && err.message) || String(err);
    return fail(status === 404 ? msg : '服务器开小差了：' + msg, status);
  }
}

function envConfigured() {
  return CFG.user() && CFG.pass() && CFG.secret() && CFG.token();
}

/** 锁定提示带剩余分钟数（向上取整），小白不用掐表 */
function lockedMessage() {
  const mins = Math.max(1, Math.ceil((loginFails.until - Date.now()) / 60000));
  return `失败次数太多，请约 ${mins} 分钟后再试`;
}

async function handleLogin(request) {
  if (tooManyFails()) return fail(lockedMessage(), 429);
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
    return json({ token: await issueToken(String(username)), expiresAt: Date.now() + tokenTtlMs(), kv: !!kvStore() });
  }
  recordFail();
  // 第 5 次失败即触发锁定窗口，直接告知锁定；其余次数预告剩余额度
  if (tooManyFails()) return fail(lockedMessage(), 429);
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
  // YAML 单引号转义：'' 代表一个 '（quoteYaml 写入的口径）——解析时必须还原，
  // 否则标题带 ' 的文章每经一次保存引号就翻倍
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replaceAll("''", "'");
  }
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
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

/** 日期防线：非法日期一律落回当前时间——坏字符串进了 frontmatter 会让 Astro(zod) 构建全站失败 */
function normalizeDate(v) {
  const d = v ? new Date(v) : new Date();
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function normalizeMeta(raw) {
  // 换行防线：字符串字段里混入 \r\n 会让 serializeFrontmatter 的单引号 YAML 断成多行，
  // 行首 --- 会被解析器当文档分隔符，Astro 构建全站失败——一律压成空格
  const clean = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
  return {
    title: clean(raw.title).slice(0, 120),
    description: clean(raw.description).slice(0, 300),
    pubDate: normalizeDate(raw.pubDate),
    tags: (Array.isArray(raw.tags) ? raw.tags : [])
      .map((t) => clean(t))
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

/** 拉全部文章（含正文，含草稿）——列表接口与媒体引用扫描共用 */
async function fetchAllPosts() {
  try {
    const [owner, name] = String(CFG.repo()).split('/');
    const data = await ghGraphQL(LIST_POSTS_QUERY, {
      owner,
      name,
      expr: `${CFG.branch()}:${POSTS_DIR}`,
    });
    // object 为 null = 分支或目录不存在（不是空目录）——直接说清楚，别伪装成"池塘还空着"
    if (!data.repository || !data.repository.object) {
      const err = new Error('CMS_BRANCH 指向的分支不存在');
      err.status = 502;
      throw err;
    }
    const entries = data.repository.object.entries || [];
    return entries
      .filter((e) => e.object && e.name.endsWith('.md'))
      .map((e) => postFromText(e.name, e.object.oid, e.object.text));
  } catch (e) {
    // GraphQL 不可用时回退 REST 目录 + 逐篇 GET；分支不存在等非 404 错误继续抛
    if (e && e.status === 502) throw e;
    const files = await ghFetch(repoSegments('contents', POSTS_DIR));
    const mdFiles = files.filter((f) => f.type === 'file' && f.name.endsWith('.md'));
    return Promise.all(
      mdFiles.map(async (f) => {
        const item = await ghFetch(repoSegments('contents', f.path));
        return postFromText(f.name, item.sha, dec.decode(b64ToBytes(item.content || '')));
      })
    );
  }
}

// ---------- 文章 KV 攒批层：保存即时可见，满 N 篇打包成 1 个 commit ----------
// 模式由前端保存请求带 saveMode：batch=修改/草稿进 KV 攒批（新文章仍即时入库）、
// all=新文章也攒批、immediate=与历史版本逐字一致（每保存一次构建一次）。
// KV 里存渲染快照 {slug,meta,body,html,at}；待入库索引 pend={slug: at(ms)}。

const KV_PEND_KEY = 'pend';

function kvPostKey(slug) {
  const bytes = enc.encode(slug);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return 'p_' + hex;
}

/** 读待入库索引 {slug: at(ms)}；缺失/损坏 → 空对象（不挡路） */
async function kvReadPend(kv) {
  try {
    const raw = await kv.get(KV_PEND_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // 索引坏了按空处理，下次写入重建
  }
  return {};
}

async function kvWritePend(kv, pend) {
  await kv.put(KV_PEND_KEY, JSON.stringify(pend));
}

/** 写单篇 KV 快照并登记待入库；返回攒批计数 */
async function kvSavePost(kv, slug, meta, body, html) {
  await kv.put(kvPostKey(slug), JSON.stringify({ slug, meta, body, html: String(html || ''), at: Date.now() }));
  const pend = await kvReadPend(kv);
  pend[slug] = Date.now();
  await kvWritePend(kv, pend);
  return Object.keys(pend).length;
}

/** 忘掉一篇的未入库快照（删除/已入库清理用），不存在也不报错 */
async function kvForgetPost(kv, slug) {
  try {
    await kv.delete(kvPostKey(slug));
  } catch {
    // 删除失败不挡主流程
  }
  const pend = await kvReadPend(kv);
  if (pend[slug] !== undefined) {
    delete pend[slug];
    await kvWritePend(kv, pend);
  }
}

const KV_RENAMES_KEY = 'renames';

/** 改名账本 {新slug: 旧slug}：攒批改名时仓库旧文件还在，flush 入库时必须在同一个 commit 里删掉它，否则双份文章 */
async function kvReadRenames(kv) {
  try {
    const raw = await kv.get(KV_RENAMES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // 账本坏了按空处理（最多退化为"改名列表里双份"，不挡保存）
  }
  return {};
}

async function kvWriteRenames(kv, renames) {
  await kv.put(KV_RENAMES_KEY, JSON.stringify(renames));
}

/** 纯函数（selftest 覆盖）：仓库列表与未入库条目合并——pending 覆盖同 slug、新篇追加并标 pending */
function mergePostsWithPending(repoPosts, pendingItems) {
  const bySlug = {};
  const out = [];
  (repoPosts || []).forEach((p) => {
    bySlug[p.slug] = Object.assign({}, p);
    out.push(bySlug[p.slug]);
  });
  (pendingItems || []).forEach((p) => {
    if (bySlug[p.slug]) {
      Object.assign(bySlug[p.slug], p, { pending: true, sha: '' });
    } else {
      const fresh = Object.assign({}, p, { pending: true, sha: '' });
      bySlug[p.slug] = fresh;
      out.push(fresh);
    }
  });
  return out;
}

async function handleListPosts() {
  const kv = kvStore();
  const pend = kv ? await kvReadPend(kv).catch(() => ({})) : {};
  const pendingSlugs = Object.keys(pend).filter((s) => SLUG_RE.test(s));
  const pendingItems = (
    await Promise.all(
      pendingSlugs.map(async (s) => {
        try {
          const raw = await kv.get(kvPostKey(s));
          if (!raw) return null;
          const v = JSON.parse(raw);
          return Object.assign({ slug: s }, normalizeMeta(v.meta), { body: String(v.body || '') });
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean);
  const oldestAt = pendingSlugs.length ? Math.min(...pendingSlugs.map((s) => pend[s] || 0)) : 0;

  let posts;
  let repoError = false;
  try {
    posts = await fetchAllPosts();
  } catch (e) {
    // GitHub 半边挂了：只要还有未入库改动就不让列表 500（前端提示仓库暂读不到）
    if (!pendingItems.length) throw e;
    posts = [];
    repoError = true;
  }
  const merged = mergePostsWithPending(posts, pendingItems);
  merged.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));
  return json({
    posts: merged,
    pending: pendingItems.length,
    pendingOldest: oldestAt,
    ...(repoError ? { repoError: true } : {}),
  });
}

/** 仓库落盘一篇（新建/更新/改名共用）：PUT 文件 + 改名删旧；返回 warn 文案或空串 */
async function commitPostToRepo(slug, content, meta, existing, oldSlug) {
  await ghFetch(repoSegments('contents', `${POSTS_DIR}/${slug}.md`), {
    method: 'PUT',
    body: {
      message: `CMS: ${existing ? '更新' : '新增'}《${meta.title}》${meta.draft ? '（草稿）' : ''}`,
      content,
      branch: CFG.branch(),
      ...(existing ? { sha: existing.sha } : {}),
    },
  });
  // slug 变更时删除旧文件。删除失败不能让整个保存失败（新文件已落库）：
  // 否则用户重试会撞上自己刚建的新文件被 409 拒——把警告带回前端才是活路
  let warn = '';
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
      }).catch((e) => {
        warn = `新文章已保存，但旧文件 ${oldSlug}.md 删除失败：${(e && e.message) || '未知错误'}。请稍后到文章列表手动删除旧篇，否则会出现重名文章。`;
      });
    }
  }
  return warn;
}

async function handlePostItem(method, slug, request) {
  if (!SLUG_RE.test(slug)) return fail('文件名只能包含字母、数字、点、下划线和短横线');
  const filePath = `${POSTS_DIR}/${slug}.md`;

  if (method === 'GET') {
    const kv = kvStore();
    const item = await ghFetch(repoSegments('contents', filePath)).catch(async (e) => {
      if (e.status === 404 && kv) {
        // 攒批中的新文章仓库里还没有：回退 KV 快照，编辑器照常打开
        const raw = await kv.get(kvPostKey(slug)).catch(() => null);
        if (raw) return null;
        e.message = '文章不存在';
      }
      throw e;
    });
    if (!item) {
      const raw = await kv.get(kvPostKey(slug)).catch(() => null);
      let v = null;
      try {
        v = raw ? JSON.parse(raw) : null;
      } catch {
        v = null; // 快照损坏按不存在处理，不让 500 挡住整个编辑器
      }
      if (!v) {
        const err = new Error('文章不存在');
        err.status = 404;
        throw err;
      }
      return json({ slug, sha: '', pending: true, ...normalizeMeta(v.meta), body: String(v.body || '') });
    }
    const text = dec.decode(b64ToBytes(item.content || ''));
    const { meta, body } = parseFrontmatter(text);
    const pend = kv ? await kvReadPend(kv).catch(() => ({})) : {};
    // 攒批中的文章优先回 KV 快照：编辑器必须显示用户最新保存的版本，而不是仓库里的上一版
    if (pend[slug]) {
      const raw = await kv.get(kvPostKey(slug)).catch(() => null);
      let v = null;
      try {
        v = raw ? JSON.parse(raw) : null;
      } catch {
        v = null;
      }
      if (v) {
        return json({ slug, sha: item.sha, pending: true, ...normalizeMeta(v.meta), body: String(v.body || '') });
      }
    }
    return json({ slug, sha: item.sha, pending: !!pend[slug], ...normalizeMeta(meta), body });
  }

  if (method === 'PUT') {
    let input;
    try {
      input = await request.json();
    } catch {
      return fail('请求格式错误', 400);
    }
    const meta = normalizeMeta((input && input.post) || input || {});
    const body = String((input && input.body) || '');
    const html = String((input && input.html) || '');
    const saveMode = String((input && input.saveMode) || '');
    const content = bytesToB64(enc.encode(serializeFrontmatter(meta, body)));
    const oldSlug = String((input && input.oldSlug) || '');

    // 已存在则取 sha（更新），不存在则新建
    const existing = await ghFetch(repoSegments('contents', filePath)).catch((e) => {
      if (e.status === 404) return null;
      throw e;
    });
    const isNew = !existing;
    // 撞名保护：目标已存在且不是同一篇（改名撞别人 / 新建撞旧文）→ 拒绝，绝不静默覆盖。
    // 例外：攒批里刚把 slug 改成了 oldSlug（改名账本可查），现在改回原名是合法的
    const kv = kvStore();
    if (existing && oldSlug !== slug) {
      const renames = kv ? await kvReadRenames(kv).catch(() => ({})) : {};
      if (renames[slug] !== oldSlug) {
        return fail('该文件名已被占用，请换一个再保存', 409);
      }
      // 合法改回原名：旧名快照与账本一并清掉，后面按"更新 existing"走
      await kvForgetPost(kv, oldSlug);
      delete renames[slug];
      await kvWriteRenames(kv, renames);
    }

    if (kv && (saveMode === 'batch' || saveMode === 'all')) {
      // 改名且旧篇尚未入库（纯 KV 态）→ 只搬 KV，不碰 git、不触发构建
      if (oldSlug && oldSlug !== slug && SLUG_RE.test(oldSlug) && isNew) {
        const oldInRepo = await ghFetch(repoSegments('contents', `${POSTS_DIR}/${oldSlug}.md`)).catch(() => null);
        if (!oldInRepo) {
          const pending = await kvSavePost(kv, slug, meta, body, html);
          await kvForgetPost(kv, oldSlug);
          // 链式改名（X→Y→Z）：把账本里挂在 Y 名下的旧名 X 转记到 Z，flush 才能删对文件
          const renames = await kvReadRenames(kv);
          const chainOld = renames[oldSlug];
          if (chainOld && chainOld !== slug) {
            delete renames[oldSlug];
            renames[slug] = chainOld;
            await kvWriteRenames(kv, renames);
          }
          return json({ ok: true, slug, created: true, kv: true, pending });
        }
        // 旧篇已在仓库：记入改名账本，flush 入库时在同一个 commit 里删旧文件（否则双份文章）
        const renames = await kvReadRenames(kv);
        renames[slug] = oldSlug;
        await kvWriteRenames(kv, renames);
      }
      if (isNew && saveMode !== 'all') {
        // 新文章：没有静态页就无法热替换，攒批只会让它迟迟不可见 → 立即入库（1 次构建）
        const warn = await commitPostToRepo(slug, content, meta, existing, oldSlug);
        return json({ ok: true, slug, created: true, ...(warn ? { warn } : {}) });
      }
      // 已发布文章的修改 / 「全攒」模式的新文章：写 KV 即时可见 + 记攒批，git 等打包
      const pending = await kvSavePost(kv, slug, meta, body, html);
      return json({ ok: true, slug, created: isNew, kv: true, pending });
    }

    // 现状路径（未绑 KV 或「即时」模式）：行为与历史版本逐字一致
    const warn = await commitPostToRepo(slug, content, meta, existing, oldSlug);
    if (kv) {
      // 已入库的内容必须清掉残留攒批快照：否则下次 flush 会拿旧快照把刚提交的内容回滚回去
      await kvForgetPost(kv, slug);
      if (oldSlug && oldSlug !== slug && SLUG_RE.test(oldSlug)) await kvForgetPost(kv, oldSlug);
      // 攒批时改过名、现在用即时模式保存：账本里挂着的仓库旧文件随保存一并清掉
      const renames = await kvReadRenames(kv);
      const ledgerOld = renames[slug];
      if (ledgerOld && SLUG_RE.test(ledgerOld)) {
        const ledgerPath = `${POSTS_DIR}/${ledgerOld}.md`;
        const ledgerFile = await ghFetch(repoSegments('contents', ledgerPath)).catch(() => null);
        if (ledgerFile) {
          await ghFetch(repoSegments('contents', ledgerPath), {
            method: 'DELETE',
            body: { message: `CMS: 清理改名旧文件 ${ledgerOld}`, sha: ledgerFile.sha, branch: CFG.branch() },
          }).catch(() => {});
        }
        delete renames[slug];
        await kvWriteRenames(kv, renames);
      }
    }
    return json({ ok: true, slug, created: isNew, ...(warn ? { warn } : {}) });
  }

  if (method === 'DELETE') {
    const kv = kvStore();
    // 攒批里刚改过名的：旧文件还躺在仓库，删新名时必须把旧名一并删掉，否则旧文复活
    const renames = kv ? await kvReadRenames(kv).catch(() => ({})) : {};
    const repoOld = renames[slug] && SLUG_RE.test(renames[slug]) ? renames[slug] : '';
    const item = await ghFetch(repoSegments('contents', filePath)).catch((e) => {
      if (e.status === 404) {
        // 仓库里本来就没有（攒批中的新文章）：纯 KV 删除，零构建
        if (kv) return null;
        e.message = '文章不存在';
      }
      throw e;
    });
    if (!item && !repoOld) {
      await (kv ? kvForgetPost(kv, slug) : Promise.resolve());
      return json({ ok: true, kvOnly: true });
    }
    // 先删 git 再清 KV：git 删除失败时攒批快照还在，重试不丢未入库的编辑
    const targets = [];
    if (item) {
      const { meta } = parseFrontmatter(dec.decode(b64ToBytes(item.content || '')));
      targets.push({ path: filePath, sha: item.sha, title: meta.title || slug });
    }
    if (repoOld) {
      const oldFile = await ghFetch(repoSegments('contents', `${POSTS_DIR}/${repoOld}.md`)).catch(() => null);
      if (oldFile) targets.push({ path: `${POSTS_DIR}/${repoOld}.md`, sha: oldFile.sha, title: repoOld });
    }
    for (const t of targets) {
      await ghFetch(repoSegments('contents', t.path), {
        method: 'DELETE',
        body: { message: `CMS: 删除《${t.title}》`, sha: t.sha, branch: CFG.branch() },
      });
    }
    if (kv) {
      await kvForgetPost(kv, slug);
      if (repoOld) {
        const latestRenames = await kvReadRenames(kv);
        delete latestRenames[slug];
        await kvWriteRenames(kv, latestRenames);
      }
    }
    return json({ ok: true });
  }

  return fail('不支持的请求方法', 405);
}

// ---------- 版本历史接口（贴 GitHub commits API，全程只读 + 回滚复用 contents PUT） ----------

/**
 * POST /api/posts-flush：把攒批中的所有文章改动打包成 1 个 commit（N 篇 = 1 次构建）。
 * Git Data API 四步：读 ref → 建 blob → 合树 → 提交 + 快进 ref；
 * 全部仍走 api.github.com（白名单不变），ref 默认校验快进，不会覆盖别人的提交。
 */
async function handlePostsFlush() {
  const kv = kvStore();
  if (!kv) return fail('KV 未绑定，攒批功能不可用');
  const pend = await kvReadPend(kv);
  const slugs = Object.keys(pend).filter((s) => SLUG_RE.test(s));
  if (!slugs.length) return json({ ok: true, committed: 0 });
  // 单个 commit 最多带 50 个文件改动；超出部分留在 pend 下次入库，不会永久卡死
  const batch = slugs.slice(0, 50);
  // 记下入库开始时每篇的 pend 时间戳：flush 期间又被保存过的，收尾时不能删它的快照
  const atFlush = {};
  for (const s of batch) atFlush[s] = pend[s];

  const items = [];
  for (const s of batch) {
    const raw = await kv.get(kvPostKey(s)).catch(() => null);
    if (!raw) continue;
    try {
      const v = JSON.parse(raw);
      items.push({
        slug: s,
        content: bytesToB64(enc.encode(serializeFrontmatter(normalizeMeta(v.meta), String(v.body || '')))),
      });
    } catch {
      // 快照损坏的单篇跳过，不让整批失败
    }
  }
  if (!items.length) {
    const latestPend = await kvReadPend(kv);
    for (const s of batch) delete latestPend[s];
    await kvWritePend(kv, latestPend);
    return json({ ok: true, committed: 0 });
  }

  // 攒批改名账本：入库的同一个 commit 里删掉仓库旧文件（tree 里 sha=null 即删除）
  const renames = await kvReadRenames(kv);
  for (const it of items) {
    const ledgerOld = renames[it.slug];
    if (ledgerOld && SLUG_RE.test(ledgerOld) && ledgerOld !== it.slug) {
      const oldPath = `${POSTS_DIR}/${ledgerOld}.md`;
      const oldFile = await ghFetch(repoSegments('contents', oldPath)).catch(() => null);
      if (oldFile) it.deletePath = oldPath;
    }
  }

  const ref = await ghFetch(repoSegments('git', 'ref', 'heads', CFG.branch()));
  const baseSha = ref && ref.object && ref.object.sha;
  if (!baseSha) return fail('读不到分支状态，请稍后重试');
  const baseCommit = await ghFetch(repoSegments('git', 'commits', baseSha));
  const entries = [];
  for (const it of items) {
    const blob = await ghFetch(repoSegments('git', 'blobs'), {
      method: 'POST',
      body: { content: it.content, encoding: 'base64' },
    });
    entries.push({ path: `${POSTS_DIR}/${it.slug}.md`, mode: '100644', type: 'blob', sha: blob.sha });
    if (it.deletePath) entries.push({ path: it.deletePath, mode: '100644', type: 'blob', sha: null });
  }
  const tree = await ghFetch(repoSegments('git', 'trees'), {
    method: 'POST',
    body: { base_tree: baseCommit.tree.sha, tree: entries },
  });
  const commit = await ghFetch(repoSegments('git', 'commits'), {
    method: 'POST',
    body: { message: `CMS: 入库 ${items.length} 篇改动（攒批自动）`, tree: tree.sha, parents: [baseSha] },
  });
  try {
    await ghFetch(repoSegments('git', 'refs', 'heads', CFG.branch()), {
      method: 'PATCH',
      body: { sha: commit.sha, force: false },
    });
  } catch (e) {
    if (e.status === 422) return fail('刚才有其他改动先入库了，请重试一次入库', 409);
    throw e;
  }
  // 收尾只清"入库期间没再被保存过"的快照：时间戳变了说明 KV 里有更新版本，留给下次入库
  const latestPend = await kvReadPend(kv);
  for (const it of items) {
    if (latestPend[it.slug] !== undefined && latestPend[it.slug] !== atFlush[it.slug]) continue;
    await kv.delete(kvPostKey(it.slug)).catch(() => {});
    delete latestPend[it.slug];
  }
  await kvWritePend(kv, latestPend);
  const latestRenames = await kvReadRenames(kv);
  for (const it of items) delete latestRenames[it.slug];
  await kvWriteRenames(kv, latestRenames);
  return json({
    ok: true,
    committed: items.length,
    slugs: items.map((i) => i.slug),
    ...(slugs.length > items.length ? { remaining: slugs.length - items.length } : {}),
  });
}

/** git ref 白名单：仅接受 commit sha（7-40 位十六进制），防任意 ref/分支注入 */
const SHA_RE = /^[0-9a-f]{7,40}$/i;

/** 裁剪 GitHub commit 对象：只留展示所需字段，不透传原始结构 */
function trimCommit(c) {
  return {
    sha: c.sha,
    short: String(c.sha || '').slice(0, 7),
    date: (c.commit && c.commit.author && c.commit.author.date) || '',
    message: String((c.commit && c.commit.message) || '')
      .split('\n')[0]
      .slice(0, 80),
    author: (c.commit && c.commit.author && c.commit.author.name) || '',
  };
}

/** GET /api/activity：整仓最近 5 次提交（仪表盘「最近活动」卡片，保存落库可见） */
async function handleActivity() {
  const commits = await ghFetch(repoSegments('commits'), {
    query: { per_page: '5', sha: CFG.branch() },
  });
  // repoUrl 供前端给「在 GitHub 看全部」外链：仓库配置只从服务端出，前端不硬编码
  const repoUrl = 'https://github.com/' + CFG.repo() + '/commits/' + encodeURIComponent(CFG.branch());
  return json({ commits: (Array.isArray(commits) ? commits : []).map(trimCommit), repoUrl });
}

/** GET /api/history/{slug}：这篇文章最近 15 次提交（裁剪字段，不透传 GitHub 原始对象） */
async function handleHistory(slug) {
  if (!SLUG_RE.test(slug)) return fail('文件名只能包含字母、数字、点、下划线和短横线');
  const filePath = `${POSTS_DIR}/${slug}.md`;
  const commits = await ghFetch(repoSegments('commits'), {
    // commits API 选分支的参数是 sha（不是 contents 用的 ref），必须显式传，否则落在默认分支上查不到
    query: { path: filePath, per_page: '15', sha: CFG.branch() },
  });
  const versions = (Array.isArray(commits) ? commits : []).map(trimCommit);
  return json({ versions });
}

/** GET /api/version/{slug}?ref=<sha>：取某一版的完整文章（解析 frontmatter，同单篇 GET 口径） */
async function handleVersionGet(slug, url) {
  if (!SLUG_RE.test(slug)) return fail('文件名只能包含字母、数字、点、下划线和短横线');
  const ref = String(url.searchParams.get('ref') || '');
  if (!SHA_RE.test(ref)) return fail('版本号不合法');
  const filePath = `${POSTS_DIR}/${slug}.md`;
  const item = await ghFetch(repoSegments('contents', filePath), { query: { ref } }).catch((e) => {
    if (e.status === 404) e.message = '这一版里还没有这篇文章';
    throw e;
  });
  const text = dec.decode(b64ToBytes(item.content || ''));
  const { meta, body } = parseFrontmatter(text);
  return json({ slug, versionSha: ref, ...normalizeMeta(meta), body });
}

/** PUT /api/version/{slug}（body: {ref}）：把文件按字节原样恢复到某一版，commit 说明自动生成 */
async function handleVersionRestore(slug, request) {
  if (!SLUG_RE.test(slug)) return fail('文件名只能包含字母、数字、点、下划线和短横线');
  let input;
  try {
    input = await request.json();
  } catch {
    return fail('请求格式错误');
  }
  const ref = String((input && input.ref) || '');
  if (!SHA_RE.test(ref)) return fail('版本号不合法');
  const filePath = `${POSTS_DIR}/${slug}.md`;
  const version = await ghFetch(repoSegments('contents', filePath), { query: { ref } }).catch((e) => {
    if (e.status === 404) e.message = '这一版里还没有这篇文章';
    throw e;
  });
  const existing = await ghFetch(repoSegments('contents', filePath)).catch((e) => {
    if (e.status === 404) e.message = '文章不存在';
    throw e;
  });
  const title = parseFrontmatter(dec.decode(b64ToBytes(version.content || ''))).meta.title;
  await ghFetch(repoSegments('contents', filePath), {
    method: 'PUT',
    body: {
      message: `CMS: 回滚《${title || slug}》到 ${ref.slice(0, 7)} 版本`,
      // contents GET 返回的 base64 带换行，PUT 前清掉空白（与 b64ToBytes 同口径）
      content: String(version.content || '').replace(/\s+/g, ''),
      branch: CFG.branch(),
      sha: existing.sha,
    },
  });
  const kv = kvStore();
  if (kv) await kvForgetPost(kv, slug);
  return json({ ok: true, slug });
}

// ---------- 媒体接口 ----------

const IMG_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.(png|jpe?g|webp|gif|avif)$/i;

/**
 * KV 存储接入（零构建上传的核心）：图片字节存 EdgeOne Pages KV 命名空间，不走 git、
 * 不触发站点构建，上传后立刻可以通过 /m/<图片名> 访问。
 * 绑定方式：EdgeOne 控制台 → 项目 → KV 存储 → 绑定命名空间，变量名填 CMS_KV；
 * 绑定以全局变量形式注入运行时（与文档示例的裸变量一致），未绑定时这里是 null，
 * 所有上传/删除/改名自动降级回 GitHub 提交路径——行为与历史版本完全一致。
 */
function kvStore() {
  if (CTX_ENV && CTX_ENV.CMS_KV) return CTX_ENV.CMS_KV;
  if (typeof globalThis.CMS_KV !== 'undefined') return globalThis.CMS_KV;
  return null;
}

/** KV key 只允许字母/数字/下划线（官方文档限制），图片名含 . 和 - → 十六进制编码，可逆 */
function kvImageKey(name) {
  const bytes = enc.encode(name);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return 'u_' + hex;
}

function kvImageName(key) {
  const hex = key.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return dec.decode(bytes);
}

function imgContentType(name) {
  const m = name.match(/\.([a-z0-9]+)$/i);
  const ext = m && m[1] ? m[1].toLowerCase() : '';
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      avif: 'image/avif',
    }[ext] || 'application/octet-stream'
  );
}

const KV_INDEX_KEY = 'idx';

/** 读图片索引（名→{name,size,at}）；索引丢失时从 u_ 前缀 key 重建（size 补 0，下次上传修复） */
async function kvReadIndex(kv) {
  try {
    const raw = await kv.get(KV_INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // 索引坏了不挡路：落空对象后按 key 重建
  }
  const idx = {};
  try {
    let cursor;
    for (;;) {
      const page = await kv.list({ prefix: 'u_', cursor });
      for (const k of page.keys || []) {
        const name = kvImageName(k.name);
        if (IMG_NAME_RE.test(name)) idx[name] = { name, size: 0, at: 0 };
      }
      if (!page.cursor) break;
      cursor = page.cursor;
    }
  } catch {
    // KV 整体不可用时返回空索引，上层照常走仓库路径
  }
  return idx;
}

async function kvWriteIndex(kv, idx) {
  await kv.put(KV_INDEX_KEY, JSON.stringify(idx));
}

/** KV 里的全部图片（列表用）；KV 未绑定/不可用 → 空数组 */
async function kvListImages() {
  const kv = kvStore();
  if (!kv) return [];
  const idx = await kvReadIndex(kv);
  return Object.keys(idx)
    .filter((n) => IMG_NAME_RE.test(n))
    .map((n) => ({ name: n, sha: '', size: idx[n].size || 0, url: `/m/${n}`, src: 'kv' }));
}

/** 文章正文里引用某张图（新旧两种 URL 形态都算） */
function postRefsImage(body, name) {
  const text = String(body || '');
  return text.indexOf('/assets/uploads/' + name) !== -1 || text.indexOf('/m/' + name) !== -1;
}

async function handleListMedia() {
  // KV 图排前面（新上传），同名时 KV 覆盖仓库条目
  const kvImages = await kvListImages().catch(() => []);
  const files = await ghFetch(repoSegments('contents', MEDIA_DIR)).catch((e) => {
    if (e.status === 404) return []; // 目录还没创建过 = 空库
    // GitHub 半边挂了（限流/网络/令牌）：只要还有 KV 图可展示就不让整页 500，前端提示仓库图暂缺
    if (kvStore() && kvImages.length) return null;
    throw e;
  });
  const repoImages = files
    ? files
        .filter((f) => f.type === 'file' && IMG_NAME_RE.test(f.name))
        .map((f) => ({
          name: f.name,
          sha: f.sha,
          size: f.size,
          url: `/assets/uploads/${f.name}`,
          src: 'repo',
        }))
    : [];
  const kvNames = new Set(kvImages.map((i) => i.name));
  const images = [...kvImages, ...repoImages.filter((i) => !kvNames.has(i.name))];
  return json({ images, kv: !!kvStore(), ...(files === null ? { repoError: true } : {}) });
}

async function handleUploadMedia(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return fail('请求格式错误', 400);
  }
  const name = String((input && input.name) || '');
  if (!IMG_NAME_RE.test(name)) return fail('文件名不合法（仅支持 png/jpg/webp/gif/avif）');
  const data = String((input && input.data) || '');
  if (!data) return fail('缺少图片数据');
  // 约 5MB 原始字节（base64 后 ~6.7MB）为上限：挡住异常大包打爆 KV，也拦下随手传原图的失误
  if (data.length > 7 * 1024 * 1024) return fail('图片太大（上限约 5MB），请压缩后再上传', 413);
  const kv = kvStore();
  if (kv) {
    // 零构建路径：字节进 KV，不走 git，站点不用重新构建
    let bytes;
    try {
      bytes = b64ToBytes(data);
    } catch {
      return fail('图片数据不是合法的 base64，请重新选择文件上传', 400);
    }
    const idx = await kvReadIndex(kv);
    const overwritten = !!idx[name];
    await kv.put(kvImageKey(name), bytes);
    idx[name] = { name, size: bytes.byteLength, at: Date.now() };
    await kvWriteIndex(kv, idx);
    return json({ ok: true, name, url: `/m/${name}`, kv: true, overwritten });
  }
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

/**
 * PATCH /api/media?name=旧名（body: {name: 新名}）：重命名图片。
 * 安全范围：被文章引用的图直接拒绝（明确报数量）——自动改写引用涉及逐篇 PUT，风险大于收益；
 * 未被引用的图 = 刚传错名想改的最常见场景。流程 新传→旧删，旧删失败带 warn（与文章改名同口径）。
 */
async function handleRenameMedia(request, url) {
  const from = url.searchParams.get('name') || '';
  if (!IMG_NAME_RE.test(from)) return fail('旧文件名不合法');
  let input;
  try {
    input = await request.json();
  } catch {
    return fail('请求格式错误');
  }
  const to = String((input && input.name) || '');
  if (!IMG_NAME_RE.test(to)) return fail('新文件名不合法（仅 png/jpg/webp/gif/avif）');
  if (from === to) return fail('名字没变');
  const fromPath = `${MEDIA_DIR}/${from}`;
  const toPath = `${MEDIA_DIR}/${to}`;

  const posts = await fetchAllPosts();
  const candidates = posts.map((p) => ({ title: p.title, body: p.body }));
  // 攒批未入库的文章也可能引用图片（/m/ 路径），把 KV 快照正文一并纳入扫描（口径与列表合并视图一致）
  const kv = kvStore();
  if (kv) {
    const pend = await kvReadPend(kv).catch(() => ({}));
    for (const s of Object.keys(pend)) {
      if (!SLUG_RE.test(s)) continue;
      const raw = await kv.get(kvPostKey(s)).catch(() => null);
      if (!raw) continue;
      try {
        const v = JSON.parse(raw);
        candidates.push({ title: (v.meta && v.meta.title) || s, body: String(v.body || '') });
      } catch {
        // 快照损坏跳过
      }
    }
  }
  const refs = candidates.filter((p) => postRefsImage(p.body, from));
  if (refs.length) {
    return fail(
      `有 ${refs.length} 篇文章正在引用它（${refs
        .map((p) => '《' + (p.title || p.slug) + '》')
        .join('、')}），重命名会让它们裂图；请先在文章里换成新图再删除`,
      409
    );
  }

  // KV 分支：图片在 KV 里（零构建上传的）→ 值拷到新 key、删旧 key、改索引，全程不碰 git
  const kvBytes = kv ? await kv.get(kvImageKey(from), { type: 'arrayBuffer' }).catch(() => null) : null;
  if (kv && kvBytes) {
    // 同名冲突按索引判定：上次改名半途失败留下的孤儿字节（有 key 无索引）可以直接覆盖完成，不会 409 卡死
    const idx0 = await kvReadIndex(kv);
    if (idx0[to]) return fail('已有同名图片，请换一个名字', 409);
    await kv.put(kvImageKey(to), kvBytes);
    // 旧 key 删除失败只留孤儿字节，不再让整个改名 500——索引以新名为准
    await kv.delete(kvImageKey(from)).catch(() => {});
    const meta = idx0[from] || {};
    delete idx0[from];
    idx0[to] = { name: to, size: meta.size || 0, at: meta.at || Date.now() };
    await kvWriteIndex(kv, idx0);
    return json({ ok: true, name: to, url: '/m/' + to, kv: true });
  }

  const old = await ghFetch(repoSegments('contents', fromPath)).catch((e) => {
    if (e.status === 404) e.message = '图片不存在';
    throw e;
  });
  const existing = await ghFetch(repoSegments('contents', toPath)).catch((e) => {
    if (e.status === 404) return null;
    throw e;
  });
  if (existing) return fail('已有同名图片，请换一个名字', 409);

  await ghFetch(repoSegments('contents', toPath), {
    method: 'PUT',
    body: {
      message: `CMS: 重命名图片 ${from} → ${to}`,
      // contents GET 的 base64 内嵌换行，PUT 前清掉（与版本回滚同口径）
      content: String(old.content || '').replace(/\s+/g, ''),
      branch: CFG.branch(),
    },
  });
  let warn = '';
  await ghFetch(repoSegments('contents', fromPath), {
    method: 'DELETE',
    body: { message: `CMS: 重命名图片 ${from} → ${to}`, sha: old.sha, branch: CFG.branch() },
  }).catch((e) => {
    warn = `新名字已就绪，但旧文件 ${from} 删除失败：${(e && e.message) || '未知错误'}，请稍后手动删除`;
  });
  return json({ ok: true, name: to, url: '/assets/uploads/' + to, ...(warn ? { warn } : {}) });
}

async function handleDeleteMedia(url) {
  const name = url.searchParams.get('name') || '';
  if (!IMG_NAME_RE.test(name)) return fail('文件名不合法');
  // KV 分支：图片存 KV 的话直接删 KV + 更新索引；不在这里 → 掉到仓库路径删老图
  const kv = kvStore();
  if (kv) {
    const key = kvImageKey(name);
    const exists = await kv.get(key).catch(() => null);
    if (exists !== null) {
      await kv.delete(key);
      const idx = await kvReadIndex(kv);
      delete idx[name];
      await kvWriteIndex(kv, idx);
      return json({ ok: true });
    }
  }
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

// ---------- 仅供测试的纯函数导出（EdgeOne 只认 onRequest，多出的具名导出无副作用） ----------
export {
  parseFrontmatter,
  serializeFrontmatter,
  normalizeMeta,
  normalizeDate,
  parseScalar,
  IMG_NAME_RE,
  kvImageKey,
  kvImageName,
  imgContentType,
  SLUG_RE,
  kvPostKey,
  mergePostsWithPending,
  safeEqual,
  b64ToBytes,
  stripQuotes,
  postRefsImage,
};
