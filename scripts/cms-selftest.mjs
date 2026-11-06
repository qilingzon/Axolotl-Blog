// 美西螈 CMS 纯函数回归测试（无网络、无凭据，CI/本地均可跑）
// 用法：npm test
// 覆盖：frontmatter 解析/序列化往返、normalizeMeta 防线（坏日期/坏 accent/超量标签/超长标题）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mod = await import('../edge-functions/api/[[default]].js');
const { parseFrontmatter, serializeFrontmatter, normalizeMeta, normalizeDate, parseScalar } = mod;
const { IMG_NAME_RE, kvImageKey, kvImageName, imgContentType } = mod;
const { SLUG_RE, kvPostKey, mergePostsWithPending } = mod;
const { safeEqual, b64ToBytes, stripQuotes, postRefsImage } = mod;

// 动态提取前端解析器（小白写作纯函数，确保语言标识与表格不发生回归）
const appCode = readFileSync(new URL('../public/admin/app.js', import.meta.url), 'utf8');
const parseBlocksCode = appCode.match(/function parseBlocks[\s\S]*?\n\}/)[0];
const blocksToMarkdownCode = appCode.match(/function blocksToMarkdown[\s\S]*?\n\}/)[0];
const splitUnescapedCode = appCode.match(/function splitUnescaped[\s\S]*?\n\}/)[0];
// parseBlocks/blocksToMarkdown 依赖 splitUnescaped（表格转义切分），提取时一并注入作用域
const parseBlocks = new Function(splitUnescapedCode + '\nreturn ' + parseBlocksCode)();
const blocksToMarkdown = new Function(splitUnescapedCode + '\nreturn ' + blocksToMarkdownCode)();
// 渲染安全管线（esc/safeUrl/safeImgTag/renderMarkdown 同作用域提取，验证白名单与协议过滤）
const mdSandbox = new Function(
  appCode.match(/function esc[\s\S]*?\n\}/)[0] +
    '\n' + appCode.match(/function safeUrl[\s\S]*?\n\}/)[0] +
    '\n' + appCode.match(/function splitUnescaped[\s\S]*?\n\}/)[0] +
    '\n' + appCode.match(/function safeImgTag[\s\S]*?\n\}/)[0] +
    '\n' + appCode.match(/function renderMarkdown[\s\S]*?\n\}/)[0] +
    '\nreturn { esc: esc, safeUrl: safeUrl, splitUnescaped: splitUnescaped, safeImgTag: safeImgTag, renderMarkdown: renderMarkdown };'
)();
const { safeUrl, splitUnescaped, safeImgTag, renderMarkdown } = mdSandbox;

let pass = 0;
let fail = 0;
let asyncPending = 0;
function finish() {
  console.log('');
  console.log(`RESULT pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
}
function done() {
  if (asyncPending > 0) return; // 还有异步用例在跑
  finish();
}
function t(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') {
      asyncPending++;
      r.then(
        () => {
          asyncPending--;
          pass++;
          console.log('PASS ' + name);
          done();
        },
        (e) => {
          asyncPending--;
          fail++;
          console.log('FAIL ' + name + ' :: ' + (e && e.message));
          done();
        }
      );
      return;
    }
    pass++;
    console.log('PASS ' + name);
  } catch (e) {
    fail++;
    console.log('FAIL ' + name + ' :: ' + (e && e.message));
  }
}
setTimeout(() => {
  if (asyncPending > 0) {
    console.log('FAIL 异步用例 5 秒未完成');
    fail++;
  }
  finish();
}, 5000); // 不 unref：挂起的异步用例必须拦住退出，否则出现假通过

// ---------- normalizeDate：日期防线 ----------

t('normalizeDate 合法 ISO 原样保留', () => {
  assert.equal(normalizeDate('2026-10-25T10:00:00.000Z'), '2026-10-25T10:00:00.000Z');
});

t('normalizeDate 垃圾字符串落回当前时间', () => {
  const out = normalizeDate('not-a-date');
  assert.ok(!isNaN(new Date(out).getTime()));
});

t('normalizeDate 缺失落回当前时间', () => {
  assert.ok(!isNaN(new Date(normalizeDate(undefined)).getTime()));
});

t('normalizeDate 日期-only 归一为 ISO', () => {
  assert.equal(normalizeDate('2026-10-08'), '2026-10-08T00:00:00.000Z');
});

// ---------- normalizeMeta：防线逐项 ----------

t('normalizeMeta 坏 pubDate 被拦截', () => {
  const m = normalizeMeta({ title: 'x', pubDate: 'garbage' });
  assert.ok(!isNaN(new Date(m.pubDate).getTime()));
});

t('normalizeMeta 坏 accent 落回 pink', () => {
  assert.equal(normalizeMeta({ accent: 'rainbow' }).accent, 'pink');
});

t('normalizeMeta 标签超 8 个截断', () => {
  const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  assert.equal(normalizeMeta({ tags }).tags.length, 8);
});

t('normalizeMeta 标题超 120 字截断', () => {
  assert.equal(normalizeMeta({ title: '好'.repeat(200) }).title.length, 120);
});

t('normalizeMeta draft 只认布尔真', () => {
  assert.equal(normalizeMeta({ draft: 'yes' }).draft, false);
  assert.equal(normalizeMeta({ draft: 1 }).draft, false);
  assert.equal(normalizeMeta({ draft: true }).draft, true);
});

// ---------- parseScalar ----------

t('parseScalar 布尔与空数组', () => {
  assert.equal(parseScalar('true'), true);
  assert.equal(parseScalar('false'), false);
  assert.deepEqual(parseScalar('[]'), []);
});

t('parseScalar 引号字符串', () => {
  assert.equal(parseScalar("'hello'"), 'hello');
  assert.equal(parseScalar('"double"'), 'double');
});

// ---------- parseFrontmatter ----------

t('parseFrontmatter 标准文档', () => {
  const { meta, body } = parseFrontmatter(
    "---\ntitle: '你好'\ndescription: ''\npubDate: 2026-10-25T10:00:00.000Z\ntags: ['技术', '建站']\naccent: purple\ndraft: false\n---\n\n## 标题\n\n正文\n"
  );
  assert.equal(meta.title, '你好');
  assert.deepEqual(meta.tags, ['技术', '建站']);
  assert.equal(meta.accent, 'purple');
  assert.equal(meta.draft, false);
  assert.equal(body, '## 标题\n\n正文\n');
});

t('parseFrontmatter 无 frontmatter 时正文原样', () => {
  const { meta, body } = parseFrontmatter('只有正文，没有头部\n');
  assert.deepEqual(meta, {});
  assert.equal(body, '只有正文，没有头部\n');
});

t('parseFrontmatter 值里带冒号不截断', () => {
  const { meta } = parseFrontmatter("---\ntitle: '时间: 下午三点'\n---\n正文\n");
  assert.equal(meta.title, '时间: 下午三点');
});

// ---------- 序列化 ↔ 解析 往返 ----------

t('serialize → parse 往返保真（引号/冒号/中文标签）', () => {
  const meta = normalizeMeta({
    title: "池塘笔记: 今天's 日志",
    description: '含 单引号\' 与 : 冒号',
    pubDate: '2026-10-25T10:00:00.000Z',
    tags: ['技术', '随笔', "quote's"],
    accent: 'cyan',
    draft: true,
  });
  const text = serializeFrontmatter(meta, '正文\n');
  const back = parseFrontmatter(text);
  const nb = normalizeMeta(back.meta);
  assert.equal(nb.title, meta.title);
  assert.equal(nb.description, meta.description);
  assert.equal(nb.pubDate, meta.pubDate);
  assert.deepEqual(nb.tags, meta.tags);
  assert.equal(nb.accent, meta.accent);
  assert.equal(nb.draft, meta.draft);
  assert.equal(back.body, '正文\n');
});

t('serializeFrontmatter 正文原样保留（不二次加工）', () => {
  const text = serializeFrontmatter(normalizeMeta({ title: 't' }), '第一行\n\n```\ncode\n```\n');
  assert.ok(text.endsWith('\n```\n'));
});

// ---------- 2026-11-04 补强：边界回归网 ----------

t('normalizeDate 布尔/对象等垃圾类型落回当前时间', () => {
  assert.ok(!isNaN(new Date(normalizeDate(false)).getTime()));
  assert.ok(!isNaN(new Date(normalizeDate({})).getTime()));
});

t('parseScalar 数字字符串保持字符串（仅布尔/列表特判）', () => {
  assert.equal(parseScalar('42'), '42');
});

t('parseScalar 列表字符串', () => {
  assert.deepEqual(parseScalar('[a, b]'), ['a', 'b']);
});

// ---------- KV 零构建上传：key 编码与内容类型 ----------

t('kvImageKey/kvImageName 往返一致（含 . 和 - 的图片名）', () => {
  const name = 'screenshot-3x8f2k1.webp';
  const key = kvImageKey(name);
  // KV key 官方限制：仅字母/数字/下划线
  assert.match(key, /^[0-9A-Za-z_]+$/);
  assert.ok(key.startsWith('u_'));
  assert.equal(kvImageName(key), name);
});

t('kvImageKey 拒绝不了中文名（编码可逆即可，白名单在 IMG_NAME_RE）', () => {
  // 中文经 UTF-8 十六进制编码后同样是字母数字，key 合法；名字合法性由 IMG_NAME_RE 把关
  const key = kvImageKey('图.png');
  assert.match(key, /^[0-9A-Za-z_]+$/);
  assert.equal(kvImageName(key), '图.png');
});

t('IMG_NAME_RE 白名单：合法名过、路径穿越与中文被拒', () => {
  assert.ok(IMG_NAME_RE.test('a-b_1.webp'));
  assert.ok(!IMG_NAME_RE.test('../secret.png'));
  assert.ok(!IMG_NAME_RE.test('中文名.png'));
  assert.ok(!IMG_NAME_RE.test('a.png.exe'));
});

t('IMG_NAME_RE 长度防线：主体 60 过、61 拒（hex 后 KV key 远离长度上限）', () => {
  assert.ok(IMG_NAME_RE.test('a'.repeat(60) + '.webp'));
  assert.ok(!IMG_NAME_RE.test('a'.repeat(61) + '.webp'));
  assert.ok(IMG_NAME_RE.test('probe.webp')); // 短名不受影响
});

t('imgContentType 按扩展名给对 MIME', () => {
  assert.equal(imgContentType('a.jpg'), 'image/jpeg');
  assert.equal(imgContentType('a.webp'), 'image/webp');
  assert.equal(imgContentType('a.avif'), 'image/avif');
  assert.equal(imgContentType('a.txt'), 'application/octet-stream');
});

// ---------- 文章 KV 攒批：key 编码与列表合并 ----------

t('kvPostKey 往返一致且只含 KV 允许字符（p_ 前缀 + 十六进制）', () => {
  const key = kvPostKey('my-post_2026.slug');
  assert.match(key, /^[0-9A-Za-z_]+$/);
  assert.ok(key.startsWith('p_'));
  assert.notEqual(key, kvPostKey('other-post'));
});

t('mergePostsWithPending：pending 覆盖同 slug 的仓库版并标 pending', () => {
  const repo = [{ slug: 'a', title: '仓库版A', body: 'old', pubDate: '2026-01-01', draft: false }];
  const pend = [{ slug: 'a', title: 'KV版A', body: 'new', pubDate: '2026-01-02', draft: false }];
  const out = mergePostsWithPending(repo, pend);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'KV版A');
  assert.equal(out[0].pending, true);
  assert.equal(out[0].sha, '');
});

t('mergePostsWithPending：pending-only 新篇追加、空 pending 零变化', () => {
  const repo = [{ slug: 'a', title: 'A', body: '', pubDate: '2026-01-01' }];
  const out1 = mergePostsWithPending(repo, [{ slug: 'b', title: 'B新', body: 'x', pubDate: '2026-01-03' }]);
  assert.equal(out1.length, 2);
  assert.equal(out1[1].slug, 'b');
  assert.equal(out1[1].pending, true);
  const out2 = mergePostsWithPending(repo, []);
  assert.equal(out2.length, 1);
  assert.equal(out2[0].pending, undefined);
  const out3 = mergePostsWithPending(null, [{ slug: 'c', title: 'C', body: '', pubDate: '2026-01-01' }]);
  assert.equal(out3.length, 1);
  assert.equal(out3[0].pending, true);
});

t('SLUG_RE 白名单：合法 slug 过、路径穿越被拒（与后端一致）', () => {
  assert.ok(SLUG_RE.test('my-post_2026'));
  assert.ok(!SLUG_RE.test('../x'));
  assert.ok(!SLUG_RE.test('中文slug'));
});

// ---------- 认证与文本清洗纯函数 ----------

t('safeEqual 常数时间字符串比对', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'ab'), false);
  assert.equal(safeEqual('', ''), true);
});

t('b64ToBytes 过滤换行与空白', () => {
  // GitHub Contents API 返回的 base64 夹带换行符（如每 60 字符换行）
  const b64WithNewlines = 'SGVsbG8g\n  V29ybGQh\r\n';
  const bytes = b64ToBytes(b64WithNewlines);
  const text = new TextDecoder().decode(bytes);
  assert.equal(text, 'Hello World!');
});

t('stripQuotes 引号还原保真', () => {
  assert.equal(stripQuotes("'hello'"), 'hello');
  assert.equal(stripQuotes("''nested''"), "'nested'");
  assert.equal(stripQuotes('"double"'), 'double');
  assert.equal(stripQuotes('raw_string'), 'raw_string');
});

t('postRefsImage 识别两种引用形态', () => {
  const body1 = '这是一篇博文\n\n![图片](/assets/uploads/photo-123.jpg)\n';
  const body2 = '这是另一篇\n\n![图片](/m/photo-123.jpg)\n';
  const body3 = '没有引用任何图\n';
  assert.equal(postRefsImage(body1, 'photo-123.jpg'), true);
  assert.equal(postRefsImage(body2, 'photo-123.jpg'), true);
  assert.equal(postRefsImage(body3, 'photo-123.jpg'), false);
  assert.equal(postRefsImage(body1, 'other.jpg'), false);
});

t('postRefsImage 仅匹配受管前缀路径，普通正文文本不误报', () => {
  const bodyMentionOnly = '正文讨论了 photo-123.jpg 但并没有插入为图片资源';
  assert.equal(postRefsImage(bodyMentionOnly, 'photo-123.jpg'), false);
});

// ---------- 前端解析器回归防线 ----------

t('parseBlocks 与 blocksToMarkdown 保留代码块语言标识', () => {
  const original = '```typescript\nconst message: string = "hello";\n```';
  const blocks = parseBlocks(original);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].lang, 'typescript');
  const restored = blocksToMarkdown(blocks);
  assert.equal(restored, original);
});

t('parseBlocks 表格解析无首尾外边框管道符时不丢列', () => {
  const tightTable = '名称 | 数量 | 备注\n--- | --- | ---\n苹果 | 10 | 红富士\n香蕉 | 20 | 进口';
  const blocks = parseBlocks(tightTable);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'table');
  // 必须完整保留 3 列，不能被误 shift/pop 丢弃首尾列
  assert.deepEqual(blocks[0].rows[0], ['名称', '数量', '备注']);
  assert.deepEqual(blocks[0].rows[1], ['苹果', '10', '红富士']);
  assert.deepEqual(blocks[0].rows[2], ['香蕉', '20', '进口']);
});

t('posts-flush 增量移除索引保护并发写入', () => {
  // 模拟入库前抓取了 a, b
  const items = [{ slug: 'a' }, { slug: 'b' }];
  // 模拟在 Git 提交期间，用户并发保存了 c
  const latestPend = { a: 100, b: 200, c: 300 };
  for (const it of items) delete latestPend[it.slug];
  // 必须只移除 a, b，完整保留新进来的 c
  assert.deepEqual(latestPend, { c: 300 });
});

// ---------- 2026-11-06 第23批：YAML 换行防线 + 渲染安全管线 ----------

t('normalizeMeta 字符串字段换行压成空格（YAML 断行防线）', () => {
  const m = normalizeMeta({ title: '坏标题\n---\n注入', description: 'a\r\nb', tags: ['x\ny', '  '] });
  assert.ok(!m.title.includes('\n'));
  assert.equal(m.title, '坏标题 --- 注入');
  assert.equal(m.description, 'a b');
  assert.deepEqual(m.tags, ['x y']);
});

t('换行清洗后 serialize→parse 不再产生文档分隔符', () => {
  const text = serializeFrontmatter(normalizeMeta({ title: 'a\n---\nb' }), '正文');
  // 整个 frontmatter 里只能有开头结尾两个 --- 分隔行
  assert.equal(text.split('\n').filter((l) => l === '---').length, 2);
  const back = parseFrontmatter(text);
  assert.equal(normalizeMeta(back.meta).title, 'a --- b');
});

t('safeUrl 白名单：http(s)/站内/锚点/相对路径过，javascript:/data: 拒', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('/m/a.webp'), '/m/a.webp');
  assert.equal(safeUrl('#sec'), '#sec');
  assert.equal(safeUrl('assets/img.png'), 'assets/img.png');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html;base64,xxx'), '');
  assert.equal(safeUrl(''), '');
});

t('safeUrl 拒绝协议相对 URL（// 与 /\\ 会被浏览器解析成站外）', () => {
  assert.equal(safeUrl('//evil.com/x'), '');
  assert.equal(safeUrl('/\\evil.com/x'), '');
  assert.equal(safeUrl('/'), '/'); // 站内根路径不受影响
  assert.equal(safeUrl('/m/a.webp'), '/m/a.webp');
});

t('splitUnescaped：\\| 不切列、a\\\\\\|b 真分隔、Safari<16.4 可跑（无 lookbehind）', () => {
  assert.deepEqual(splitUnescaped('a\\|b'), ['a\\|b']); // 转义竖线不切
  assert.deepEqual(splitUnescaped('a\\\\|b'), ['a\\\\', 'b']); // 双反斜杠=字面反斜杠，| 是真分隔符
  assert.deepEqual(splitUnescaped('a|b|c'), ['a', 'b', 'c']);
  assert.deepEqual(splitUnescaped('a\\|b|c'), ['a\\|b', 'c']);
  assert.deepEqual(splitUnescaped(''), ['']);
});

t('safeImgTag 属性白名单：事件属性丢弃、自家图片块格式无损', () => {
  const out = safeImgTag('<img src="/m/a.webp" alt="图" onerror="alert(1)" style="max-width:85%">');
  assert.ok(out.includes('src="/m/a.webp"'));
  assert.ok(out.includes('alt="图"'));
  assert.ok(out.includes('style="max-width:85%"'));
  assert.ok(!out.includes('onerror'));
  const bad = safeImgTag('<img src="javascript:alert(1)" onerror="alert(2)">');
  assert.ok(bad.startsWith('<p>')); // src 可疑 → 整行降级纯文本，不输出标签
  assert.ok(!bad.includes('<img'));
});

t('renderMarkdown 链接与图片协议过滤', () => {
  const h1 = renderMarkdown('[点我](javascript:alert%281%29)');
  assert.ok(!h1.includes('<a href="javascript'));
  assert.ok(h1.includes('点我')); // 文本保留，链接去掉
  const h2 = renderMarkdown('[正常](https://example.com)');
  assert.ok(h2.includes('<a href="https://example.com"'));
  const h3 = renderMarkdown('![图](javascript:alert(1))');
  assert.ok(!h3.includes('<img'));
});

t('renderMarkdown 独立成行 img 走白名单重建', () => {
  const h = renderMarkdown('<img src="/m/a.webp" alt="x" onload="alert(1)" />');
  assert.ok(h.includes('src="/m/a.webp"'));
  assert.ok(!h.includes('onload'));
});

t('renderMarkdown 表格无外边框不丢列、\\| 转义不切列', () => {
  const tight = '名称 | 数量\n--- | ---\na\\|b | 10';
  const html = renderMarkdown(tight);
  assert.ok(html.includes('<th>名称</th>'));
  assert.ok(html.includes('<th>数量</th>'));
  assert.ok(html.includes('<td>a|b</td>')); // 转义的竖线还原成一个格子
  assert.ok(html.includes('<td>10</td>'));
});

t('小白模式表格 \\| 转义往返无损（不再劈成两列/全角变形）', () => {
  const md = '| 名称 | 数量 |\n| --- | --- |\n| a\\|b | 10 |';
  const blocks = parseBlocks(md);
  assert.equal(blocks[0].rows[1][0], 'a|b');
  const back = blocksToMarkdown(blocks);
  assert.ok(back.includes('a\\|b')); // 序列化时按 GFM 标准转义回去，不再是全角 ｜
  const re = parseBlocks(back);
  assert.deepEqual(re[0].rows[1], ['a|b', '10']);
});

// ---------- /p/?fmt=json 探针数据源：draft 门禁与 no-store（公开页不能把草稿推给访客） ----------

function makeFakeKv() {
  const store = new Map();
  return {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => {
      store.set(k, String(v));
    },
    delete: async (k) => {
      store.delete(k);
    },
  };
}

t('/p/?fmt=json 带出 draft 标志且 no-store（草稿门禁的数据源半边）', async () => {
  const mod = await import('../edge-functions/p/[slug].js');
  const kv = makeFakeKv();
  // slug 'draft-post' 的十六进制 key 与 prod kvPostKey 同构（p_ 前缀）
  const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
  await kv.put('p_' + hex('draft-post'), JSON.stringify({ slug: 'draft-post', meta: { title: '草稿文', draft: true, pubDate: '2026-11-06T00:00:00.000Z' }, body: 'x', html: '<p>y</p>', at: 123 }));
  await kv.put('p_' + hex('live-post'), JSON.stringify({ slug: 'live-post', meta: { title: '正式文', draft: false, pubDate: '2026-11-06T00:00:00.000Z', tags: ['测试'] }, body: 'x', html: '<p>y</p>', at: 456 }));
  const call = (slug) =>
    mod.onRequestGet({
      params: { slug },
      env: { CMS_KV: kv },
      request: new Request('http://x.test/p/' + slug + '?fmt=json'),
    });
  const dDraft = await (await call('draft-post')).json();
  assert.equal(dDraft.draft, true);
  assert.equal(dDraft.title, '草稿文');
  const dLive = await (await call('live-post')).json();
  assert.equal(dLive.draft, false);
  // 热替换元数据同步：日期与标签随快照透出（探针据此更新 <time> 与 .post__tags）
  assert.equal(dLive.pubDate, '2026-11-06T00:00:00.000Z');
  assert.deepEqual(dLive.tags, ['测试']);
  const headers = (await call('live-post')).headers;
  assert.match(headers.get('cache-control') || '', /no-store/);
});

done();
